// Template packs: one portable folder or .zip with a full set of views, which installs into an
// org as its own template set. The format is in docs/template-packs.md; this is its validator. Pure: the
// server lists a zip's entries (or a dropped folder's files), asks `planPack` which of them to
// extract, then reads the text files and asks `checkPack` whether the result is a pack.
import { escapeHtml, scanElements } from "./html-scan";

/** The pack.json format this switcher reads. A newer pack says so plainly instead of half-installing. */
export const PACK_FORMAT = 1;

export const PACK_LIMITS = {
  /** Files that end up installed (junk like __MACOSX and hidden files is left out first). */
  files: 400,
  fileBytes: 25 * 1024 * 1024,
  totalBytes: 100 * 1024 * 1024,
  /** A .zip as uploaded (compressed). */
  zipBytes: 60 * 1024 * 1024,
  /** Characters in a path inside the pack, and folders deep. */
  pathLength: 200,
  depth: 5,
} as const;

/**
 * What the installer fills in, in every text file, from the org it installs into: {{ORG_NAME}} and
 * the rest, as in the starter kit, plus {{PACK}}, the set's folder as a URL
 * ("/library/<org>/templates/<set>"), so a view can link its own files from wherever it's copied.
 */
export const PACK_PLACEHOLDERS = ["ORG_ID", "ORG_NAME", "ORG_INITIAL", "ACCENT", "GROUND", "PACK"] as const;
export type PackPlaceholder = (typeof PACK_PLACEHOLDERS)[number];

const asTyped = (v: string) => v;
/**
 * The library's text files (the ones placeholders are filled in, and the ones agents may read and
 * write), each with how a placeholder's value is escaped in it. HTML in .html and .svg, so an org
 * named "R&B <Live>" reads as text and can't add markup; a JSON string in .json, like org.json's
 * name; in .css only a comment's end (star, slash) gets a space put in it, so a value can't close the comment it's in (the
 * starter's theme.css has the name in one; a value inside a CSS string isn't escaped for it); as
 * typed in .js, .md and .txt. A new text type has to say how it's escaped.
 */
const TEXT_TYPES = {
  ".html": (v: string) => escapeHtml(v),
  ".svg": (v: string) => escapeHtml(v),
  ".json": (v: string) => JSON.stringify(v).slice(1, -1),
  ".css": (v: string) => v.replace(/\*\//g, "* /"),
  ".js": asTyped,
  ".md": asTyped,
  ".txt": asTyped,
} satisfies Record<string, (v: string) => string>;
type TextExtension = keyof typeof TEXT_TYPES;

/** The library's text files, by extension. */
export const TEXT_EXTENSIONS = Object.keys(TEXT_TYPES) as TextExtension[];

/** A file's extension, lower-case with its dot (".html"), or "" when its name has none. */
const extensionOf = (path: string) => {
  const dot = path.lastIndexOf(".");
  return dot > path.lastIndexOf("/") ? path.slice(dot).toLowerCase() : "";
};

/** Whether `path` is a text file, by its extension (any case). */
export const isTextFile = (path: string) => Object.hasOwn(TEXT_TYPES, extensionOf(path));

const IMAGES = ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"];
const FONTS = ["woff", "woff2", "ttf", "otf"];
const MEDIA = ["mp4", "webm", "mov", "m4v", "mp3", "wav", "m4a", "aac", "ogg"];
/** What each part of a pack may hold. Scripts only in _shared/, so what a pack runs is in one place. */
const ALLOWED: Record<"_shared" | "assets", Set<string>> = {
  _shared: new Set(["css", "js", ...IMAGES, ...FONTS]),
  assets: new Set([...IMAGES, ...FONTS, ...MEDIA]),
};
const ROOT_FILES = new Set(["pack.json", "README.md", "LICENSE", "LICENSE.md", "LICENSE.txt"]);

export type PackManifest = {
  format: number;
  /** Lower-case letters, numbers and dashes: the set's folder name (templates/<id>/) unless the org already has one. */
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  /** The views, in order: each is templates/<view>.html in the pack. */
  views: string[];
  /** The placeholders the pack's files use (a subset of PACK_PLACEHOLDERS). */
  placeholders: PackPlaceholder[];
};

/** A template pack the server has checked and staged, ready to install (POST /api/packs/stage). */
export type StagedPack = {
  token: string;
  /** The folder it installs as: the pack's id, or "<id>-2"… when the org has that already. */
  set: string;
  manifest: PackManifest;
  /** Covers: library paths of the filled-in preview copy. */
  views: { name: string; label: string; path: string }[];
  transition: string | null;
  scripts: PackScripts & { standard: boolean };
  warnings: string[];
  files: number;
  bytes: number;
};

/** A built-in template pack, as GET /api/packs/builtin lists it: the starter and the site's six shows. */
export type BuiltinPack = { id: string; name: string; description: string; views: string[] };

/** One entry of a zip's listing or a dropped folder, before anything is written. */
export type PackEntry = { path: string; size: number; type: "file" | "dir" | "symlink" | "other" };
/** A file to install: `path` inside the pack (after a wrapping folder is stripped), `from` as listed. */
export type PackFile = { path: string; from: string; size: number };

export type PackPlan = { ok: true; files: PackFile[]; skipped: number } | { ok: false; error: string };

export type PackScripts = {
  /** Script files the pack ships (_shared/*.js). */
  files: string[];
  /** Views, the transition and SVGs with scripts of their own written in (inline <script>, on… handlers, javascript: links). */
  inline: string[];
  /** Scripts loaded from another site. */
  remote: string[];
};

export type PackReport =
  | { ok: true; manifest: PackManifest; files: PackFile[]; views: { name: string; file: string }[]; transition: string | null; scripts: PackScripts; warnings: string[] }
  | { ok: false; error: string };

const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._ -]{0,80}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const VIEW = /^[a-z0-9][a-z0-9-]{0,60}$/;
const ext = (p: string) => (p.includes(".") ? p.slice(p.lastIndexOf(".") + 1).toLowerCase() : "");

