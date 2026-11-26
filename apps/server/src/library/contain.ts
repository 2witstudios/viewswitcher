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
import { existsSync, realpathSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
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
 * PathError. `forWrite`: the path will be written, so a staged pack's covers are refused too. A path
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
    if (await lstat(at).then(() => true, () => false)) {
      const real = await realpath(at).catch(() => null);
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
