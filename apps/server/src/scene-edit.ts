// The scene editor's file side: serve a scene tagged with element ids, and patch source ranges
// back into the file, refusing when the file changed since the editor loaded it.
import { chmod, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { applyEdits, EditError, setTitle, slugify, tagForEdit } from "@viewswitcher/shared";
import type { SceneEdit } from "@viewswitcher/shared";
import { inside, PathError, plainName } from "./paths";

/** Identifies one version of a file's text. */
export const sceneHash = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 20);

/** A scene file, by its library path (which starts with the org id). */
export function scenePath(root: string, path: unknown): string {
  const p = String(path ?? "");
  if (!p.endsWith(".html")) throw new PathError("Only scenes can be edited");
  plainName(p.split("/")[0] ?? "");
  return inside(root, p);
}

/** The scene's real file, which must be inside the library even when the path goes through a link. */
async function realScene(root: string, path: unknown) {
  const real = await realpath(scenePath(root, path));
  const back = relative(await realpath(root), real);
  if (back === "" || back.startsWith("..") || isAbsolute(back)) throw new PathError("This scene is a link to a file outside the library");
  return real;
}

/** The scene with data-vs ids for the editor (and the program page). Reads only; never writes. */
export async function readForEdit(root: string, path: string) {
  const text = await readFile(await realScene(root, path), "utf8");
  const hash = sceneHash(text);
  return { html: tagForEdit(text, hash), hash };
}

const num = (v: unknown) => (v == null || v === "" ? NaN : Number(v));
const inRange = (n: number) => Number.isFinite(n) && Math.abs(n) <= 100_000;

/** Check one edit's shape: {id, text}, {id, left, top}, {id, width, height, left?, top?}, {id, insert, before?, lead?}, {id, remove}, {id, src}. */
export function parseEdit(e: any): SceneEdit {
  // A real number only: Number(null) or Number("") would quietly become element 0.
  const id = e?.id;
  const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
  if (!isId(id)) throw new EditError("Each edit needs an element id");
  if (typeof e.text === "string") {
    if (e.text.length > 2000) throw new EditError("That text is too long for a scene");
    return { id, text: e.text };
  }
  if (typeof e.insert === "string") {
    // checkInsert (in applyEdits) refuses anything but one plain element.
    if (e.before !== undefined && !isId(e.before)) throw new EditError("Bad place to insert");
    if (e.lead !== undefined && typeof e.lead !== "string") throw new EditError("Bad spacing");
    return { id, insert: e.insert, ...(e.before !== undefined ? { before: e.before } : {}), ...(e.lead !== undefined ? { lead: e.lead } : {}) };
  }
  if (e.remove === true) return { id, remove: true };
  if (typeof e.src === "string") {
    // Only the library's own files (an org's assets or brand): never another site's.
    const src = e.src;
    if (!src.startsWith("/library/") || src.length > 600) throw new EditError("Images come from the library");
    let rel = "";
    try {
      rel = decodeURIComponent(src.slice("/library/".length));
    } catch {
      throw new EditError("That isn't an image the scene can show");
    }
    plainName(rel.split("/")[0] ?? "");
    if (rel.split("/").some((part) => part === ".." || part.startsWith("."))) throw new EditError("Images come from the library");
    return { id, src };
  }
  if (e.width !== undefined || e.height !== undefined) {
    const width = num(e.width), height = num(e.height);
    if (!inRange(width) || !inRange(height) || width < 1 || height < 1) throw new EditError("A size is {id, width, height}");
    const out: SceneEdit = { id, width, height };
    for (const k of ["left", "top"] as const) {
      if (e[k] === undefined) continue;
      const v = num(e[k]);
      if (!inRange(v)) throw new EditError("Position must be numbers");
      out[k] = v;
    }
    return out;
  }
  const left = num(e.left), top = num(e.top);
  if (!inRange(left) || !inRange(top)) throw new EditError("Each edit is {id, text}, {id, left, top}, {id, width, height}, {id, insert}, {id, remove} or {id, src}");
  return { id, left, top };
}

export type EditResult = { ok: true; hash: string; changed: boolean } | { ok: false; conflict: true; hash: string };

// Edits to the library run one at a time, so a read-compare-write can't interleave with another.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Write `next` over `real` (read as `text`, stat'd as `read`) only if it's still that version.
 * Returns false (writing nothing) when someone else saved meanwhile.
 */
