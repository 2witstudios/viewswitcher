// Responses never carry absolute paths (AGENTS.md), but a filesystem error names the file it failed
// on. This takes the library's folder out of a message: a path inside it becomes the library path
// people know ("daisy/templates/brb.html"), and the folder itself "the library". Both spellings are
// scrubbed, because macOS reports /var/… as /private/var/… once a link is followed.
import { realpathSync } from "node:fs";

/** A scrub for messages about the library at `root`. */
export function pathScrub(root: string): (message: string) => string {
  const real = (() => {
    try {
      return realpathSync(root);
    } catch {
      return root;
    }
  })();
  // Longest first: one spelling may contain the other.
  const roots = [...new Set([real, root])].sort((a, b) => b.length - a.length);
  return (message) => roots.reduce((t, r) => t.split(`${r}/`).join("").split(r).join("the library"), String(message));
}
