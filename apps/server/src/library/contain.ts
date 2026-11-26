// The one rule for where a library path may lead, for every /library/ read, every write the switcher
// makes, and every file an agent reads or writes. Scenes and template packs come from anyone, so:
//
// - the path never goes into a dot-folder or dot-file (.git, .viewswitcher,
//   .env), except the covers copy of a staged template pack, which the switcher shows as covers
//   before anyone says Install (<org>/.viewswitcher/staging/<token>/covers/…), and only to read;
// - and what it really reaches, through any links, is inside the library and obeys the same rule.
//   A link inside the library may point at another place in it, never outside it, and never at a
//   dot-folder in it. For a path that doesn't exist yet, its nearest existing folder is checked: a
//   folder that isn't there yet will be made inside.
//
// Paths still go through inside() and plainName() (paths.ts) first; this adds what the real files say.
import { closeSync, constants, existsSync, fstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { type FileHandle, lstat, mkdir, open, realpath, rename, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { inside, PathError } from "../paths";

/** Where a staged template pack is unpacked, inside its org (packs.ts). */
export const STAGING = ".viewswitcher/staging";
/** A staged pack's token: 24 hex characters (packs.ts). */
export const STAGING_TOKEN = /^[a-f0-9]{24}$/;

/** "<org>/.viewswitcher/staging/<token>/covers/…": the one dot-path anyone may read. */
const STAGING_COVERS = /^[^/]+\/\.viewswitcher\/staging\/[a-f0-9]{24}\/covers\/[^.]/;

const badPath = (p: string) =>
  new PathError(`Bad path: ${p || "(empty)"}. Paths start with the show's id, like "my-show/templates/brb.html", and never go into dot-folders.`);
const outside = () => new PathError("That path is a link to somewhere outside the library");
const noPermission = () => new PathError("That path can't be read (no permission)");

/**
 * A file-system error as a refusal when it says something about the path (no permission), else as it is:
 * a disk error, or too many open files, is the switcher's trouble right now, not the path's, and callers
 * that must fail safe (the agents' on-air guard) need to tell the two apart.
 */
const asRefusal = (e: unknown): unknown => {
  const code = (e as NodeJS.ErrnoException)?.code;
  return code === "EACCES" || code === "EPERM" ? noPermission() : e;
};

/** Whether a library path (org first, "/"-separated) obeys the dot rule. */
function plainPath(p: string, forWrite: boolean): boolean {
  const parts = p.split("/");
  if (parts.some((s) => !s || s.includes("\\") || s.includes("\0") || s.length > 255)) return false;
  // The staging covers' own segments are fixed; the org before them and what follows them obey the rule like anything else.
  const skip = !forWrite && STAGING_COVERS.test(p) ? 4 : 0;
  return !parts[0]!.startsWith(".") && parts.slice(1 + skip).every((s) => !s.startsWith("."));
}

/**
 * The absolute file a client's library path (`daisy/projects/…`) leads to, through any links, or a
 * PathError (refused: a dot-path, a link out of the library or to nowhere, no permission). Any other
 * file-system error (a disk error, too many open files) is thrown as it is: it's not about the path.
 * `forWrite`: the path will be written, so a staged pack's covers are refused too. A path
 * that exists comes back as its real file; one that doesn't, inside its nearest real folder.
 */
export async function resolveInLibrary(libraryRoot: string, clientPath: unknown, { forWrite = false }: { forWrite?: boolean } = {}): Promise<string> {
  const p = String(clientPath ?? "");
  if (!plainPath(p, forWrite)) throw badPath(p);
  const abs = inside(libraryRoot, p);
  const realRoot = await realpath(libraryRoot).catch(() => libraryRoot);
  let rest = "";
  for (let at = abs; at.length > libraryRoot.length; at = dirname(at)) {
    // lstat, not stat: a link that points nowhere is there, and writing through it could land anywhere.
    const there = await lstat(at).then(
      () => true,
      (e) => {
        // Not there (yet): check the folder it would be made in. Anything else is said as it is.
        const code = (e as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") return false;
        // A folder on the way that's a link loop, or a path too long to be one: it leads nowhere in the library.
        if (code === "ELOOP" || code === "ENAMETOOLONG") throw outside();
        throw asRefusal(e);
      },
    );
    if (there) {
      // A link that points nowhere (ENOENT) or at itself (ELOOP) leads nowhere in the library.
      const real = await realpath(at).catch((e) => {
        const code = (e as NodeJS.ErrnoException).code;
        // Dangling, looping, through a file (a.css → brb.html/x), or too long: it leads nowhere in the library.
        if (code === "ENOENT" || code === "ELOOP" || code === "ENOTDIR" || code === "ENAMETOOLONG") return null;
        throw asRefusal(e);
      });
      if (real === null) throw outside();
      const back = relative(realRoot, real);
      if (!back || back.startsWith("..") || isAbsolute(back)) throw outside();
      if (!plainPath(back.split(sep).join("/") + rest, forWrite)) throw badPath(p);
      return rest ? join(real, rest) : real;
    }
    rest = `/${basename(at)}${rest}`;
  }
  return abs;
}

/**
 * An org's staging folder (<org>/.viewswitcher/staging), where template packs are unpacked before
 * anyone says Install and which the hourly sweep clears, or a PathError. The org folder must really be
 * in the library (it may be a link to another place in it), and neither .viewswitcher/ nor staging/ may
 * be a link at all: a pack is written there and anything older than an hour deleted, so a link would
 * aim both at wherever it points. Folders that aren't there yet are made by whoever writes.
 */
export const stagingIn = async (libraryRoot: string, orgId: string): Promise<string> => plainStaging(await resolveInLibrary(libraryRoot, orgId, { forWrite: true }));

/**
 * The library's own staging folder (<library>/.viewswitcher/staging), where a new org is filled in
 * before it's renamed into place; the same rule as an org's (no links), or a PathError.
 */
export const libraryStaging = (libraryRoot: string): Promise<string> => plainStaging(libraryRoot);

async function plainStaging(dir: string): Promise<string> {
  let at = dir;
  for (const part of STAGING.split("/")) {
    at = join(at, part);
    const s = await lstat(at).catch(() => null);
    // A link or a file where a folder should be: never followed, never replaced.
    if (s && !s.isDirectory()) throw new PathError("A staging folder (.viewswitcher/staging) is a link or a file; the switcher only stages into a plain folder in the library");
  }
  return at;
}

/**
 * `dir` as a plain folder, or nothing there yet: a link or a file at `dir` is moved aside (kept, renamed
 * `<dir>.moved-aside-<time>`) and never followed or deleted. Returns where it was moved, or null when
 * there was nothing to move. A rename that fails says so plainly (a read-only library, say).
 */
/** Heals in progress, by folder: writes that find the same link at once share one move. */
const healing = new Map<string, Promise<string | null>>();

export function plainFolder(dir: string, now = new Date()): Promise<string | null> {
  let heal = healing.get(dir);
  if (!heal) {
    heal = moveAside(dir, now).finally(() => healing.delete(dir));
    healing.set(dir, heal);
  }
  return heal;
}

async function moveAside(dir: string, now: Date): Promise<string | null> {
  const s = await lstat(dir).catch(() => null);
  if (!s || s.isDirectory()) return null;
  const aside = `${dir}.moved-aside-${now.toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 4)}`;
  try {
    await rename(dir, aside);
  } catch (e) {
    // Another process healed it a moment ago: what's there now is its plain folder, or nothing yet.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      const now = await lstat(dir).catch(() => null);
      if (!now || now.isDirectory()) return null;
    }
    throw new Error(`${dir} is a link or a file, and it couldn't be moved aside (${(e as Error).message}). Move or remove it, then start ViewSwitcher again.`);
  }
  console.error(`[library] ${basename(dir)} was a link or a file, so it was moved aside to ${aside} and a plain folder takes its place`);
  return aside;
}

/**
 * The library's own state folder (<library>/.viewswitcher: state.json, settings.json, devices.json,
 * kit.json) as a plain folder. A cloned library can carry a link (or a file) there, and a `git pull`
 * can put one there while the server runs (the local folder is gitignored, so git replaces it), and the
 * switcher would write its state and pairings wherever it points. So it's checked at startup, and
 * again by every state write (writeAtomic's `plainParent`) and settings read.
 */
export async function plainStateFolder(libraryRoot: string, now = new Date()): Promise<string | null> {
  const dir = join(libraryRoot, ".viewswitcher");
  const aside = await plainFolder(dir, now);
  if (aside) {
    // The person's agent setting went with the old folder (git deletes a gitignored folder it replaces).
    // Fail closed: the fresh folder says agents may put nothing on air until they choose again.
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "settings.json"), JSON.stringify({ agentOnAir: "never" }, null, 2) + "\n", { flag: "wx" }).catch(() => {});
  }
  return aside;
}

