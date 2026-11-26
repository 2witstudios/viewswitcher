// Any library file an agent reads or writes over MCP (scenes, theme CSS, org.json, BRAND.md...),
// under the switcher's rules: paths start with an existing org, never a dot-folder (.git,
// .viewswitcher), text files only, and a file that exists is only replaced with the hash of the
// version that was read (the same hash the scene editor uses, so the two never overwrite each other).
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { isTextFile, isViewPath, orgOf, parseLibraryPath, slugify, TEXT_EXTENSIONS } from "@viewswitcher/shared";
import { existingOrg } from "./library-actions";
import { resolveInLibrary } from "./library/contain";
import { inside, PathError } from "./paths";
import { replaceChecked, sceneHash, serial } from "./scene-edit";

export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/**
 * A library path an agent gave: inside an existing org, never in a dot-folder, and (through any links)
 * really inside the library, or for a new file, its nearest existing folder is (library/contain.ts).
 * Agents never read the staged pack preview either, so their reads follow the write rule.
 */
export async function checked(root: string, path: unknown): Promise<{ path: string; abs: string }> {
  const p = String(path ?? "").replace(/\/+$/, "");
  await resolveInLibrary(root, p, { forWrite: true });
  await existingOrg(root, orgOf(p));
  return { path: p, abs: inside(root, p) };
}

/** A scene's name, as a template pack's views and the switcher's own new scenes have them (slugify). */
const SCENE_NAME = /^[a-z0-9][a-z0-9-]{0,60}$/;

/**
 * Why a page (an .html) an agent writes can't be written there, or null. Scenes follow the template
 * pack rules (template-pack.ts planPack): exactly ".html", which is how the switcher lists them
 * ("brb.HTML" would sit unseen), and a new one is named like a pack's views (lower-case letters,
 * numbers and dashes) in a folder where scenes live. assets/ and _shared/ hold no pages, except a
 * transition, and a folder in templates/ holds scenes only when it's a set (its pack.json). A page
 * that exists is left as it is, whatever its name: this only decides where new ones go.
 */
export function pageProblem(path: string, exists: boolean, isSet: (dir: string) => boolean = () => true): string | null {
  const ext = extname(path);
  if (ext.toLowerCase() !== ".html" || exists) return null;
  if (ext !== ".html") return `Name it with a lower-case .html (${path.slice(0, -ext.length)}.html): the switcher only lists those.`;
  // Where it goes, by the folders the switcher lists scenes from (parseLibraryPath).
  const where = parseLibraryPath(path);
  // A folder in templates/ is a template set only with its pack.json (library.ts listSets).
  if (where.set && !isSet(where.set)) {
    return `templates/${where.set}/ isn't a template set (it has no pack.json), so the switcher doesn't list scenes in it. Put the scene in templates/, or add a set with add_template_set.`;
  }
  if (where.kind === "transition") return null;
  const name = where.name;
  if (!isViewPath(where)) {
    return `${path} isn't where scenes go. A new scene goes in templates/, a template set's folder, projects/<id>/scenes/ or projects/<id>/streams/<id>/ (assets/ and _shared/ hold no pages, except _shared/transition.html). Prefer scene_from_template, which picks the place and name.`;
  }
  if (!SCENE_NAME.test(name)) return `Name new scenes with lower-case letters, numbers and dashes, like "${slugify(name) || "my-scene"}.html"; its <title> is the name people see.`;
  return null;
}

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
  if (!isTextFile(p)) throw new PathError(`${p} isn't a text file (${TEXT_EXTENSIONS.join(", ")}). Scenes use it as /library/${p}, and it's at http://127.0.0.1:${port}/library/${encodeURI(p)}.`);
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
/**
 * Hooks that refuse a write by throwing: `beforeWrite` runs in turn, once the hashes check out and
 * the new text is staged; `atCommit` runs synchronously in the same tick as the rename or create, so
 * nothing can change between it and the write.
 */
export type WriteHooks = { beforeWrite?: () => unknown; atCommit?: () => void };

export function writeText(root: string, path: unknown, text: unknown, hash?: unknown, { beforeWrite, atCommit }: WriteHooks = {}): Promise<WriteResult> {
  return serial(async (): Promise<WriteResult> => {
    if (typeof text !== "string") throw new PathError("text must be a string");
    const { path: p, abs } = await checked(root, path);
    if (!isTextFile(p)) throw new PathError(`Only text files can be written (${TEXT_EXTENSIONS.join(", ")}). Add images and other media with add_asset.`);
    if (Buffer.byteLength(text) > MAX_TEXT_BYTES) throw new PathError("That's over 2 MB, too big for a library text file");
    const real = await realpath(abs).catch(() => null);
    const page = pageProblem(p, !!real, (set) => existsSync(inside(root, `${orgOf(p)}/templates/${set}/pack.json`)));
    if (page) throw new PathError(page);
    if (real) {
      const read = await stat(real);
      if (!read.isFile()) throw new PathError(`${p} is a folder`);
      const current = await readFile(real, "utf8");
      const now = sceneHash(current);
      if (hash === undefined || hash === null || hash === "") return { ok: false, path: p, hash: now, reason: `${p} already exists. read_file it first and pass its hash, so you change what's really there.` };
      if (hash !== now) return { ok: false, path: p, hash: now, reason: `${p} changed since you read it (someone saved it in the switcher or another tool). read_file it again and redo your change on the new text.` };
      if (current === text) return { ok: true, path: p, hash: now, created: false, changed: false };
      const r = await replaceChecked(real, read, now, text, { beforeReplace: async () => void (await beforeWrite?.()), atRename: atCommit });
      if (!r.ok) return { ok: false, path: p, hash: r.hash, reason: `${p} changed while you were writing it. read_file it again and redo your change.` };
      return { ok: true, path: p, hash: sceneHash(text), created: false, changed: true };
    }
    if (hash !== undefined && hash !== null && hash !== "") return { ok: false, path: p, hash: null, reason: `${p} doesn't exist any more. Leave out hash to create it.` };
    await beforeWrite?.();
    await mkdir(dirname(abs), { recursive: true });
    try {
      atCommit?.();
      await writeFile(abs, text, { flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const latest = await readFile(abs, "utf8").catch(() => "");
      return { ok: false, path: p, hash: sceneHash(latest), reason: `${p} was just created by someone else. read_file it and redo your change.` };
    }
    return { ok: true, path: p, hash: sceneHash(text), created: true, changed: true };
  });
}
