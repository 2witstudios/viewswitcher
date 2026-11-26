import { constants as fsConstants } from "node:fs";
import { copyFile, cp, lstat, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { fillPlaceholders, graphemes, isTextFile, ORG_TRANSITION, parseTemplateId, placeholderVars, readTitle, setTitle, slugify, TRANSITION_FILE as TRANSITION, transitionCandidates } from "@viewswitcher/shared";
import type { Org } from "@viewswitcher/shared";
import { walkFiles } from "@viewswitcher/packs";
import { writeAtomic } from "./atomic";
import { resolveInLibrary } from "./library/contain";
import { dirs, readJson } from "./library/read";
import { inside, PathError, plainName } from "./paths";

// Reading an org's content for the switcher is library/scanner.ts (LibraryScanner); this file has
// the orgs themselves and every change to the library.

// ---------------------------------------------------------------- orgs
// The library root holds one folder per org (a brand or channel). Each org has its own
// templates/, assets/ and projects/, plus org.json { name, accent, ground }.

const ORG_DEFAULTS = { accent: "#8b7bff", ground: "#0e0f13" };

export async function readOrg(libraryRoot: string, id: string): Promise<Org> {
  const dir = inside(libraryRoot, plainName(id));
  const meta = await readJson(join(dir, "org.json"), { name: id, ...ORG_DEFAULTS });
  return { id, name: meta.name, accent: meta.accent, ground: meta.ground };
}

export async function listOrgs(libraryRoot: string): Promise<Org[]> {
  const ids = [];
  for (const id of await dirs(libraryRoot)) if (await exists(join(libraryRoot, id, "org.json"))) ids.push(id);
  const orgs = await Promise.all(ids.map((id) => readOrg(libraryRoot, id)));
  return orgs.sort((a, b) => a.name.localeCompare(b.name));
}

/** A new org from the starter kit: neutral templates that use the org's own name and colors. */
export async function createOrg(libraryRoot: string, starter: string, name: string, accent = ORG_DEFAULTS.accent, ground = ORG_DEFAULTS.ground) {
  if (!name?.trim()) throw new PathError("A show needs a name");
  const base = slugify(name);
  let id = base, n = 2;
  while (await exists(join(libraryRoot, id))) id = `${base}-${n++}`;
  const dir = join(libraryRoot, id);
  await cp(starter, dir, { recursive: true });
  const vars = placeholderVars({ id, name, accent, ground });
  await Promise.all(
    (await walkFiles(dir)).filter(isTextFile).map(async (rel) => {
      const p = join(dir, rel);
      const text = await readFile(p, "utf8");
      const filled = fillPlaceholders(rel, text, vars);
      if (filled !== text) await writeAtomic(p, filled);
    }),
  );
  await mkdir(join(dir, "assets"), { recursive: true });
  await mkdir(join(dir, "projects"), { recursive: true });
  return { orgId: id };
}

// ---------------------------------------------------------------- templates

/**
 * The file of a template, by its name: "teaching" is the org's own (templates/teaching.html),
 * "neon/teaching" is in the set "neon" (templates/neon/teaching.html).
 */
export function templateFile(orgDir: string, template: string): { file: string; name: string } {
  const t = parseTemplateId(template);
  if (!t) throw new PathError(`Bad template: ${template}`);
  const name = plainName(t.name);
  const set = t.set === null ? null : plainName(t.set);
  return { file: inside(orgDir, set ? `templates/${set}/${name}.html` : `templates/${name}.html`), name };
}

// ---------------------------------------------------------------- transitions
// A transition is an HTML page shown full screen while scenes switch. The org's default lives in
// templates/_shared/transition.html; a project can have its own projects/<id>/transition.html.


/** The transition to play when `scenePath` goes on air, or null for a plain ground-color wipe. */
export async function resolveTransition(libraryRoot: string, scenePath: string): Promise<string | null> {
  for (const path of transitionCandidates(scenePath)) if (await exists(inside(libraryRoot, path))) return path;
  return null;
}

/** Give a project its own transition, starting from the org's. */
export async function customizeTransition(orgDir: string, projectId: string) {
  const dest = join(projectDir(orgDir, projectId), TRANSITION);
  if (await exists(dest)) return;
  const src = join(orgDir, ORG_TRANSITION);
  if (!(await exists(src))) throw new PathError("This show has no transition to start from yet");
  await contained(orgDir, src);
  await contained(orgDir, dest);
  await copyNew(src, dest);
}

/** Back to the org's transition: deletes the project's own. */
export async function revertTransition(orgDir: string, projectId: string) {
  const file = join(projectDir(orgDir, projectId), TRANSITION);
  await contained(orgDir, file);
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
 * Refuses (PathError) when `abs`, a file or folder in the org folder `orgDir`, is really somewhere
 * outside the library through a link, or in a dot-folder (library/contain.ts, the rule every read and
 * write follows; the library is the org folder's parent). Links that stay in the library are fine.
 * Every change here that makes a file or folder calls this for where it writes and what it reads.
 */
const contained = (orgDir: string, abs: string) => resolveInLibrary(dirname(orgDir), relative(dirname(orgDir), abs), { forWrite: true });

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

function projectDir(orgDir: string, projectId: string) {
  return inside(orgDir, `projects/${plainName(projectId)}`);
}

function streamDir(orgDir: string, projectId: string, streamId: string) {
  return inside(orgDir, `projects/${plainName(projectId)}/streams/${plainName(streamId)}`);
}

export async function createProject(orgDir: string, name: string, templates: string[], check?: BeforeCreate) {
  if (!name?.trim()) throw new PathError("A project needs a name");
  const base = slugify(name);
  const parent = inside(orgDir, "projects");
  await contained(orgDir, parent);
  await mkdir(parent, { recursive: true });
  let id = base, n = 2;
  while (await lstat(join(parent, id)).then(() => true, () => false)) id = `${base}-${n++}`;
  const dir = join(parent, id);
  const sources = templates.map((t) => templateFile(orgDir, t));
  for (const { file } of sources) if (await exists(file)) await contained(orgDir, file);
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

export async function createStream(orgDir: string, projectId: string, name: string, date: string) {
  if (!name?.trim()) throw new PathError("A stream needs a name");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new PathError("Date must be YYYY-MM-DD");
  const base = `${date.slice(5, 7)}-${date.slice(8, 10)}-${slugify(name)}`;
  const parent = join(projectDir(orgDir, projectId), "streams");
  await contained(orgDir, parent);
  await mkdir(parent, { recursive: true });
  let id = base, n = 2;
  while (await lstat(join(parent, id)).then(() => true, () => false)) id = `${base}-${n++}`;
  await mkdir(join(parent, id));
  await writeAtomic(join(parent, id, "stream.json"), JSON.stringify({ name: name.trim(), date }, null, 2) + "\n");
  return { projectId, streamId: id };
}

/** Copy a template into a project's shared scenes, or into one stream. */
export async function addFromTemplate(orgDir: string, template: string, projectId: string, streamId?: string, check?: BeforeCreate) {
  const { file: src, name: view } = templateFile(orgDir, template);
  const dir = streamId ? streamDir(orgDir, projectId, streamId) : join(projectDir(orgDir, projectId), "scenes");
  await contained(orgDir, src);
  await contained(orgDir, dir);
  await mkdir(dir, { recursive: true });
  return { name: await writeFresh(dir, view, ".html", await readFile(src, "utf8"), check) };
}

/** Copy a project scene into a stream so the stream can change it on its own. */
export async function customize(orgDir: string, projectId: string, streamId: string, name: string) {
  const src = join(projectDir(orgDir, projectId), "scenes", `${plainName(name)}.html`);
  const dest = join(streamDir(orgDir, projectId, streamId), `${name}.html`);
  if (await exists(dest)) return { name };
  await contained(orgDir, src);
  await contained(orgDir, dirname(dest));
  await copyNew(src, dest);
  return { name };
}

/** Delete a stream's override so the project version shows again. */
export async function revert(orgDir: string, projectId: string, streamId: string, name: string) {
  const projectScene = join(projectDir(orgDir, projectId), "scenes", `${plainName(name)}.html`);
  if (!(await exists(projectScene))) throw new PathError("Only a stream's own copy can go back to the project version");
  const copy = join(streamDir(orgDir, projectId, streamId), `${name}.html`);
  await contained(orgDir, copy);
  await rm(copy);
}

export async function duplicate(libraryRoot: string, path: string, check?: BeforeCreate) {
  if (!path.endsWith(".html")) throw new PathError("Only views can be duplicated");
  const src = inside(libraryRoot, path);
  const dir = src.slice(0, src.lastIndexOf("/"));
  const base = src.slice(dir.length + 1, -5);
  const html = await readFile(src, "utf8");
  return { name: await writeFresh(dir, `${base}-copy`, ".html", titledCopy(html), check) };
}

/** A copy's page: its <title> with " copy" after it, kept within a title's 120 characters; as it was when it has none. */
export function titledCopy(html: string): string {
  const title = readTitle(html);
  if (!title) return html;
  // Whole characters only (an emoji or a flag at the cut isn't split), within setTitle's 120 UTF-16 units.
  let kept = "";
  for (const ch of graphemes(title)) {
    if (kept.length + ch.length > 120 - " copy".length) break;
    kept += ch;
  }
  return setTitle(html, `${kept.trimEnd()} copy`);
}

export async function saveAsset(orgDir: string, file: File, check?: BeforeCreate) {
  const dir = inside(orgDir, "assets");
  await contained(orgDir, dir);
  await mkdir(dir, { recursive: true });
  const clean = file.name.replace(/[^A-Za-z0-9._ -]/g, "-").replace(/^[.\-]+/, "") || "upload";
  const ext = extname(clean);
  const base = plainName(clean.slice(0, clean.length - ext.length) || "upload");
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Two uploads of logo.png at once get logo.png and logo-2.png, never one overwriting the other.
  return { path: `assets/${await writeFresh(dir, base, ext, bytes, check)}${ext}` };
}
