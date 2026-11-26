// Small reads the library listing and the org list share. `io` runs each file-system call: a scan
// passes its bounded queue (scanner.ts), everything else runs them as they come.
import { readdir, readFile } from "node:fs/promises";

export type Io = <T>(run: () => Promise<T>) => Promise<T>;
const direct: Io = (run) => run();

/** The folders in `path` the library lists (no dot- or "_" folders), sorted; none when it can't be read. */
export async function dirs(path: string, io: Io = direct): Promise<string[]> {
  try {
    const entries = await io(() => readdir(path, { withFileTypes: true }));
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("_")).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

/** A JSON file over `fallback`'s fields; `fallback` when it's missing or can't be parsed. */
export async function readJson<T>(path: string, fallback: T, io: Io = direct): Promise<T> {
  try {
    return { ...fallback, ...JSON.parse(await io(() => readFile(path, "utf8"))) };
  } catch {
    return fallback;
  }
}
