// The one writer for files the switcher rewrites in place (the on-air record, settings, paired
// phones, a project's manifest, the library kit's files): written whole or not at all, so a crash,
// a full disk or two writers at once never leave half a file for the next start to misread.
// (A scene the editor saves goes through scene-edit.ts replaceChecked, which also checks the file is
// still the version that was read; a new file that claims its name is an exclusive create instead.)
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Write `data` to a temp file beside `file`, then rename it over `file`. The temp name has a random
 * part, so two writes in flight never share (or rename) each other's half-written copy. `mode`
 * (devices.json's 0o600) is set on the copy before it takes the name, so the file is never readable
 * by others, even for a moment.
 */
export async function writeAtomic(file: string, data: string | Uint8Array, { mode }: { mode?: number } = {}): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  try {
    await writeFile(tmp, data, mode === undefined ? {} : { mode });
    if (mode !== undefined) await chmod(tmp, mode); // past the umask
    await rename(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}