/**
 * Where a library path really is (through links), as a library path, or the path itself when that
 * can't be told. Synchronous, for checks that must happen at one instant (the agents' on-air guard).
 */
export function realLibraryPath(libraryRoot: string, path: string): string {
  try {
    const realRoot = realpathSync(libraryRoot);
    let probe = inside(libraryRoot, path);
    let rest = "";
    while (!existsSync(probe)) {
      rest = `/${basename(probe)}${rest}`;
      probe = dirname(probe);
    }
    const back = relative(realRoot, realpathSync(probe)) + rest;
    return back.startsWith("..") || isAbsolute(back) ? path : back;
  } catch {
    return path;
  }
}

/**
 * No link anywhere in the path: macOS's O_NOFOLLOW_ANY (0x20000000, not in Node's constants), so a
 * folder swapped for a link after the scan checked it gives ELOOP too. Elsewhere, the last segment only.
 * (Together with O_NOFOLLOW, macOS refuses the open with EINVAL.)
 */
export const NO_LINKS = process.platform === "darwin" ? 0x20000000 : constants.O_NOFOLLOW;

/**
 * `use` on the file at `abs`, opened only when no part of `abs` is a link (NO_LINKS) and it's a plain
 * file: `abs` must be a real path (resolveInLibrary gives one). O_NONBLOCK so a named pipe or a device
 * named like a view can't hang the open; it's refused right after, by its type. Every read of a library
 * file the switcher reads in full on its own (titles, hashes, the editor's copy, a pack install) uses this.
 */