/** Left out silently: what zip tools and Finder add. */
const isJunk = (parts: string[]) => parts[0] === "__MACOSX" || parts.some((s) => s.startsWith(".")) || parts.at(-1) === "Thumbs.db" || parts.at(-1) === "desktop.ini";

/** Why a listed path can't be in a pack, or null. Run on every entry, junk included, so nothing odd is ever "skipped" into place. */
export function pathProblem(path: string): string | null {
  if (typeof path !== "string" || !path) return "It has a file with no name";
  if (path.length > PACK_LIMITS.pathLength + 100) return "It has a file name that's too long";
  if (/[\u0000-\u001f\u007f\\]/.test(path)) return `"${path.slice(0, 80)}" has a character a file name can't have`;
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return `"${path.slice(0, 80)}" points outside the pack`;
  const parts = path.replace(/\/$/, "").split("/");
  if (parts.some((s) => s === "" || s === "." || s === "..")) return `"${path.slice(0, 80)}" points outside the pack`;
  return null;
}

/**
 * Which entries to extract, and where. Refuses the whole pack for anything unsafe or unexpected:
 * a path out of the folder, a link, a file type that doesn't belong where it is, too many or too big.
 */
export function planPack(entries: PackEntry[]): PackPlan {
  const fail = (error: string): PackPlan => ({ ok: false, error });
  if (entries.length > PACK_LIMITS.files * 4) return fail(`It has more than ${PACK_LIMITS.files} files`);
  const files: { parts: string[]; from: string; size: number }[] = [];
  let skipped = 0;
  for (const e of entries) {
    const why = pathProblem(e.path);
    if (why) return fail(why);
    const parts = e.path.replace(/\/$/, "").split("/");
    if (e.type === "symlink") return fail(`"${e.path}" is a link. Packs can't have links`);
    if (e.type === "other") return fail(`"${e.path}" isn't a plain file`);
    if (isJunk(parts)) {
      if (e.type === "file") skipped++;
      continue;
    }
    if (e.type === "dir") continue;
    if (!Number.isFinite(e.size) || e.size < 0) return fail(`"${e.path}" has no size`);
    files.push({ parts, from: e.path, size: e.size });
  }
  // A zip made by compressing the folder has it as one wrapping folder: strip it.
  let strip = 0;
  if (!files.some((f) => f.parts.length === 1 && f.parts[0] === "pack.json")) {
    const tops = new Set(files.map((f) => f.parts[0]));
    if (tops.size === 1 && files.every((f) => f.parts.length > 1) && files.some((f) => f.parts.length === 2 && f.parts[1] === "pack.json")) strip = 1;
  }
  const out: PackFile[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const f of files) {
    const parts = f.parts.slice(strip);
    const path = parts.join("/");
    const name = parts.at(-1)!;
    if (path.length > PACK_LIMITS.pathLength) return fail(`"${path.slice(0, 60)}…" has too long a name`);
    if (parts.length > PACK_LIMITS.depth) return fail(`"${path}" is too many folders deep`);
    if (!parts.every((s) => SEGMENT.test(s))) return fail(`"${path}": use letters, numbers, dots, dashes and spaces in file names`);
    const key = path.toLowerCase(); // the Mac's disk ignores case: two names that differ only in case would collide
    if (seen.has(key)) return fail(`"${path}" is in it twice`);
    seen.add(key);
    const top = parts[0]!;
    if (parts.length === 1) {
      if (!ROOT_FILES.has(name)) return fail(`"${path}" doesn't belong in a pack (only pack.json, README.md and LICENSE go next to templates/)`);
    } else if (top === "templates") {
      // Exactly ".html": the switcher lists views by that suffix, so "main.HTML" would install unseen.
      if (parts.length !== 2 || !name.endsWith(".html")) return fail(`"${path}": templates/ holds only the views, as .html files (lower-case .html)`);
    } else if (top === "_shared") {
      const isTransition = path === "_shared/transition.html";
      if (!isTransition && !ALLOWED._shared.has(ext(name))) return fail(`"${path}": _shared/ holds the theme (.css), scripts (.js), the transition, pictures and fonts, not .${ext(name) || "files without a type"}`);
    } else if (top === "assets") {
      if (!ALLOWED.assets.has(ext(name))) return fail(`"${path}": assets/ holds pictures, video, audio and fonts, not .${ext(name) || "files without a type"}`);
    } else return fail(`"${top}/" doesn't belong in a pack (it has pack.json, templates/, _shared/ and assets/)`);
    if (f.size > PACK_LIMITS.fileBytes) return fail(`"${path}" is over ${PACK_LIMITS.fileBytes / 1024 / 1024} MB`);
    total += f.size;
    if (total > PACK_LIMITS.totalBytes) return fail(`It's over ${PACK_LIMITS.totalBytes / 1024 / 1024} MB unpacked`);
    out.push({ path, from: f.from, size: f.size });
  }
  if (out.length > PACK_LIMITS.files) return fail(`It has more than ${PACK_LIMITS.files} files`);
  if (!out.some((f) => f.path === "pack.json")) return fail("There's no pack.json at the top. Is this a template pack?");
  return { ok: true, files: out, skipped };
}

