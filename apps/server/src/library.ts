import { constants as fsConstants } from "node:fs";
import { copyFile, cp, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { readManifest, slugify, transitionCandidates } from "@viewswitcher/shared";
import type { Asset, AssetKind, Library, Org, Project, Scene, SceneOrigin, Stream, TemplateSet } from "@viewswitcher/shared";
import { writeAtomic } from "./atomic";
import { resolveInLibrary } from "./library/contain";
import { limit } from "./limit";
import { inside, PathError, plainName } from "./paths";
import { createSceneTitles } from "./scene-titles";

const KINDS: Record<string, AssetKind> = {
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image", ".svg": "image", ".avif": "image",
  ".mp4": "video", ".mov": "video", ".webm": "video", ".m4v": "video",
  ".mp3": "audio", ".wav": "audio", ".m4a": "audio", ".aac": "audio", ".ogg": "audio",
};

// The library is read on every change by every client (and by agents), so a scan reads as little
// as it can: scene titles are kept while the file's stat stamp (size, times, inode) stays the same,
// and dropped for the paths the watcher reports (scene-titles.ts); folders are walked side by side.
// File reads and stats go through one bounded queue, so a big library can't run out of open files.

/** File reads and stats for scans: at most 32 at once, across every scan. */
const io = limit(32);

async function dirs(path: string): Promise<string[]> {
  try {
    const entries = await io(() => readdir(path, { withFileTypes: true }));
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("_")).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return { ...fallback, ...JSON.parse(await io(() => readFile(path, "utf8"))) };
  } catch {
    return fallback;
  }
}

/** `url` when the file `abs` is there, else null (a transition, for the library listing). */
const urlIfThere = (abs: string, url: string) => io(() => exists(abs)).then((t) => (t ? url : null));

const titles = createSceneTitles({ stat: (abs) => io(() => stat(abs)), read: (abs) => io(() => readFile(abs, "utf8")) });

/** Library paths the watcher reported (library-relative): their titles are read again on the next scan. */
export const forgetScanned = (libraryRoot: string, paths: string[]) => titles.forget(libraryRoot, paths);

async function scenesIn(root: string, rel: string, origin: SceneOrigin, order: string[], prefix: string, set?: string): Promise<Scene[]> {
  let files: string[] = [];
  try {
    files = (await io(() => readdir(join(root, rel)))).filter((f) => f.endsWith(".html") && !f.startsWith("."));
  } catch {
    return [];
  }
  const scenes = await Promise.all(
    files.map(async (f) => {
      const name = f.slice(0, -5);
      const title = await titles.titleOf(join(root, rel, f));
      return { name, label: title || name.replace(/-/g, " "), path: `${prefix}${rel}/${f}`, origin, ...(set ? { set } : {}) } satisfies Scene;
    }),
  );
  const rank = (n: string) => (order.includes(n) ? order.indexOf(n) : order.length);
  return scenes.sort((a, b) => rank(a.name) - rank(b.name) || a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------- orgs
// The library root holds one folder per org (a brand or channel). Each org has its own
// templates/, assets/ and projects/, plus org.json { name, accent, ground }.

const ORG_DEFAULTS = { accent: "#8b7bff", ground: "#0e0f13" };

export async function readOrg(root: string, id: string): Promise<Org> {
  const dir = inside(root, plainName(id));
  const meta = await readJson(join(dir, "org.json"), { name: id, ...ORG_DEFAULTS });
  return { id, name: meta.name, accent: meta.accent, ground: meta.ground };
}

export async function listOrgs(root: string): Promise<Org[]> {
  const ids = [];
  for (const id of await dirs(root)) if (await exists(join(root, id, "org.json"))) ids.push(id);
  const orgs = await Promise.all(ids.map((id) => readOrg(root, id)));
  return orgs.sort((a, b) => a.name.localeCompare(b.name));
}

/** A new org from the starter kit: neutral templates that use the org's own name and colors. */
export async function createOrg(root: string, starter: string, name: string, accent = ORG_DEFAULTS.accent, ground = ORG_DEFAULTS.ground) {
  if (!name?.trim()) throw new PathError("An org needs a name");
  const base = slugify(name);
  let id = base, n = 2;
  while (await exists(join(root, id))) id = `${base}-${n++}`;
  const dir = join(root, id);
  await cp(starter, dir, { recursive: true });
  const vars: Record<string, string> = { ORG_ID: id, ORG_NAME: name.trim(), ORG_INITIAL: name.trim()[0]!.toUpperCase(), ACCENT: accent, GROUND: ground };
  const fill = async (path: string) => {
    for (const e of await readdir(path, { withFileTypes: true })) {
      const p = join(path, e.name);
      if (e.isDirectory()) await fill(p);
      else if (/\.(html|css|json|md|js|svg)$/.test(e.name)) {
        const text = await readFile(p, "utf8");
        await writeFile(p, text.replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] ?? m));
      }
    }
  };
  await fill(dir);
  await mkdir(join(dir, "assets"), { recursive: true });
  await mkdir(join(dir, "projects"), { recursive: true });
  return { orgId: id };
}

