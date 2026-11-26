// Scene titles for the library listing, kept between scans: a file is read again only when it has
// changed (by its stat) or the watcher reported it. Every client lists the library after each change,
// and scene files can be megabytes (inline fonts), so reading each one in full every time added up.
import { dirname, resolve } from "node:path";
import { readTitle } from "@viewswitcher/shared";

/** What a stat says about a version of a file: its size, modification and change times, and inode. */
export type FileStamp = { size: number; mtimeMs: number; ctimeMs: number; ino: number | bigint };

/**
 * Times alone can be coarse (2 s on exFAT, 1 s on HFS+ and some shares), so a same-size save in the
 * same second keeps them. Most editors save by writing a new file and renaming it over the old one,
 * which gives it a new inode; an in-place write moves the change time where it's finer than mtime.
 * What neither catches, the watcher does (forget).
 */
const stampOf = (s: FileStamp) => `${s.size}:${s.mtimeMs}:${s.ctimeMs}:${s.ino}`;

export function createSceneTitles(fs: { stat: (abs: string) => Promise<FileStamp>; read: (abs: string) => Promise<string> }) {
  const kept = new Map<string, { stamp: string; title: string }>();
  return {
    /** A scene file's <title> ("" when it has none or can't be read). */
    async titleOf(abs: string): Promise<string> {
      const s = await fs.stat(abs).catch(() => null);
      if (!s) return "";
      const stamp = stampOf(s);
      const known = kept.get(abs);
      if (known?.stamp === stamp) return known.title;
      // Read after the stat: what's read is at least as new as the version it's kept under.
      const html = await fs.read(abs).catch(() => null);
      if (html === null) return "";
      const title = readTitle(html) ?? "";
      kept.set(abs, { stamp, title });
      return title;
    },

    /**
     * Paths that changed (the watcher's, relative to `root`): their titles are read again next time,
     * even if their stamp is the same. A folder drops everything inside it. Linear in the paths and
     * the titles kept, so a change to thousands of files at once (a git pull, a sync) doesn't hold
     * up the server.
     */
    forget(root: string, paths: string[]) {
      const folders = new Set<string>();
      // A path that was a title kept is done; any other may be a folder.
      for (const p of paths) {
        const abs = resolve(root, p);
        if (!kept.delete(abs)) folders.add(abs);
      }
      if (!folders.size) return;
      for (const key of kept.keys()) {
        for (let dir = dirname(key); dir !== dirname(dir); dir = dirname(dir)) {
          if (folders.has(dir)) {
            kept.delete(key);
            break;
          }
        }
      }
    },
  };
}
