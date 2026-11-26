// Small reads the library listing and the org list share. `io` runs each file-system call: a scan
// passes its bounded queue (scanner.ts), everything else runs them as they come.
import { readdir } from "node:fs/promises";
import { isListedFolder } from "@viewswitcher/shared";
import { readNoFollow } from "./contain";

export type Io = <T>(run: () => Promise<T>) => Promise<T>;
const direct: Io = (run) => run();

/** The folders in `path` the library lists (isListedFolder: no dot- or "_" folders), sorted; none when it can't be read. */
export async function dirs(path: string, io: Io = direct): Promise<string[]> {
  try {
    const entries = await io(() => readdir(path, { withFileTypes: true }));
    return entries.filter((e) => e.isDirectory() && isListedFolder(e.name)).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

/**
 * A JSON file over `fallback`'s fields; `fallback` when it's missing, can't be parsed, or isn't a plain
 * file. `path` must be a real path (resolveInLibrary gives one): it's read with no link in it and
 * without blocking (contain.ts readNoFollow), so a named pipe can't hang a scan.
 */
export async function readJson<T>(path: string, fallback: T, io: Io = direct): Promise<T> {
  try {
    return { ...fallback, ...JSON.parse(await io(() => readNoFollow(path))) };
  } catch {
    return fallback;
  }
}
