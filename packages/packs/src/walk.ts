// The one walk of a folder's files, for packs (a set's _shared/, a prebuilt pack), a new org's
// starter copy, and the scenes a set's files are linked from.
import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Every file under `dir`, as paths relative to it ("a/b.css"), sorted. Dot-files and dot-folders
 * (.DS_Store, .git) are left out; links are neither followed nor listed. A folder that can't be read
 * is skipped, not an error, unless it is `dir` itself.
 */
export async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (abs: string, rel: string, top: boolean) => {
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch (e) {
      if (top) throw e;
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(join(abs, e.name), path, false);
      else if (e.isFile()) out.push(path);
    }
  };
  await walk(dir, "", true);
  return out.sort();
}
