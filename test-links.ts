// Links in tests on Windows. Making a symlink there needs an admin or Developer Mode (GitHub's Windows
// runners are admins); a junction, a link to a folder, needs neither. So when a symlink is refused
// (EPERM), one to a folder, or to nothing yet, is made a junction instead: lstat sees a link, realpath
// follows it, as the containment rules expect. A link to a file can't be made that way, and tests that
// need one skip with `test.skipIf(!fileLinks)`.
// Through require, never an import of node:fs: once a module imports its names, patching them below no longer reaches the tests.
const { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } = require("node:fs");
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const WINDOWS = process.platform === "win32";

/** Whether this machine can make a symlink to a file (always off Windows; on Windows only as admin or in Developer Mode). */
export const fileLinks: boolean = (() => {
  if (!WINDOWS) return true;
  const dir = mkdtempSync(join(tmpdir(), "vs-can-link-"));
  try {
    writeFileSync(join(dir, "f"), "");
    require("node:fs").symlinkSync(join(dir, "f"), join(dir, "l"), "file");
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

const refused = (e: unknown) => (e as NodeJS.ErrnoException).code === "EPERM";
/** Where a link at `path` to `target` points, as an absolute path (a junction needs one). */
const absTarget = (target: string, path: string) => resolve(dirname(String(path)), String(target));
const toFile = (target: string, path: string) => {
  const abs = absTarget(target, path);
  return existsSync(abs) && !statSync(abs).isDirectory();
};

/** A junction at `path` to `target` through mklink (Bun's own symlink(…, "junction") fails on Windows). */
function junction(target: string, path: string) {
  const p = Bun.spawnSync(["cmd", "/d", "/c", "mklink", "/J", resolve(String(path)), absTarget(target, path)], { stdout: "ignore", stderr: "pipe" });
  if (p.exitCode !== 0) throw Object.assign(new Error(`EPERM: couldn't make a junction at ${path}: ${p.stderr.toString().trim()}`), { code: "EPERM" });
}

export function linksForWindowsTests() {
  if (!WINDOWS || fileLinks) return;
  const fs = require("node:fs");
  const fsp = require("node:fs/promises");
  const sync = fs.symlinkSync;
  const async = fsp.symlink;
  fs.symlinkSync = (target: string, path: string, type?: string) => {
    try {
      return sync(target, path, type);
    } catch (e) {
      if (!refused(e) || toFile(target, path)) throw e;
      junction(target, path);
    }
  };
  fsp.symlink = async (target: string, path: string, type?: string) => {
    try {
      return await async(target, path, type);
    } catch (e) {
      if (!refused(e) || toFile(target, path)) throw e;
      junction(target, path);
    }
  };
}

/** Named pipes (mkfifo) and POSIX permission bits: macOS and Linux, never Windows. */
export const posix: boolean = !WINDOWS;