/** One org's content. `root` is the library root; every returned path starts with the org id. */
export async function scanLibrary(libraryRoot: string, orgId: string): Promise<Library> {
  const org = await readOrg(libraryRoot, orgId);
  const root = inside(libraryRoot, plainName(orgId));
  const prefix = `${org.id}/`;
  const [templates, sets, assets, projects, transition] = await Promise.all([
    readJson(join(root, "templates/_shared/order.json"), { order: [] as string[] }).then((meta) => scenesIn(root, "templates", "template", meta.order, prefix)),
    listSets(root, prefix),
    listAssets(root, prefix),
    dirs(join(root, "projects")).then((ids) => Promise.all(ids.map((id) => scanProject(root, prefix, id)))),
    urlIfThere(join(root, ORG_TRANSITION), `${prefix}${ORG_TRANSITION}`),
  ]);
  return { org, templates, sets, assets, projects, transition };
}

async function listAssets(root: string, prefix: string): Promise<Asset[]> {
  try {
    const names = (await io(() => readdir(join(root, "assets")))).filter((n) => !n.startsWith("."));
    const assets = await Promise.all(
      names.map(async (name) => {
        // One that's gone since the listing (a replace, a delete, a broken link) is left out, not the rest with it.
        const s = await io(() => stat(join(root, "assets", name))).catch(() => null);
        return { name, path: `${prefix}assets/${name}`, kind: KINDS[extname(name).toLowerCase()] ?? "other", size: s?.size ?? 0 } satisfies Asset;
      }),
    );
    return assets.filter((a) => a.size > 0).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

async function scanProject(root: string, prefix: string, id: string): Promise<Project> {
  const dir = join(root, "projects", id);
  const p = await readJson(join(dir, "project.json"), { name: id, order: [] as string[] });
  const [scenes, streams, transition] = await Promise.all([
    scenesIn(root, `projects/${id}/scenes`, "project", p.order, prefix),
    dirs(join(dir, "streams")).then((ids) =>
      Promise.all(
        ids.map(async (sid): Promise<Stream> => {
          const rel = `projects/${id}/streams/${sid}`;
          const [s, scenes] = await Promise.all([readJson(join(root, rel, "stream.json"), { name: sid, date: "" }), scenesIn(root, rel, "stream", p.order, prefix)]);
          return { id: sid, name: s.name, date: s.date, scenes };
        }),
      ),
    ),
    urlIfThere(join(dir, TRANSITION), `${prefix}projects/${id}/${TRANSITION}`),
  ]);
  streams.sort((a, b) => (a.date || a.id).localeCompare(b.date || b.id));
  return { id, name: p.name, scenes, streams, transition };
}

// ---------------------------------------------------------------- template sets
// An installed template pack is a folder templates/<set>/ with its pack.json, its views, _shared/ and
// assets/ (see packs.ts and docs/template-packs.md). The org's own templates stay in templates/*.html.

/** The org's template sets: folders in templates/ that have a pack.json. */
async function listSets(root: string, prefix: string): Promise<TemplateSet[]> {
  const found = await Promise.all(
    (await dirs(join(root, "templates"))).map(async (id): Promise<TemplateSet | null> => {
      const text = await io(() => readFile(join(root, "templates", id, "pack.json"), "utf8")).catch(() => null);
      if (text === null) return null;
      const read = readManifest(text);
      // A pack.json someone edited by hand into something odd: still list the set, by its folder.
      const m = read.ok ? read.manifest : { name: id, version: "", description: "", views: [] as string[] };
      const rel = `templates/${id}`;
      const [templates, transition] = await Promise.all([
        scenesIn(root, rel, "template", m.views, prefix, id),
        urlIfThere(join(root, rel, "_shared", TRANSITION), `${prefix}${rel}/_shared/${TRANSITION}`),
      ]);
      return { id, name: m.name, version: m.version, description: m.description, ...("author" in m && m.author ? { author: m.author } : {}), templates, transition };
    }),
  );
  return found.filter((s): s is TemplateSet => s !== null).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The file of a template, by its name: "teaching" is the org's own (templates/teaching.html),
 * "neon/teaching" is in the set "neon" (templates/neon/teaching.html).
 */
export function templateFile(root: string, template: string): { file: string; name: string } {
  const parts = String(template ?? "").split("/");
  if (parts.length > 2) throw new PathError(`Bad template: ${template}`);
  const name = plainName(parts.at(-1)!);
  const set = parts.length === 2 ? plainName(parts[0]!) : null;
  return { file: inside(root, set ? `templates/${set}/${name}.html` : `templates/${name}.html`), name };
}

// ---------------------------------------------------------------- transitions
// A transition is an HTML page shown full screen while scenes switch. The org's default lives in
// templates/_shared/transition.html; a project can have its own projects/<id>/transition.html.

const TRANSITION = "transition.html";
const ORG_TRANSITION = `templates/_shared/${TRANSITION}`;

/** The transition to play when `scenePath` goes on air, or null for a plain ground-color wipe. */
export async function resolveTransition(libraryRoot: string, scenePath: string): Promise<string | null> {
  for (const path of transitionCandidates(scenePath)) if (await exists(inside(libraryRoot, path))) return path;
  return null;
}

/** Give a project its own transition, starting from the org's. */
export async function customizeTransition(root: string, projectId: string) {
  const dest = join(projectDir(root, projectId), TRANSITION);
  if (await exists(dest)) return;
  const src = join(root, ORG_TRANSITION);
  if (!(await exists(src))) throw new PathError("This org has no transition to start from yet");
  await contained(root, src);
  await contained(root, dest);
  await copyNew(src, dest);
}

/** Back to the org's transition: deletes the project's own. */
export async function revertTransition(root: string, projectId: string) {
  const file = join(projectDir(root, projectId), TRANSITION);
  await contained(root, file);
  await rm(file, { force: true });
}

// ---------------------------------------------------------------- mutations

export async function exists(path: string) {
  return stat(path).then(() => true, () => false);
}

/** A file (not a folder) is there. */
export async function isFile(path: string) {
  return stat(path).then((s) => s.isFile(), () => false);
}

/**
 * Refuses (PathError) when `abs`, a file or folder in the org folder `root`, is really somewhere
 * outside the library through a link, or in a dot-folder (library/contain.ts, the rule every read and
 * write follows; the library is the org folder's parent). Links that stay in the library are fine.
 * Every change here that makes a file or folder calls this for where it writes and what it reads.
 */
const contained = (root: string, abs: string) => resolveInLibrary(dirname(root), relative(dirname(root), abs), { forWrite: true });

/** Copy to a new file only: never through a link already at `dest` (a dangling one could point outside the library). */
async function copyNew(src: string, dest: string) {
  try {
    await copyFile(src, dest, fsConstants.COPYFILE_EXCL);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new PathError("Something is already there (a link to somewhere else?). Remove it, then try again.");
    throw e;
  }
}

/** Whether anything at all is at `path`, a link included, even one that points nowhere (lstat, not stat). */
const taken = (path: string) => lstat(path).then(() => true, () => false);

/** "teaching" in a folder that already has it → "teaching-2". A dangling link counts as taken. */
export async function freeName(dir: string, base: string, ext: string) {
  let name = base, n = 2;
  while (await taken(join(dir, name + ext))) name = `${base}-${n++}`;
  return name;
}

/**
 * Write a new file named `base` (or the next free name) in `dir`, claiming the name as it's written:
 * an exclusive create never follows a link that's already there (a dangling one could point outside
 * the library) and never overwrites a file someone else made a moment ago. Returns the name used.
 */
/** A last check on a file about to be made, by its absolute path, that throws to refuse it (the agents' on-air guard). */
export type BeforeCreate = (abs: string) => void;

export async function writeFresh(dir: string, base: string, ext: string, data: string | Uint8Array, check?: BeforeCreate): Promise<string> {
  for (;;) {
    const name = await freeName(dir, base, ext);
    check?.(join(dir, name + ext)); // the name really used, which may not be the one asked for
    try {
      await writeFile(join(dir, name + ext), data, { flag: "wx" });
      return name;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
}

function projectDir(root: string, projectId: string) {
  return inside(root, `projects/${plainName(projectId)}`);
}

function streamDir(root: string, projectId: string, streamId: string) {
  return inside(root, `projects/${plainName(projectId)}/streams/${plainName(streamId)}`);
}

export async function createProject(root: string, name: string, templates: string[], check?: BeforeCreate) {
  if (!name?.trim()) throw new PathError("A project needs a name");
  const base = slugify(name);
  const parent = inside(root, "projects");
  await contained(root, parent);
  await mkdir(parent, { recursive: true });
  let id = base, n = 2;
  while (await lstat(join(parent, id)).then(() => true, () => false)) id = `${base}-${n++}`;
  const dir = join(parent, id);
  const sources = templates.map((t) => templateFile(root, t));
  for (const { file } of sources) if (await exists(file)) await contained(root, file);
  await mkdir(join(dir, "scenes"), { recursive: true });
  await mkdir(join(dir, "streams"), { recursive: true });
  // Templates from sets ("neon/teaching") become scenes named by their view ("teaching", "teaching-2"…).
  const order: string[] = [];
  for (const { file, name: view } of sources) {
    if (!(await exists(file))) continue;
    order.push(await writeFresh(join(dir, "scenes"), view, ".html", await readFile(file, "utf8"), check));
  }
  await writeAtomic(join(dir, "project.json"), JSON.stringify({ name: name.trim(), order }, null, 2) + "\n");
  return { projectId: id };
}

export async function createStream(root: string, projectId: string, name: string, date: string) {
  if (!name?.trim()) throw new PathError("A stream needs a name");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new PathError("Date must be YYYY-MM-DD");
  const base = `${date.slice(5, 7)}-${date.slice(8, 10)}-${slugify(name)}`;
  const parent = join(projectDir(root, projectId), "streams");
  await contained(root, parent);
  await mkdir(parent, { recursive: true });
  let id = base, n = 2;
  while (await lstat(join(parent, id)).then(() => true, () => false)) id = `${base}-${n++}`;
  await mkdir(join(parent, id));
  await writeAtomic(join(parent, id, "stream.json"), JSON.stringify({ name: name.trim(), date }, null, 2) + "\n");
  return { projectId, streamId: id };
}

/** Copy a template into a project's shared scenes, or into one stream. */
export async function addFromTemplate(root: string, template: string, projectId: string, streamId?: string, check?: BeforeCreate) {
  const { file: src, name: view } = templateFile(root, template);
  const dir = streamId ? streamDir(root, projectId, streamId) : join(projectDir(root, projectId), "scenes");
  await contained(root, src);
  await contained(root, dir);
  await mkdir(dir, { recursive: true });
  return { name: await writeFresh(dir, view, ".html", await readFile(src, "utf8"), check) };
}

/** Copy a project scene into a stream so the stream can change it on its own. */
export async function customize(root: string, projectId: string, streamId: string, name: string) {
  const src = join(projectDir(root, projectId), "scenes", `${plainName(name)}.html`);
  const dest = join(streamDir(root, projectId, streamId), `${name}.html`);
  if (await exists(dest)) return { name };
  await contained(root, src);
  await contained(root, dirname(dest));
  await copyNew(src, dest);
  return { name };
}

/** Delete a stream's override so the project version shows again. */
export async function revert(root: string, projectId: string, streamId: string, name: string) {
  const projectScene = join(projectDir(root, projectId), "scenes", `${plainName(name)}.html`);
  if (!(await exists(projectScene))) throw new PathError("Only an override can go back to the project version");
  const copy = join(streamDir(root, projectId, streamId), `${name}.html`);
  await contained(root, copy);
  await rm(copy);
}

export async function duplicate(root: string, path: string, check?: BeforeCreate) {
  if (!path.endsWith(".html")) throw new PathError("Only scenes can be duplicated");
  const src = inside(root, path);
  const dir = src.slice(0, src.lastIndexOf("/"));
  const base = src.slice(dir.length + 1, -5);
  const html = await readFile(src, "utf8");
  return { name: await writeFresh(dir, `${base}-copy`, ".html", html.replace(/<title>([^<]*)<\/title>/i, (_m, t) => `<title>${t} copy</title>`), check) };
}

export async function saveAsset(root: string, file: File, check?: BeforeCreate) {
  const dir = inside(root, "assets");
  await contained(root, dir);
  await mkdir(dir, { recursive: true });
  const clean = file.name.replace(/[^A-Za-z0-9._ -]/g, "-").replace(/^[.\-]+/, "") || "upload";
  const ext = extname(clean);
  const base = plainName(clean.slice(0, clean.length - ext.length) || "upload");
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Two uploads of logo.png at once get logo.png and logo-2.png, never one overwriting the other.
  return { path: `assets/${await writeFresh(dir, base, ext, bytes, check)}${ext}` };
}
