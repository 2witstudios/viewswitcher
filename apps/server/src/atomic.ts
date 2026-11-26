// Files the switcher rewrites in place (the on-air record, settings, a project's manifest) are
// written whole or not at all: a crash, a full disk or two writers at once must never leave half a
// file for the next start to misread.
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Write `data` to a temp file beside `file`, then rename it over `file`. The temp name has a random
 * part, so two writes in flight never share (or rename) each other's half-written copy.
 */
export async function writeAtomic(file: string, data: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}
