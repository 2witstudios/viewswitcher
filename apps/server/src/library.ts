import { copyFile, cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { decodeEntities, readManifest, slugify, transitionCandidates } from "@viewswitcher/shared";
import type { Asset, AssetKind, Library, Org, Project, Scene, SceneOrigin, Stream, TemplateSet } from "@viewswitcher/shared";
import { inside, PathError, plainName } from "./paths";

const KINDS: Record<string, AssetKind> = {
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image", ".svg": "image", ".avif": "image",
  ".mp4": "video", ".mov": "video", ".webm": "video", ".m4v": "video",
  ".mp3": "audio", ".wav": "audio", ".m4a": "audio", ".aac": "audio", ".ogg": "audio",
};

async function dirs(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("_")).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return { ...fallback, ...JSON.parse(await readFile(path, "utf8")) };
  } catch {
    return fallback;
  }
}

async function scenesIn(root: string, rel: string, origin: SceneOrigin, order: string[], prefix: string, set?: string): Promise<Scene[]> {
  let files: string[] = [];
  try {
    files = (await readdir(join(root, rel))).filter((f) => f.endsWith(".html") && !f.startsWith("."));
  } catch {
    return [];
  }
  const scenes = await Promise.all(
    files.map(async (f) => {
      const name = f.slice(0, -5);
      const html = await readFile(join(root, rel, f), "utf8").catch(() => "");
      const title = decodeEntities(/<title\b[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim();
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
  const meta = await readJson(join(root, "templates/_shared/order.json"), { order: [] as string[] });
  const templates = await scenesIn(root, "templates", "template", meta.order, prefix);
  const sets = await listSets(root, prefix);

  let assets: Asset[] = [];
  try {
    const names = (await readdir(join(root, "assets"))).filter((n) => !n.startsWith("."));
    assets = await Promise.all(
      names.map(async (name) => {
        const s = await stat(join(root, "assets", name));
        return { name, path: `${prefix}assets/${name}`, kind: KINDS[extname(name).toLowerCase()] ?? "other", size: s.size };
      }),
    );
    assets = assets.filter((a) => a.size > 0).sort((a, b) => a.name.localeCompare(b.name));
  } catch {}

  const projects: Project[] = [];
  for (const id of await dirs(join(root, "projects"))) {
    const p = await readJson(join(root, "projects", id, "project.json"), { name: id, order: [] as string[] });
    const streams: Stream[] = [];
    for (const sid of await dirs(join(root, "projects", id, "streams"))) {
      const rel = `projects/${id}/streams/${sid}`;
      const s = await readJson(join(root, rel, "stream.json"), { name: sid, date: "" });
      streams.push({ id: sid, name: s.name, date: s.date, scenes: await scenesIn(root, rel, "stream", p.order, prefix) });
    }
    streams.sort((a, b) => (a.date || a.id).localeCompare(b.date || b.id));
    const transition = (await exists(join(root, "projects", id, TRANSITION))) ? `${prefix}projects/${id}/${TRANSITION}` : null;
    projects.push({ id, name: p.name, scenes: await scenesIn(root, `projects/${id}/scenes`, "project", p.order, prefix), streams, transition });
  }
  const transition = (await exists(join(root, ORG_TRANSITION))) ? `${prefix}${ORG_TRANSITION}` : null;
  return { org, templates, sets, assets, projects, transition };
}

// ---------------------------------------------------------------- template sets (EDIT-25)
// An installed template pack is a folder templates/<set>/ with its pack.json, its views, _shared/ and
// assets/ (see packs.ts and docs/template-packs.md). The org's own templates stay in templates/*.html.

/** The org's template sets: folders in templates/ that have a pack.json. */
async function listSets(root: string, prefix: string): Promise<TemplateSet[]> {
  const sets: TemplateSet[] = [];
  for (const id of await dirs(join(root, "templates"))) {
    const text = await readFile(join(root, "templates", id, "pack.json"), "utf8").catch(() => null);
    if (text === null) continue;
    const read = readManifest(text);
    // A pack.json someone edited by hand into something odd: still list the set, by its folder.
    const m = read.ok ? read.manifest : { name: id, version: "", description: "", views: [] as string[] };
    const rel = `templates/${id}`;
    const transition = (await exists(join(root, rel, "_shared", TRANSITION))) ? `${prefix}${rel}/_shared/${TRANSITION}` : null;
    sets.push({
      id, name: m.name, version: m.version, description: m.description, ...("author" in m && m.author ? { author: m.author } : {}),
      templates: await scenesIn(root, rel, "template", m.views, prefix, id),
      transition,
    });
  }
  return sets.sort((a, b) => a.name.localeCompare(b.name));
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
  await copyFile(src, dest);
}

/** Back to the org's transition: deletes the project's own. */
export async function revertTransition(root: string, projectId: string) {
  await rm(join(projectDir(root, projectId), TRANSITION), { force: true });
}

// ---------------------------------------------------------------- mutations

export async function exists(path: string) {
  return stat(path).then(() => true, () => false);
}

/** "teaching" in a folder that already has it → "teaching-2". */
export async function freeName(dir: string, base: string, ext: string) {
  let name = base, n = 2;
  while (await exists(join(dir, name + ext))) name = `${base}-${n++}`;
  return name;
}

function projectDir(root: string, projectId: string) {
  return inside(root, `projects/${plainName(projectId)}`);
}

function streamDir(root: string, projectId: string, streamId: string) {
  return inside(root, `projects/${plainName(projectId)}/streams/${plainName(streamId)}`);
}

export async function createProject(root: string, name: string, templates: string[]) {
  if (!name?.trim()) throw new PathError("A project needs a name");
  const base = slugify(name);
  const parent = inside(root, "projects");
  await mkdir(parent, { recursive: true });
  let id = base, n = 2;
  while (await exists(join(parent, id))) id = `${base}-${n++}`;
  const dir = join(parent, id);
  await mkdir(join(dir, "scenes"), { recursive: true });
  await mkdir(join(dir, "streams"), { recursive: true });
  // Templates from sets ("neon/teaching") become scenes named by their view ("teaching", "teaching-2"…).
  const order: string[] = [];
  for (const t of templates) {
    const { file, name: view } = templateFile(root, t);
    if (!(await exists(file))) continue;
    const scene = await freeName(join(dir, "scenes"), view, ".html");
    await copyFile(file, join(dir, "scenes", `${scene}.html`));
    order.push(scene);
  }
  await writeFile(join(dir, "project.json"), JSON.stringify({ name: name.trim(), order }, null, 2) + "\n");
  return { projectId: id };
}

export async function createStream(root: string, projectId: string, name: string, date: string) {
  if (!name?.trim()) throw new PathError("A stream needs a name");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new PathError("Date must be YYYY-MM-DD");
  const base = `${date.slice(5, 7)}-${date.slice(8, 10)}-${slugify(name)}`;
  const parent = join(projectDir(root, projectId), "streams");
  await mkdir(parent, { recursive: true });
  let id = base, n = 2;
  while (await exists(join(parent, id))) id = `${base}-${n++}`;
  await mkdir(join(parent, id));
  await writeFile(join(parent, id, "stream.json"), JSON.stringify({ name: name.trim(), date }, null, 2) + "\n");
  return { projectId, streamId: id };
}

/** Copy a template into a project's shared scenes, or into one stream. */
export async function addFromTemplate(root: string, template: string, projectId: string, streamId?: string) {
  const { file: src, name: view } = templateFile(root, template);
  const dir = streamId ? streamDir(root, projectId, streamId) : join(projectDir(root, projectId), "scenes");
  await mkdir(dir, { recursive: true });
  const name = await freeName(dir, view, ".html");
  await copyFile(src, join(dir, `${name}.html`));
  return { name };
}

/** Copy a project scene into a stream so the stream can change it on its own. */
export async function customize(root: string, projectId: string, streamId: string, name: string) {
  const src = join(projectDir(root, projectId), "scenes", `${plainName(name)}.html`);
  const dest = join(streamDir(root, projectId, streamId), `${name}.html`);
  if (await exists(dest)) return { name };
  await copyFile(src, dest);
  return { name };
}

/** Delete a stream's override so the project version shows again. */
export async function revert(root: string, projectId: string, streamId: string, name: string) {
  const projectScene = join(projectDir(root, projectId), "scenes", `${plainName(name)}.html`);
  if (!(await exists(projectScene))) throw new PathError("Only an override can go back to the project version");
  await rm(join(streamDir(root, projectId, streamId), `${name}.html`));
}

export async function duplicate(root: string, path: string) {
  if (!path.endsWith(".html")) throw new PathError("Only scenes can be duplicated");
  const src = inside(root, path);
  const dir = src.slice(0, src.lastIndexOf("/"));
  const base = src.slice(dir.length + 1, -5);
  const name = await freeName(dir, `${base}-copy`, ".html");
  const html = await readFile(src, "utf8");
  await writeFile(join(dir, `${name}.html`), html.replace(/<title>([^<]*)<\/title>/i, (_m, t) => `<title>${t} copy</title>`));
  return { name };
}

export async function saveAsset(root: string, file: File) {
  const dir = inside(root, "assets");
  await mkdir(dir, { recursive: true });
  const clean = file.name.replace(/[^A-Za-z0-9._ -]/g, "-").replace(/^[.\-]+/, "") || "upload";
  const ext = extname(clean);
  const name = await freeName(dir, plainName(clean.slice(0, clean.length - ext.length) || "upload"), ext);
  await Bun.write(join(dir, name + ext), file);
  return { path: `assets/${name}${ext}` };
}
