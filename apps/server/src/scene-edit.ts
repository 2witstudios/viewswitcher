// The scene editor's file side: serve a scene tagged with element ids, and patch source ranges
// back into the file, refusing when the file changed since the editor loaded it.
import { chmod, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { applyEdits, EditError, tagForEdit } from "@viewswitcher/shared";
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

/** The scene with data-vs ids for the editor (and the program page). Reads only; never writes. */
export async function readForEdit(root: string, path: string) {
  const text = await readFile(scenePath(root, path), "utf8");
  const hash = sceneHash(text);
  return { html: tagForEdit(text, hash), hash };
}

/** Check one edit's shape: {id, text} or {id, left, top}. */
export function parseEdit(e: any): SceneEdit {
  // A real number only: Number(null) or Number("") would quietly become element 0.
  const id = e?.id;
  if (typeof id !== "number" || !Number.isInteger(id) || id < 0) throw new EditError("Each edit needs an element id");
  if (typeof e.text === "string") {
    if (e.text.length > 2000) throw new EditError("That text is too long for a scene");
    return { id, text: e.text };
  }
  const left = Number(e.left), top = Number(e.top);
  if (e.left == null || e.top == null || !Number.isFinite(left) || !Number.isFinite(top) || Math.abs(left) > 100_000 || Math.abs(top) > 100_000) {
    throw new EditError("Each edit is {id, text} or {id, left, top}");
  }
  return { id, left, top };
}

export type EditResult = { ok: true; hash: string; changed: boolean } | { ok: false; conflict: true; hash: string };

// Edits to the library run one at a time, so a read-compare-write can't interleave with another.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Apply `edits` (ids from the version with `hash`) and write the file once. If the file's hash
 * isn't `hash` any more, nothing is written and the result carries the current hash.
 */
export function editScene(
  root: string, path: string, hash: string, edits: unknown[],
  /** Tests only: runs between reading the file and replacing it. */
  hooks: { beforeReplace?: () => Promise<void> } = {},
): Promise<EditResult> {
  const run = async (): Promise<EditResult> => {
    const abs = scenePath(root, path);
    if (!Array.isArray(edits) || edits.length === 0 || edits.length > 100) throw new EditError("No edits to save");
    const parsed = edits.map(parseEdit);
    const real = await realpath(abs);
    const read = await stat(real);
    const text = await readFile(real, "utf8");
    const current = sceneHash(text);
    if (current !== hash) return { ok: false, conflict: true, hash: current };
    const next = applyEdits(text, parsed);
    if (next === text) return { ok: true, hash: current, changed: false };
    // A linked scene is written where it really lives (so the link stays a link), never outside the library.
    const back = relative(await realpath(root), real);
    if (back.startsWith("..") || isAbsolute(back)) throw new PathError("This scene is a link to a file outside the library");
    // Write beside it and rename, so nothing ever reads a half-written scene; keep its permissions.
    // The watcher ignores dot-files.
    const tmp = join(dirname(real), `.${basename(real)}.vs-${process.pid}-${Date.now()}`);
    await writeFile(tmp, next);
    await chmod(tmp, read.mode & 0o7777);
    await hooks.beforeReplace?.();
    // Someone else saved while this one was being written: theirs wins, this one is a conflict.
    const now = await stat(real).catch(() => null);
    if (!now || now.mtimeMs !== read.mtimeMs || now.size !== read.size) {
      await rm(tmp, { force: true });
      const latest = await readFile(real, "utf8").catch(() => "");
      return { ok: false, conflict: true, hash: sceneHash(latest) };
    }
    await rename(tmp, real);
    return { ok: true, hash: sceneHash(next), changed: true };
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}