/** pack.json, checked. */
export function readManifest(text: string): { ok: true; manifest: PackManifest } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error: `pack.json: ${error}` });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail("isn't valid JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("should be an object");
  const m = raw as Record<string, unknown>;
  const format = m.format === undefined ? PACK_FORMAT : m.format;
  if (typeof format !== "number" || !Number.isInteger(format) || format < 1) return fail("format should be 1");
  if (format > PACK_FORMAT) return fail(`it's format ${format}, made for a newer ViewSwitcher. Update the app to install it`);
  if (typeof m.id !== "string" || !SLUG.test(m.id)) return fail("id should be lower-case letters, numbers and dashes (up to 40), like \"neon-night\"");
  if (typeof m.name !== "string" || !m.name.trim() || m.name.length > 60) return fail("name should be a short name (up to 60 characters)");
  if (typeof m.version !== "string" || !/^\d{1,6}\.\d{1,6}(\.\d{1,6})?([-+][0-9A-Za-z.-]{1,40})?$/.test(m.version)) return fail("version should look like \"1.0.0\"");
  if (m.description !== undefined && (typeof m.description !== "string" || m.description.length > 400)) return fail("description should be text (up to 400 characters)");
  if (m.author !== undefined && (typeof m.author !== "string" || m.author.length > 80)) return fail("author should be a name (up to 80 characters)");
  if (!Array.isArray(m.views) || m.views.length === 0) return fail("views should list the pack's views, like [\"starting-soon\", \"main\"]");
  if (m.views.length > PACK_LIMITS.files) return fail("views lists too many");
  for (const v of m.views) if (typeof v !== "string" || !VIEW.test(v)) return fail(`views: "${String(v).slice(0, 40)}" should be a file name in templates/ without .html (lower-case letters, numbers and dashes)`);
  if (new Set(m.views).size !== m.views.length) return fail("views lists one twice");
  const placeholders = m.placeholders === undefined ? [] : m.placeholders;
  if (!Array.isArray(placeholders)) return fail("placeholders should be a list, like [\"ORG_NAME\", \"ACCENT\"]");
  for (const p of placeholders) if (!(PACK_PLACEHOLDERS as readonly unknown[]).includes(p)) return fail(`placeholders: "${String(p).slice(0, 40)}" isn't one ViewSwitcher fills (${PACK_PLACEHOLDERS.join(", ")})`);
  return {
    ok: true,
    manifest: {
      format,
      id: m.id,
      name: m.name.trim(),
      version: m.version,
      description: typeof m.description === "string" ? m.description.trim() : "",
      ...(typeof m.author === "string" && m.author.trim() ? { author: m.author.trim() } : {}),
      views: m.views as string[],
      placeholders: placeholders as PackPlaceholder[],
    },
  };
}

