// Renames that behave the same on macOS and Windows.
//
// - claimRename: move a staged folder to a name nobody has, atomically, failing with EEXIST when the name
//   is taken. POSIX rename replaces an empty folder quietly, so there the name is claimed first with a
//   plain mkdir and the staged folder renamed onto it. Windows never replaces a folder on rename (it
//   refuses with EPERM even when the target is empty), so there the rename alone is the claim.
// - renameOver: replace a file with a finished copy. Windows refuses (EPERM, EBUSY, EACCES) while another
//   handle has the target open without delete sharing, a reader or the file watcher for an instant, so
//   there it is tried again for a short while.
import { lstat, mkdir, rename, rmdir } from "node:fs/promises";

export const WINDOWS = process.platform === "win32";

const busy = (e: unknown) => ["EPERM", "EBUSY", "EACCES"].includes((e as NodeJS.ErrnoException).code ?? "");

function exists(): NodeJS.ErrnoException {
  const e = new Error("EEXIST: file already exists") as NodeJS.ErrnoException;
  e.code = "EEXIST";
  return e;
}

/** Move the folder `from` to `to`, which must not exist yet: EEXIST when it does (or appears meanwhile). */
export async function claimRename(from: string, to: string, win = WINDOWS): Promise<void> {
  if (win) {
    try {
      await rename(from, to);
    } catch (e) {
      // Anything already at `to` (a folder, a file, a link) makes the rename fail: it was taken.
      if (await lstat(to).then(() => true, () => false)) throw exists();
      throw e;
    }
    return;
  }
  await mkdir(to); // EEXIST when taken
  await rename(from, to).catch(async (e) => {
    await rmdir(to).catch(() => {}); // only if still empty: never someone else's files
    throw e;
  });
}

/** rename(from, to), replacing `to`, tried again on Windows while something briefly holds `to` open. */
export async function renameOver(from: string, to: string, { win = WINDOWS, forMs = 2000 } = {}): Promise<void> {
  const until = Date.now() + forMs;
  for (let wait = 10; ; wait = Math.min(wait * 2, 200)) {
    try {
      return await rename(from, to);
    } catch (e) {
      if (!win || !busy(e) || Date.now() > until) throw e;
      await Bun.sleep(wait);
    }
  }
}
