import { isAbsolute, relative, resolve, sep } from "node:path";

export class PathError extends Error {}

/** Resolve a library-relative path, refusing anything that escapes the library. */
export function inside(root: string, rel: string): string {
  if (typeof rel !== "string" || rel.length === 0 || rel.includes("\0")) throw new PathError("Bad path");
  const abs = resolve(root, rel.replace(/^\/+/, ""));
  const back = relative(root, abs);
  if (back === "" || back.startsWith("..") || isAbsolute(back) || back.split(sep).includes("..")) {
    throw new PathError(`Path escapes the library: ${rel}`);
  }
  return abs;
}

/** A single file or folder name: no separators, no dot-files. */
export function plainName(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,120}$/.test(name) || name.includes("..")) throw new PathError(`Bad name: ${name}`);
  return name;
}