/**
 * Does this page run anything of its own (beyond <script src> of a file, which `scripts.files` and
 * `remote` cover)? In an SVG every <script> counts, whatever it loads: SVG scripts take href or
 * xlink:href, and a view that frames the SVG runs them.
 */
function inlineCode(html: string, svg = false): boolean {
  if (svg && /<script[\s/>]/i.test(html)) return true;
  for (const e of scanElements(html)) {
    if (e.tag === "script" && e.innerEnd > e.innerStart && html.slice(e.innerStart, e.innerEnd).trim()) return true;
    for (const a of e.attrs) {
      if (/^on/i.test(a.name)) return true;
      const v = a.valueStart >= 0 ? html.slice(a.valueStart, a.valueEnd).replace(/[\s\u0000-\u001f]+/g, "").toLowerCase() : "";
      if (v.startsWith("javascript:") || (a.name === "srcdoc" && /<script|on\w+=/i.test(v))) return true;
    }
  }
  return false;
}

/** External <script src>: anything that isn't the pack's or the library's own. */
function remoteScripts(html: string): string[] {
  const out: string[] = [];
  for (const e of scanElements(html)) {
    if (e.tag !== "script") continue;
    const a = e.attrs.find((x) => (x.name === "src" || x.name === "href" || x.name === "xlink:href") && x.valueStart >= 0);
    const src = a ? html.slice(a.valueStart, a.valueEnd).trim() : "";
    if (src && !src.startsWith("{{PACK}}/") && !src.startsWith("/library/")) out.push(src);
  }
  return out;
}

/**
 * The placeholders whose value is free text a person typed (a show's name and its initial), which
 * can hold quotes, "&" or "<". The others are a slug, a color or a URL the switcher makes, which
 * read the same in any of these places.
 */
const TEXT_PLACEHOLDERS: readonly PackPlaceholder[] = ["ORG_NAME", "ORG_INITIAL"];

/**
 * A .css file without its comments, where a value is safe: the fill breaks up a comment's end there
 * (TEXT_TYPES), and the starter names the show in one. Quoted strings are kept and skipped while
 * comments are taken out, so a comment's start inside one isn't a comment; a string ends at its line's
 * end at the latest, as CSS ends an unclosed one, unless a backslash continues it. Linear in the text,
 * whatever it holds (an unclosed comment is looked for once).
 */
function cssCode(css: string): string {
  // One pass, as CSS tokenizes it: newlines normalized first (CRLF, CR and form feed are newlines there).
  const text = css.replace(/\r\n?|\f/g, "\n");
  const kept: string[] = [];
  let from = 0;
  for (let i = 0; i < text.length; ) {
    const c = text[i]!;
    if (c === '"' || c === "'") {
      // A string runs to its closing quote, or to the end of its line; a backslash takes the next character with it.
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      i = Math.min(text[j] === c ? j + 1 : j, text.length);
    } else if (c === "/" && text[i + 1] === "*") {
      kept.push(text.slice(from, i));
      const close = text.indexOf("*/", i + 2);
      from = i = close < 0 ? text.length : close + 2; // an unclosed comment runs to the end
    } else i++;
  }
  kept.push(text.slice(from));
  return kept.join("");
}

/**
 * Text placeholders in code: an inline <script> or <style>, an on… or style attribute, a .js file, or a
 * .css file outside its comments (the starter's theme.css names the show in one, where it's safe). A
 * value is HTML-escaped in a page and as typed in .js (TEXT_TYPES), right for text and attributes
 * but not inside code: "O'Brien" ends a JS string, "R&amp;B" shows in a CSS content string.
 */