async function replaceChecked(real: string, read: Awaited<ReturnType<typeof stat>>, current: string, next: string, hooks: { beforeReplace?: () => Promise<void> }) {
  // A linked scene is written where it really lives (so the link stays a link), never outside the library.
  // Write beside it and rename, so nothing ever reads a half-written scene; keep its permissions.
  // The watcher ignores dot-files.
  const tmp = join(dirname(real), `.${basename(real)}.vs-${process.pid}-${Date.now()}`);
  let replaced = false;
  try {
    await writeFile(tmp, next);
    await chmod(tmp, Number(read.mode) & 0o7777);
    await hooks.beforeReplace?.();
    // Someone else saved while this one was being written: theirs wins, this one is a conflict. Checked
    // by stat and by content, right before the rename. (Plain files have no compare-and-swap, so a
    // write landing between this check and the rename itself can't be caught without a lock the agent
    // would also have to honour; this leaves only that instant.)
    const now = await stat(real).catch(() => null);
    const there = now && now.mtimeMs === read.mtimeMs && now.size === read.size ? await readFile(real, "utf8").catch(() => null) : null;
    if (there === null || sceneHash(there) !== current) {
      await rm(tmp, { force: true });
      const latest = there ?? (await readFile(real, "utf8").catch(() => ""));
      return { ok: false as const, hash: sceneHash(latest) };
    }
    await rename(tmp, real);
    replaced = true;
    return { ok: true as const };
  } finally {
    // Whatever happened (a conflict, a failed chmod or rename), no staged copy is left behind.
    if (!replaced) await rm(tmp, { force: true }).catch(() => {});
  }
}

/** Run one library change at a time. */
function serial<T>(run: () => Promise<T>): Promise<T> {
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

/**
 * Apply `edits` (ids from the version with `hash`) and write the file once. If the file's hash
 * isn't `hash` any more, nothing is written and the result carries the current hash.
 */
export function editScene(
  root: string, path: string, hash: string, edits: unknown[],
  /** Tests only: runs between reading the file and replacing it. */
  hooks: { beforeReplace?: () => Promise<void> } = {},
): Promise<EditResult> {
  return serial(async (): Promise<EditResult> => {
    if (!Array.isArray(edits) || edits.length === 0) throw new EditError("No edits to save");
    if (edits.length > 100) throw new EditError("Too many edits at once");
    const parsed = edits.map(parseEdit);
    const real = await realScene(root, path);
    const read = await stat(real);
    const text = await readFile(real, "utf8");
    const current = sceneHash(text);
    if (current !== hash) return { ok: false, conflict: true, hash: current };
    const next = applyEdits(text, parsed);
    if (next === text) return { ok: true, hash: current, changed: false };
    const r = await replaceChecked(real, read, current, next, hooks);
    if (!r.ok) return { ok: false, conflict: true, hash: r.hash };
    return { ok: true, hash: sceneHash(next), changed: true };
  });
}

export type RenameResult = { ok: true; hash: string; path: string } | { ok: false; conflict: true; hash: string };

/**
 * Give a scene a new name: its <title>, and for a stream's own scene (not a stream's copy of a
 * project scene, whose file name is what ties it to the project's) its file name too, within its
 * folder. Same hash rule as editScene.
 */
export function renameScene(root: string, path: string, hash: string, name: unknown): Promise<RenameResult> {
  return serial(async (): Promise<RenameResult> => {
    const real = await realScene(root, path);
    const read = await stat(real);
    const text = await readFile(real, "utf8");
    const current = sceneHash(text);
    if (current !== hash) return { ok: false, conflict: true, hash: current };
    const next = setTitle(text, String(name ?? ""));
    if (next !== text) {
      const r = await replaceChecked(real, read, current, next, {});
      if (!r.ok) return { ok: false, conflict: true, hash: r.hash };
    }
    const parts = path.split("/");
    const file = parts[parts.length - 1]!.slice(0, -5);
    // <org>/projects/<project>/streams/<stream>/<file>.html
    const inStream = parts.length === 6 && parts[1] === "projects" && parts[3] === "streams";
    const override = inStream && (await stat(inside(root, `${parts[0]}/projects/${parts[2]}/scenes/${file}.html`)).then(() => true, () => false));
    const base = slugify(String(name));
    if (!inStream || override || !base || base === file) return { ok: true, hash: sceneHash(next), path };
    // Never over another scene in the folder, nor onto a name the project uses (that would make it an override).
    // The scene's own entry in the folder (a link is renamed as a link).
    const own = scenePath(root, path);
    const dir = dirname(own);
    let free = base;
    for (let n = 2; ; n++) {
      const taken = await stat(join(dir, `${free}.html`)).then(() => true, () => false);
      const shadows = await stat(inside(root, `${parts[0]}/projects/${parts[2]}/scenes/${free}.html`)).then(() => true, () => false);
      if (!taken && !shadows) break;
      free = `${base}-${n}`;
    }
    plainName(`${free}.html`);
    await rename(own, join(dir, `${free}.html`));
    return { ok: true, hash: sceneHash(next), path: [...parts.slice(0, -1), `${free}.html`].join("/") };
  });
}
