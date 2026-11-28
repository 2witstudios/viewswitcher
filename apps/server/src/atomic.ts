// The one writer for files the switcher rewrites in place (the on-air record, settings, paired
// phones, a project's manifest, the library kit's files): written whole or not at all, so a crash,
// a full disk or two writers at once never leave half a file for the next start to misread.
// (A scene the editor saves goes through scene-edit.ts replaceChecked, which also checks the file is
// still the version that was read; a new file that claims its name is an exclusive create instead.)
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { renameOver } from "./fsx";
import { plainFolder } from "./library/contain";

/**
 * Write `data` to a temp file beside `file`, then rename it over `file`. The temp name has a random
 * part, so two writes in flight never share (or rename) each other's half-written copy. `mode`
 * (devices.json's 0o600) is set on the copy before it takes the name, so the file is never readable
 * by others, even for a moment. With `plainParent` (the switcher's own state in .viewswitcher/), a
 * link or a file where its folder should be is moved aside first (contain.ts plainFolder), so the
 * write never goes through a link that appeared since the last one.
 */
export async function writeAtomic(file: string, data: string | Uint8Array, { mode, plainParent }: { mode?: number; plainParent?: boolean } = {}): Promise<void> {
  if (plainParent) await plainFolder(dirname(file));
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  try {
    await writeFile(tmp, data, { mode });
    if (mode !== undefined) await chmod(tmp, mode); // past the umask
    await renameOver(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}