function textInCode(texts: Record<string, string>): { placeholder: string; where: string }[] {
  const found: { placeholder: string; where: string }[] = [];
  const note = (text: string, where: string) => {
    for (const p of placeholdersIn(text)) if ((TEXT_PLACEHOLDERS as readonly string[]).includes(p)) found.push({ placeholder: p, where });
  };
  for (const [path, text] of Object.entries(texts)) {
    const e = extensionOf(path);
    if (e === ".js") note(text, path);
    // In a .css file a value is as typed (only a comment's end is broken up), so outside comments it's in code.
    if (e === ".css") note(cssCode(text), path);
    if (e !== ".html" && e !== ".svg") continue;
    for (const el of scanElements(text)) {
      // A <style>'s comments count too: a page's values are HTML-escaped, which leaves a comment's end
      // alone, so a name can close the comment it's in (only a .css file's fill breaks that up).
      if ((el.tag === "script" || el.tag === "style") && el.innerEnd > el.innerStart) note(text.slice(el.innerStart, el.innerEnd), `${path} <${el.tag}>`);
      // An on… or style attribute is HTML-decoded, then read as JS or CSS: the same as code.
      for (const a of el.attrs) if ((/^on/i.test(a.name) || a.name.toLowerCase() === "style") && a.valueStart >= 0) note(text.slice(a.valueStart, a.valueEnd), `${path} ${a.name.toLowerCase()}`);
    }
  }
  return found;
}

/**
 * Whether the planned files make a pack: pack.json, a view for each name it lists, and placeholders
 * ViewSwitcher fills. `texts` holds the text of pack.json, every .html and every .css/.js/.svg.
 * Problems a person can live with (a view not listed, a placeholder not declared) are warnings.
 */
