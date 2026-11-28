// Responses never carry absolute paths (AGENTS.md), but a filesystem error names the file it failed
// on. This takes the library's folder out of a message: a path inside it becomes the library path
// people know ("daisy/templates/brb.html"), and the folder itself "the library". Both spellings are
// scrubbed, because macOS reports /var/… as /private/var/… once a link is followed. On Windows a path
// inside it is written with backslashes, and any case: it comes out as the same "/" library path.
import { realpathSync } from "node:fs";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A scrub for messages about the library at `root`. */
export function pathScrub(root: string, win = process.platform === "win32"): (message: string) => string {
  const real = (() => {
    try {
      return realpathSync(root);
    } catch {
      return root;
    }
  })();
  // Longest first: one spelling may contain the other.
  const roots = [...new Set([real, root])].sort((a, b) => b.length - a.length);
  if (!win) return (message) => roots.reduce((t, r) => t.split(`${r}/`).join("").split(r).join("the library"), String(message));
  // A Windows path ends at a quote, a line end, or the end: "lstat 'C:\…\daisy\x.html'" → "lstat 'daisy/x.html'".
  const patterns = roots.map((r) => new RegExp(`${escape(r.replace(/[\\/]+$/, ""))}(?:[\\\\/]([^'"\\n]*))?`, "gi"));
  return (message) => patterns.reduce((t, re) => t.replace(re, (_, rest?: string) => (rest ? rest.replaceAll("\\", "/") : "the library")), String(message));
}