export async function withNoLinks<T>(abs: string, use: (f: FileHandle) => Promise<T>): Promise<T> {
  const f = await open(abs, constants.O_RDONLY | constants.O_NONBLOCK | NO_LINKS).catch((e) => {
    // A path that became a link since it was checked is refused like one that was a link then (a 400, not a 500).
    throw (e as NodeJS.ErrnoException).code === "ELOOP" ? outside() : e;
  });
  try {
    if (!(await f.stat()).isFile()) throw new PathError("That isn't a plain file (a folder, a named pipe or a device?)");
    return await use(f);
  } finally {
    await f.close();
  }
}

/**
 * A file's text through a non-blocking open of a plain file, following links: for files that are the
 * person's own arrangement, where a link is fine (the library's .claude/ and its kit files), but a named
 * pipe must still never hang a read.
 */
export async function readPlainText(abs: string): Promise<string> {
  const f = await open(abs, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!(await f.stat()).isFile()) throw new PathError("That isn't a plain file (a folder, a named pipe or a device?)");
    return await f.readFile("utf8");
  } finally {
    await f.close();
  }
}

/** readNoFollow at one instant (the agents' on-air guard checks at a commit): the same open, synchronously. */
export function readNoFollowSync(abs: string): string {
  const fd = openSync(abs, constants.O_RDONLY | constants.O_NONBLOCK | NO_LINKS);
  try {
    if (!fstatSync(fd).isFile()) throw new PathError("That isn't a plain file (a folder, a named pipe or a device?)");
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

/** A file's text, read only when no part of `abs` is a link and it's a plain file. */
export const readNoFollow = (abs: string) => withNoLinks(abs, (f) => f.readFile("utf8"));

/**
 * A file's bytes, the same way. `single`: refused when the file has another name too (a hard link), as
 * nothing the switcher wrote itself does, so a staged file can't be one to a file outside the library.
 */
export const readNoFollowBytes = (abs: string, { single = false }: { single?: boolean } = {}) =>
  withNoLinks(abs, async (f) => {
    if (single && (await f.stat()).nlink !== 1) throw new Error("has another name (a hard link)");
    return new Uint8Array(await f.readFile());
  });
