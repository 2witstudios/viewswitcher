import { isAbsolute, relative, resolve, sep } from "node:path";

export class PathError extends Error {}

/**
 * A path segment Windows would read as something other than a plain name: a backslash (a separator
 * there), a colon (a drive, or an NTFS alternate data stream: "brb.html:hidden"), the other characters
 * Windows forbids, a reserved device name (CON, NUL, COM1, …, with or without an extension), or a
 * trailing dot or space (which Windows strips, so "brb.html." would be brb.html).
 */
export const windowsUnsafe = (segment: string) =>
  /[\\:*?"<>|\x00-\x1f]/.test(segment) || /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i.test(segment) || /[. ]$/.test(segment);

/** Resolve a library-relative path, refusing anything that escapes the library. */
export function inside(root: string, rel: string, win = process.platform === "win32"): string {
  if (typeof rel !== "string" || rel.length === 0 || rel.includes("\0")) throw new PathError("Bad path");
  // On Windows a library path is still "/"-separated: anything Windows would read differently is refused.
  if (win && rel.replace(/^\/+/, "").split("/").some((s) => s !== "" && s !== "." && s !== ".." && windowsUnsafe(s))) throw new PathError(`Bad path: ${rel}`);
  const abs = resolve(root, rel.replace(/^\/+/, ""));
  const back = relative(root, abs);
  if (back === "" || back.startsWith("..") || isAbsolute(back) || back.split(sep).includes("..")) {
    throw new PathError(`Path escapes the library: ${rel}`);
  }
  return abs;
}

/** A single file or folder name: no separators, no dot-files (and nothing Windows reads as a device). */
export function plainName(name: string, win = process.platform === "win32"): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,120}$/.test(name) || name.includes("..") || (win && windowsUnsafe(name))) throw new PathError(`Bad name: ${name}`);
  return name;
}
