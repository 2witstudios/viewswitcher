// The library files a scene loads: its <link>, <script>, <img>, <video>, <audio>, <source>,
// <track> and <iframe> targets, inline SVG's <image> and <use>, CSS url()/@import/image-set() targets
// and the modules a script imports, resolved the way a browser resolves them
// from /library/<file>. The agent guard uses it so that, while live, an agent can't change a logo or
// a stylesheet the scene on air shows. Anything outside the library (other sites, data: URLs, the
// switcher's own routes) is left out. Reading text, not running it: a URL a script builds at run time
// isn't seen, so this narrows what an agent can change on air; it isn't a sandbox (agent-guard.ts).
import { libraryUrl } from "@viewswitcher/shared";
import { readNoFollow, resolveInLibrary } from "./library/contain";
import { PathError } from "./paths";

const BASE_HOST = "scene.invalid";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** A reference in `file` (a library path) as a library path, or null when it's not a library file. */
export function resolveRef(ref: string, file: string): string | null {
  const r = ref.trim();
  if (!r || r.startsWith("#")) return null;
  let u: URL;
  try {
    u = new URL(r, `http://${BASE_HOST}${libraryUrl(file)}`);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.host !== BASE_HOST && !LOOPBACK.has(u.hostname)) return null;
  if (!u.pathname.startsWith("/library/")) return null;
  try {
    const path = u.pathname.slice("/library/".length).split("/").map(decodeURIComponent).join("/");
    return path && !path.endsWith("/") ? path : null;
  } catch {
    return null;
  }
}

const TAG = /<(link|script|img|video|audio|source|track|iframe|image|use)\b([^>]*)>/gi;
const ATTR = /\b(src|href|poster|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gi;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*?))\s*\)/gi;
const CSS_IMPORT = /@import\s+(?:"([^"]*)"|'([^']*)')/gi;
const IMAGE_SET = /image-set\(([^)]*)\)/gi;
const QUOTED = /"([^"]*)"|'([^']*)'/g;
// import x from "y", import "y", export … from "y", import("y")
const INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const JS_IMPORT = /(?:\bimport\s*(?:[\w*{}\s,$]+\s*from\s*)?|\bexport\s*[\w*{}\s,$]+\s*from\s*|\bimport\s*\(\s*)(?:"([^"]+)"|'([^']+)')/g;

/** What `text` (the file at library path `file`) loads, as library paths, without duplicates. */
export function sceneRefs(source: string, file: string): string[] {
  const raw: string[] = [];
  const html = /\.html?$/i.test(file);
  // The few character references a URL in an attribute is written with (style="url(&quot;x&quot;)").
  const text = html ? source.replace(/&(amp|quot|apos|#39|#34);/g, (_, e: string) => ({ amp: "&", quot: '"', apos: "'", "#39": "'", "#34": '"' })[e]!) : source;
  if (html) {
    for (const [, , attrs] of text.matchAll(TAG)) {
      for (const m of attrs!.matchAll(ATTR)) {
        const value = m[2] ?? m[3] ?? m[4] ?? "";
        if (m[1]!.toLowerCase() === "srcset") raw.push(...value.split(",").map((c) => c.trim().split(/\s+/)[0] ?? ""));
        else raw.push(value);
      }
    }
    // A script written in the page (a module's `import "…"`, anyone's `import("…")`) loads files too.
    for (const [, attrs, body] of text.matchAll(INLINE_SCRIPT)) {
      if (/\bsrc\s*=/i.test(attrs!)) continue;
      for (const m of body!.matchAll(JS_IMPORT)) raw.push(m[1] ?? m[2] ?? "");
    }
  }
  if (/\.m?js$/i.test(file)) {
    for (const m of text.matchAll(JS_IMPORT)) raw.push(m[1] ?? m[2] ?? "");
  } else {
    // CSS: a stylesheet, or <style> blocks and style="" attributes inside a page.
    for (const m of text.matchAll(CSS_URL)) raw.push(m[1] ?? m[2] ?? m[3] ?? "");
    for (const m of text.matchAll(CSS_IMPORT)) raw.push(m[1] ?? m[2] ?? "");
    for (const [, inner] of text.matchAll(IMAGE_SET)) for (const q of inner!.matchAll(QUOTED)) raw.push(q[1] ?? q[2] ?? "");
  }
  const out = new Set<string>();
  for (const r of raw) {
    const p = resolveRef(r, file);
    if (p && p !== file) out.add(p);
  }
  return [...out];
}

/** What loadedFiles found. */
export type Loaded = {
  /** The library files the pages load, directly or through what they load. */
  files: string[];
  /** False when the scan stopped at its limit: there may be more, so the list can't be trusted to be all. */
  complete: boolean;
  /** Every file it read (the pages too), with a hash of the text it read, to tell later if any changed. */
  read: Record<string, string>;
  /** Files that are there but couldn't be read (a link out of the library, a named pipe): what they load is unknown. */
  unreadable: string[];
};

/** A hash of a file's text, for Loaded.read. */
export const textHash = (text: string) => Bun.hash(text).toString(36);

/**
 * Everything `pages` load, following the pages, stylesheets and scripts they load in turn (a theme's
 * fonts and pictures, a module's imports), at most `limit` files. Files that can't be read are still
 * listed: a missing logo the scene asks for would show the moment an agent created it.
 */
export async function loadedFiles(root: string, pages: string[], limit = 200): Promise<Loaded> {
  const seen = new Set<string>(pages);
  const queue = [...pages];
  const found: string[] = [];
  const read: Record<string, string> = {};
  const unreadable: string[] = [];
  let complete = true;
  while (queue.length) {
    const file = queue.shift()!;
    if (!/\.(html?|css|m?js)$/i.test(file)) continue;
    let failure: unknown = null;
    const text = await Promise.resolve()
      .then(() => resolveInLibrary(root, file).then(readNoFollow))
      .catch((e) => ((failure = e), null));
    if (text === null) {
      // What /library/ refuses too (a link out, a dot-folder, a folder, a pipe: a PathError) or what isn't
      // there loads nothing on the page. Any other failure (EACCES, EIO) leaves what it loads unknown, so the
      // guard treats the list as not all (agent-guard.ts "unreadable").
      const code = (failure as NodeJS.ErrnoException | null)?.code;
      if (!(failure instanceof PathError) && code !== "ENOENT" && code !== "ENOTDIR") unreadable.push(file);
      continue;
    }
    read[file] = textHash(text);
    for (const ref of sceneRefs(text, file)) {
      if (seen.has(ref)) continue;
      if (found.length >= limit) {
        complete = false;
        break;
      }
      seen.add(ref);
      found.push(ref);
      queue.push(ref);
    }
    if (!complete) break;
  }
  return { files: found, complete, read, unreadable };
}
