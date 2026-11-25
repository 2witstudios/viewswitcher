// Any library file an agent reads or writes over MCP (scenes, theme CSS, org.json, BRAND.md...),
// under the switcher's rules: paths start with an existing org, never a dot-folder (.git,
// .viewswitcher), text files only, and a file that exists is only replaced with the hash of the
// version that was read (the same hash the scene editor uses, so the two never overwrite each other).
import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative } from "node:path";
import { existingOrg } from "./library-actions";
import { inside, PathError } from "./paths";
import { replaceChecked, sceneHash, serial } from "./scene-edit";

export const TEXT_TYPES = [".html", ".css", ".js", ".json", ".md", ".svg", ".txt"];
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/** A library path checked segment by segment: org first, no dot-files or dot-folders, nothing empty. */
/**
 * A library path an agent gave: inside an existing org, never in a dot-folder, and (through any links)
 * really inside the library, or for a new file, its nearest existing folder is.
 */
export async function checked(root: string, path: unknown): Promise<{ path: string; abs: string }> {
  const p = String(path ?? "").replace(/\/+$/, "");
  const parts = p.split("/");
  if (!p || parts.some((s) => !s || s.startsWith(".") || s.includes("\\") || s.includes("\0") || s.length > 255)) {
    throw new PathError(`Bad path: ${p || "(empty)"}. Paths start with the org id, like "my-channel/templates/brb.html", and never go into dot-folders.`);
  }
  await existingOrg(root, parts[0]);
  const abs = inside(root, p);
  // A link may point anywhere: what it really reaches (or, for a new file, its nearest folder) must be in the library.
  let probe = abs;
  while (!(await stat(probe).then(() => true, () => false))) probe = dirname(probe);
  const back = relative(await realpath(root), await realpath(probe));
  if (back.startsWith("..") || isAbsolute(back)) throw new PathError("That path is a link to somewhere outside the library");
  return { path: p, abs };
}

const isText = (path: string) => TEXT_TYPES.includes(extname(path).toLowerCase());

export type Entry = { name: string; path: string; type: "file" | "dir"; size: number };

/** An org's folder, or a folder in it: what's there, dot-files left out. */
export async function listFiles(root: string, path: unknown): Promise<Entry[]> {
  const { path: p, abs } = await checked(root, path);
  const s = await stat(abs).catch(() => null);
  if (!s) throw new PathError(`There's nothing at ${p}`);
  if (!s.isDirectory()) throw new PathError(`${p} is a file. Use read_file for it.`);
  const entries = await Promise.all(
    (await readdir(abs, { withFileTypes: true }))
      .filter((e) => !e.name.startsWith("."))
      .map(async (e) => {
        const st = await stat(join(abs, e.name)).catch(() => null);
        const type = st?.isDirectory() ? ("dir" as const) : ("file" as const);
        return { name: e.name, path: `${p}/${e.name}`, type, size: type === "file" ? (st?.size ?? 0) : 0 };
      }),
  );
  return entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
}

/** A text file and the hash to write it back with. */
export async function readText(root: string, path: unknown, port: number): Promise<{ text: string; hash: string }> {
  const { path: p, abs } = await checked(root, path);
  const s = await stat(abs).catch(() => null);
  if (!s) throw new PathError(`There's no file at ${p}`);
  if (s.isDirectory()) throw new PathError(`${p} is a folder. Use list_files for it.`);
  if (!isText(p)) throw new PathError(`${p} isn't a text file (${TEXT_TYPES.join(", ")}). Scenes use it as /library/${p}, and it's at http://127.0.0.1:${port}/library/${encodeURI(p)}.`);
  if (s.size > MAX_TEXT_BYTES) throw new PathError(`${p} is over 2 MB, too big to read here`);
  const text = await readFile(abs, "utf8");
  return { text, hash: sceneHash(text) };
}

export type WriteResult =
  | { ok: true; path: string; hash: string; created: boolean; changed: boolean }
  | { ok: false; path: string; hash: string | null; reason: string };

/**
 * Write a text file. An existing file needs `hash` from read_file and is replaced only if it is still
 * that version; a new one is created only when `hash` is left out. Missing folders are made; nothing
 * is ever moved or deleted.
 */
/** `beforeWrite` runs in turn, right before anything is written, and throws to refuse the write. */
export function writeText(root: string, path: unknown, text: unknown, hash?: unknown, { beforeWrite }: { beforeWrite?: () => unknown } = {}): Promise<WriteResult> {
  return serial(async (): Promise<WriteResult> => {
    if (typeof text !== "string") throw new PathError("text must be a string");
    const { path: p, abs } = await checked(root, path);
    if (!isText(p)) throw new PathError(`Only text files can be written (${TEXT_TYPES.join(", ")}). Add images and other media with add_asset.`);
    if (Buffer.byteLength(text) > MAX_TEXT_BYTES) throw new PathError("That's over 2 MB, too big for a library text file");
    const real = await realpath(abs).catch(() => null);
    if (real) {
      const read = await stat(real);
      if (!read.isFile()) throw new PathError(`${p} is a folder`);
      const current = await readFile(real, "utf8");
      const now = sceneHash(current);
      if (hash === undefined || hash === null || hash === "") return { ok: false, path: p, hash: now, reason: `${p} already exists. read_file it first and pass its hash, so you change what's really there.` };
      if (hash !== now) return { ok: false, path: p, hash: now, reason: `${p} changed since you read it (someone saved it in the switcher or another tool). read_file it again and redo your change on the new text.` };
      if (current === text) return { ok: true, path: p, hash: now, created: false, changed: false };
      await beforeWrite?.();
      const r = await replaceChecked(real, read, now, text, {});
      if (!r.ok) return { ok: false, path: p, hash: r.hash, reason: `${p} changed while you were writing it. read_file it again and redo your change.` };
      return { ok: true, path: p, hash: sceneHash(text), created: false, changed: true };
    }
    if (hash !== undefined && hash !== null && hash !== "") return { ok: false, path: p, hash: null, reason: `${p} doesn't exist any more. Leave out hash to create it.` };
    await beforeWrite?.();
    await mkdir(dirname(abs), { recursive: true });
    try {
      await writeFile(abs, text, { flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const latest = await readFile(abs, "utf8").catch(() => "");
      return { ok: false, path: p, hash: sceneHash(latest), reason: `${p} was just created by someone else. read_file it and redo your change.` };
    }
    return { ok: true, path: p, hash: sceneHash(text), created: true, changed: true };
  });
}