export function checkPack(files: PackFile[], texts: Record<string, string>): PackReport {
  const fail = (error: string): PackReport => ({ ok: false, error });
  const pj = texts["pack.json"];
  if (pj === undefined) return fail("There's no pack.json at the top. Is this a template pack?");
  const read = readManifest(pj);
  if (!read.ok) return fail(read.error);
  const manifest = read.manifest;
  const warnings: string[] = [];
  const have = new Set(files.map((f) => f.path));
  for (const v of manifest.views) if (!have.has(`templates/${v}.html`)) return fail(`pack.json lists the view "${v}", but templates/${v}.html isn't in the pack`);
  const listed = new Set(manifest.views);
  const extra = files.filter((f) => f.path.startsWith("templates/")).map((f) => f.path.slice("templates/".length, -".html".length)).filter((v) => !listed.has(v));
  for (const v of extra) {
    if (!VIEW.test(v)) return fail(`templates/${v}.html: name views with lower-case letters, numbers and dashes`);
  }
  if (extra.length) warnings.push(`pack.json doesn't list ${extra.map((v) => `"${v}"`).join(", ")}: installed after the listed views`);
  const views = [...manifest.views, ...extra].map((name) => ({ name, file: `templates/${name}.html` }));

  // Placeholders: anything {{LIKE_THIS}} that ViewSwitcher doesn't fill stays as typed.
  const used = new Set<string>();
  for (const [path, text] of Object.entries(texts)) {
    if (!isTextFile(path) || path === "pack.json") continue;
    for (const p of placeholdersIn(text)) used.add(p);
  }
  const unknown = [...used].filter((p) => !(PACK_PLACEHOLDERS as readonly string[]).includes(p));
  if (unknown.length) warnings.push(`${unknown.map((p) => `{{${p}}}`).join(", ")} ${unknown.length === 1 ? "isn't a placeholder" : "aren't placeholders"} ViewSwitcher fills, so ${unknown.length === 1 ? "it stays" : "they stay"} as typed`);
  const undeclared = [...used].filter((p) => (PACK_PLACEHOLDERS as readonly string[]).includes(p) && !manifest.placeholders.includes(p as PackPlaceholder));
  if (undeclared.length) warnings.push(`pack.json doesn't list ${undeclared.map((p) => `{{${p}}}`).join(", ")} in placeholders (filled anyway)`);

  const coded = textInCode(texts);
  if (coded.length) {
    const names = [...new Set(coded.map((c) => `{{${c.placeholder}}}`))].join(", ");
    const where = [...new Set(coded.map((c) => c.where))];
    warnings.push(
      `${names} ${coded.length === 1 ? "is" : "are"} in a script, a style, or an on… or style attribute (${where.slice(0, 5).join("; ")}${where.length > 5 ? "…" : ""}): ` +
        "a show's name is filled in there as text for the page, so a name like O'Brien or R&B can break that view for that show. Keep placeholders in text and attributes.",
    );
  }

  // Links to the pack's own files that aren't in it.
  const missing = new Set<string>();
  for (const [path, text] of Object.entries(texts)) {
    if (!/\.(html|css)$/i.test(path)) continue;
    for (const m of text.matchAll(/\{\{PACK\}\}\/([^"'()\s?#<>]+)/g)) {
      let target = m[1]!;
      try {
        target = decodeURIComponent(target);
      } catch {}
      if (target.startsWith("templates/") || !have.has(target)) {
        // Views are installed at the set's top level ({{PACK}}/<view>.html), not under templates/.
        if (!(target.endsWith(".html") && have.has(`templates/${target}`))) missing.add(`${path} → {{PACK}}/${m[1]}`);
      }
    }
  }
  if (missing.size) warnings.push(`Links to files that aren't in the pack: ${[...missing].slice(0, 5).join("; ")}${missing.size > 5 ? "…" : ""}`);

  const pages = [...views.map((v) => v.file), ...(have.has("_shared/transition.html") ? ["_shared/transition.html"] : [])];
  const svgs = files.filter((f) => ext(f.path) === "svg").map((f) => f.path);
  const scripts: PackScripts = {
    files: files.filter((f) => ext(f.path) === "js").map((f) => f.path),
    // An SVG runs its own scripts when a view frames it.
    inline: [...pages.filter((p) => inlineCode(texts[p] ?? "")), ...svgs.filter((p) => inlineCode(texts[p] ?? "", true))],
    remote: [...new Set([...pages, ...svgs].flatMap((p) => remoteScripts(texts[p] ?? "")))],
  };
  return { ok: true, manifest, files, views, transition: have.has("_shared/transition.html") ? "_shared/transition.html" : null, scripts, warnings };
}

/**
 * Where a pack file goes in the installed set (templates/<set>/…): views move up out of templates/,
 * so {{PACK}}/<view>.html and {{PACK}}/_shared/theme.css sit side by side like an org's own templates.
 */
export const installedPath = (packPath: string) => (packPath.startsWith("templates/") ? packPath.slice("templates/".length) : packPath);

/** A placeholder as files write it: {{ORG_NAME}}. */
const PLACEHOLDER = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

/** The placeholder names `text` uses ("ORG_NAME" for {{ORG_NAME}}), each once, known or not. */
export const placeholdersIn = (text: string): string[] => [...new Set(Array.from(text.matchAll(PLACEHOLDER), (m) => m[1]!))];

/** `text`'s characters as people see them (a flag, a skin-toned emoji, an accented letter are one each). */
export const graphemes = (text: string): string[] => Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment);

/** The placeholders' values for an org: its id, name, initial and colors, and {{PACK}} when a set is filled in. */
export function placeholderVars(org: { id: string; name: string; accent: string; ground: string }, packUrl?: string): Partial<Record<PackPlaceholder, string>> {
  const name = org.name.trim();
  // The first character as people see it, not the first UTF-16 unit: "🇺🇸 Club" starts with 🇺🇸.
  return { ORG_ID: org.id, ORG_NAME: name, ORG_INITIAL: (graphemes(name)[0] ?? "?").toUpperCase(), ACCENT: org.accent, GROUND: org.ground, ...(packUrl === undefined ? {} : { PACK: packUrl }) };
}

/**
 * Fill the placeholders in the text file `path`; unknown ones stay as typed. Each value is escaped
 * for the file it lands in (TEXT_TYPES above); a file that isn't a text type gets values as typed.
 */
export function fillPlaceholders(path: string, text: string, vars: Partial<Record<PackPlaceholder, string>>): string {
  const ext = extensionOf(path);
  const escape: (v: string) => string = Object.hasOwn(TEXT_TYPES, ext) ? TEXT_TYPES[ext as TextExtension] : asTyped;
  return text.replace(PLACEHOLDER, (m, k: string) => {
    const v = (vars as Record<string, string | undefined>)[k];
    return v === undefined ? m : escape(v);
  });
}
