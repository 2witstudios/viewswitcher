// A small, forgiving HTML scanner for the scene editor. It never builds a DOM: it lists each
// element's exact source ranges so an edit can replace one range and leave every other byte alone.
// (Writing the browser DOM back would reformat the file and leak runtime state from scripts.)

export type Attr = {
  name: string;
  /** Index of the value's first character (inside the quotes), or -1 for a bare attribute. */
  valueStart: number;
  valueEnd: number;
};

export type ScannedElement = {
  /** Index in source order; `tagForEdit` writes it as data-vs="id". */
  id: number;
  /** Lower-case tag name. */
  tag: string;
  /** Index of the start tag's "<". */
  start: number;
  /** Index just after the start tag's ">". */
  openEnd: number;
  /** Content range: [innerStart, innerEnd). Empty for void and self-closed elements. */
  innerStart: number;
  innerEnd: number;
  /** Index just after the end tag's ">" (or where the element was implicitly closed). */
  end: number;
  /** Has an explicit matching end tag. */
  closed: boolean;
  /** Its content is only text (no elements or comments), it has some, and it has an explicit end tag. */
  leaf: boolean;
  parent: number | null;
  attrs: Attr[];
};

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
/** Elements whose content is never markup. */
const RAW = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript"]);
/** Leaf text in these is not something to edit on screen. */
const NOT_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript", "html", "head", "body", "svg"]);

const isSpace = (c: string | undefined) => c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f";
const isNameStart = (c: string | undefined) => !!c && /[A-Za-z]/.test(c);

/** Every element of `html` in source order, with exact ranges. */
export function scanElements(html: string): ScannedElement[] {
  const out: ScannedElement[] = [];
  const stack: ScannedElement[] = [];
  /** Per open element: it has seen a child element or comment. */
  const mixed = new Map<number, boolean>();
  const markMixed = () => {
    const top = stack[stack.length - 1];
    if (top) mixed.set(top.id, true);
  };
  const closeTo = (index: number, at: number, endAt: number, explicit: boolean) => {
    // Pop everything above `index` (implicitly closed), then `index` itself.
    while (stack.length > index) {
      const el = stack.pop()!;
      const isTarget = stack.length === index;
      el.innerEnd = at;
      el.end = isTarget ? endAt : at;
      el.closed = isTarget && explicit;
    }
  };

  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;
    i = lt;
    if (html.startsWith("<!--", i)) {
      markMixed();
      const close = html.indexOf("-->", i + 4);
      i = close === -1 ? n : close + 3;
      continue;
    }
    if (html.startsWith("<![CDATA[", i)) {
      markMixed();
      const close = html.indexOf("]]>", i + 9);
      i = close === -1 ? n : close + 3;
      continue;
    }
    if (html[i + 1] === "!" || html[i + 1] === "?") {
      // Doctype or processing instruction.
      const close = html.indexOf(">", i + 2);
      i = close === -1 ? n : close + 1;
      continue;
    }
    if (html[i + 1] === "/" && isNameStart(html[i + 2])) {
      // End tag.
      let j = i + 2;
      while (j < n && !isSpace(html[j]) && html[j] !== ">" && html[j] !== "/") j++;
      const tag = html.slice(i + 2, j).toLowerCase();
      const close = html.indexOf(">", j);
      const endAt = close === -1 ? n : close + 1;
      let k = stack.length - 1;
      while (k >= 0 && stack[k]!.tag !== tag) k--;
      if (k >= 0) closeTo(k, i, endAt, true);
      i = endAt;
      continue;
    }
    if (!isNameStart(html[i + 1])) {
      // A stray "<" in text.
      i++;
      continue;
    }

    // Start tag.
    let j = i + 1;
    while (j < n && !isSpace(html[j]) && html[j] !== ">" && html[j] !== "/") j++;
    const tag = html.slice(i + 1, j).toLowerCase();
    const attrs: Attr[] = [];
    let selfClosed = false;
    while (j < n) {
      while (j < n && isSpace(html[j])) j++;
      if (html[j] === ">") {
        j++;
        break;
      }
      if (html[j] === "/") {
        if (html[j + 1] === ">") {
          selfClosed = true;
          j += 2;
          break;
        }
        j++;
        continue;
      }
      const nameStart = j;
      while (j < n && !isSpace(html[j]) && html[j] !== "=" && html[j] !== ">" && !(html[j] === "/" && html[j + 1] === ">")) j++;
      const name = html.slice(nameStart, j).toLowerCase();
      let k = j;
      while (k < n && isSpace(html[k])) k++;
      if (html[k] !== "=") {
        attrs.push({ name, valueStart: -1, valueEnd: -1 });
        continue;
      }
      k++;
      while (k < n && isSpace(html[k])) k++;
      const q = html[k];
      if (q === '"' || q === "'") {
        const close = html.indexOf(q, k + 1);
        const valueEnd = close === -1 ? n : close;
        attrs.push({ name, valueStart: k + 1, valueEnd });
        j = close === -1 ? n : close + 1;
      } else {
        const valueStart = k;
        while (k < n && !isSpace(html[k]) && html[k] !== ">") k++;
        attrs.push({ name, valueStart, valueEnd: k });
        j = k;
      }
    }
    const openEnd = Math.min(j, n);
    markMixed();
    const el: ScannedElement = {
      id: out.length, tag, start: i, openEnd, innerStart: openEnd, innerEnd: openEnd, end: openEnd,
      closed: false, leaf: false, parent: stack[stack.length - 1]?.id ?? null, attrs,
    };
    out.push(el);
    i = openEnd;
    if (VOID.has(tag) || selfClosed) {
      el.closed = true;
      continue;
    }
    if (RAW.has(tag)) {
      // Content runs to the first matching end tag, whatever it contains.
      const re = new RegExp(`</${tag}[\\s/>]`, "ig");
      re.lastIndex = openEnd;
      const m = re.exec(html);
      const at = m ? m.index : n;
      const close = m ? html.indexOf(">", at) : -1;
      el.innerEnd = at;
      el.end = close === -1 ? n : close + 1;
      el.closed = !!m;
      i = el.end;
      continue;
    }
    stack.push(el);
  }
  closeTo(0, n, n, false);

  for (const el of out) {
    el.leaf = el.closed && !VOID.has(el.tag) && !NOT_TEXT.has(el.tag) && !mixed.get(el.id) && el.innerEnd > el.innerStart
      && html.slice(el.innerStart, el.innerEnd).trim() !== "";
  }
  return out;
}

// ---------------------------------------------------------------- text

// Named character references scenes are likely to use: Latin-1 (U+00A0–U+00FF, in order) and common punctuation.
const LATIN1 =
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot " +
  "cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml " +
  "Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig " +
  "agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute " +
  "ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml";
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  rsquo: "\u2019", lsquo: "\u2018", rdquo: "\u201d", ldquo: "\u201c", sbquo: "\u201a", bdquo: "\u201e", lsaquo: "\u2039", rsaquo: "\u203a",
  mdash: "\u2014", ndash: "\u2013", hellip: "\u2026", bull: "\u2022", prime: "\u2032", Prime: "\u2033", dagger: "\u2020", Dagger: "\u2021",
  permil: "\u2030", trade: "\u2122", euro: "\u20ac", minus: "\u2212", larr: "\u2190", rarr: "\u2192", uarr: "\u2191", darr: "\u2193",
  hearts: "\u2665", ensp: "\u2002", emsp: "\u2003", thinsp: "\u2009", zwnj: "\u200c", zwj: "\u200d", lrm: "\u200e", rlm: "\u200f",
  OElig: "\u0152", oelig: "\u0153", Scaron: "\u0160", scaron: "\u0161", Yuml: "\u0178", fnof: "\u0192", circ: "\u02c6", tilde: "\u02dc",
  ...Object.fromEntries(LATIN1.split(" ").map((name, i) => [name, String.fromCharCode(0xa0 + i)])),
};

/** Decode character references the way a browser would for the text we can edit. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    // Names are case-sensitive (&Eacute; isn't &eacute;); only the table's own entries, never Object.prototype's.
    return Object.hasOwn(NAMED, ref) ? NAMED[ref]! : m;
  });
}

const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ /g, "&nbsp;");

/** Collapse and trim HTML whitespace only. (JS trim() would also eat U+00A0, a non-breaking space, which is text.) */
export const collapseHtmlSpace = (t: string) => t.replace(/[ \t\n\r\f]+/g, " ").replace(/^ | $/g, "");

/** The text of a leaf element as the browser shows it (whitespace collapsed, trimmed). */
export function textOf(html: string, el: ScannedElement): string {
  return collapseHtmlSpace(decodeEntities(html.slice(el.innerStart, el.innerEnd)));
}

// ---------------------------------------------------------------- position

/** The px value of each of `props` in the element's inline style (the declaration that wins), with its number's range. */
export function pxProps<P extends string>(html: string, el: ScannedElement, props: readonly P[]): Partial<Record<P, { n: number; at: [number, number] }>> {
  const out: Partial<Record<P, { n: number; at: [number, number] }>> = {};
  const style = el.attrs.find((a) => a.name === "style" && a.valueStart >= 0);
  if (!style) return out;
  // Comments (outside quotes) become spaces of the same length, so offsets hold.
  const raw = html.slice(style.valueStart, style.valueEnd);
  let value = "";
  for (let i = 0, quote = ""; i < raw.length; i++) {
    const c = raw[i]!;
    if (quote) {
      value += c;
      if (c === "\\" && i + 1 < raw.length) value += raw[++i];
      else if (c === quote) quote = "";
    } else if (c === "/" && raw[i + 1] === "*") {
      const close = raw.indexOf("*/", i + 2);
      const stop = close === -1 ? raw.length : close + 2;
      value += " ".repeat(stop - i);
      i = stop - 1;
    } else {
      if (c === '"' || c === "'") quote = c;
      value += c;
    }
  }
  // Split into declarations at ";" outside quotes and parentheses, the way CSS does.
  const decls: [number, number][] = [];
  let from = 0, depth = 0, quote = "";
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === ";" && depth === 0) {
      decls.push([from, i]);
      from = i + 1;
    }
  }
  decls.push([from, value.length]);
  // The declaration that wins: !important over normal, then the last one. If the winner isn't
  // plain px (%, calc(), var()), the property can't be edited.
  const pick = (prop: string) => {
    let win: { important: boolean; px: { at: [number, number]; n: number } | null } | null = null;
    for (const [a, b] of decls) {
      const m = /^(\s*)([-\w]+)(\s*:\s*)([\s\S]*?)(\s*)$/.exec(value.slice(a, b));
      if (!m || m[2]!.toLowerCase() !== prop) continue;
      const important = /!\s*important$/i.test(m[4]!);
      if (win?.important && !important) continue;
      const v = /^(-?\d+(?:\.\d+)?)px(\s*!\s*important)?$/i.exec(m[4]!);
      const at = style.valueStart + a + m[1]!.length + m[2]!.length + m[3]!.length;
      win = { important, px: v ? { at: [at, at + v[1]!.length], n: Number(v[1]) } : null };
    }
    return win?.px ?? null;
  };
  for (const prop of props) {
    const v = pick(prop);
    if (v) out[prop] = v;
  }
  return out;
}

/** The inline style's `left` and `top` in px, with their number ranges, or null if it has neither as px. */
export function positionOf(html: string, el: ScannedElement): { left: number; top: number; leftAt: [number, number]; topAt: [number, number] } | null {
  const { left: l, top: t } = pxProps(html, el, ["left", "top"] as const);
  if (!l || !t) return null;
  return { left: l.n, top: t.n, leftAt: l.at, topAt: t.at };
}

/** The inline style's `width` and `height` in px (both needed), with their number ranges, or null. */
export function sizeOf(html: string, el: ScannedElement): { width: number; height: number; widthAt: [number, number]; heightAt: [number, number] } | null {
  const { width: w, height: h } = pxProps(html, el, ["width", "height"] as const);
  if (!w || !h) return null;
  return { width: w.n, height: h.n, widthAt: w.at, heightAt: h.at };
}

// ---------------------------------------------------------------- edits

export type TextEdit = { id: number; text: string };
export type MoveEdit = { id: number; left: number; top: number };
/** New width and height; resizing from a corner other than bottom-right also moves the box (left/top). */
export type SizeEdit = { id: number; width: number; height: number; left?: number; top?: number };
/** One new element (`insert` is its markup) inside element `id`: before its child `before`, else as its last child. */
export type InsertEdit = { id: number; insert: string; before?: number; /** Whitespace before it (default: a new line, indented like its neighbours). */ lead?: string };
export type RemoveEdit = { id: number; remove: true };
/** An image's src. */
export type SrcEdit = { id: number; src: string };
export type SceneEdit = TextEdit | MoveEdit | SizeEdit | InsertEdit | RemoveEdit | SrcEdit;
export type EditKind = "text" | "move" | "size" | "insert" | "remove" | "src";

export function editKind(e: SceneEdit): EditKind {
  if ("text" in e) return "text";
  if ("insert" in e) return "insert";
  if ("remove" in e) return "remove";
  if ("src" in e) return "src";
  if ("width" in e) return "size";
  return "move";
}
/** Adds or removes elements, so element ids after it change (see idsAfter). */
export const isStructural = (e: SceneEdit): e is InsertEdit | RemoveEdit => "insert" in e || "remove" in e;

export class EditError extends Error {}

type Patch = { from: number; to: number; text: string };

const formatPx = (n: number) => String(Math.round(n * 100) / 100);

/** Tags and attributes the editor never adds: nothing it inserts can run code or load another page. */
const UNSAFE_TAGS = new Set(["script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "link", "meta", "base", "form", "input", "button", "textarea", "select", "title", "noscript", "template", "svg", "math", "xmp", "noembed", "noframes"]);

const URL_ATTRS = new Set(["src", "href", "poster", "data", "action", "xlink:href", "background", "cite", "longdesc", "manifest", "ping"]);

/** A path to a file in the library (`/library/<org>/…`), with nothing a scene attribute or the server would trip over. */
export function isLibraryUrl(src: string): boolean {
  if (typeof src !== "string" || !src.startsWith("/library/") || src.length > 600 || !/^[^\s"'<>`\\]+$/.test(src)) return false;
  let path = "";
  try {
    path = decodeURIComponent(src.slice("/library/".length).split(/[?#]/)[0]!);
  } catch {
    return false;
  }
  return path.split("/").every((part) => part !== "" && part !== ".." && !part.startsWith("."));
}

/** Why `markup` can't be inserted as one element, or null when it can. */
export function checkInsert(markup: string): string | null {
  if (typeof markup !== "string" || !markup) return "Nothing to add";
  if (markup.length > 20_000) return "That's too big to add";
  if (markup !== markup.trim() || markup.includes("<!--") || markup.includes("<![")) return "Not one element";
  const els = scanElements(markup);
  const top = els[0];
  if (!top || top.start !== 0 || top.end !== markup.length || !top.closed || els.some((e, i) => i > 0 && e.parent === null)) return "Not one element";
  for (const e of els) {
    if (!e.closed) return "Not one element";
    if (UNSAFE_TAGS.has(e.tag)) return `The editor doesn't add <${e.tag}>`;
    for (const a of e.attrs) {
      if (a.name.startsWith("on") || a.name === "srcdoc" || a.name === "formaction" || a.name === "srcset" || !/^[a-z][\w:.-]*$/.test(a.name)) return `The editor doesn't add ${a.name}`;
      const decoded = a.valueStart >= 0 ? decodeEntities(markup.slice(a.valueStart, a.valueEnd)) : "";
      // A character reference this decoder doesn't know (&colon;, &Tab;…) could hide anything from the checks below.
      if (/&(#|[a-z])/i.test(decoded)) return "The editor doesn't add that";
      const v = decoded.replace(/[\s\u0000-\u001f]+/g, "").toLowerCase();
      if (v.includes("javascript:") || v.includes("vbscript:")) return "The editor doesn't add links that run code";
      // Pictures and links come from the library only, never another site.
      if (URL_ATTRS.has(a.name) && !isLibraryUrl(decoded)) return "Images come from the library";
      if (a.name === "style" && [...v.matchAll(/url\(\s*['"]?([^'")]*)/g)].some((m) => !isLibraryUrl(m[1]!))) return "Images come from the library";
    }
  }
  return null;
}

/** Where the content before index `at` ends inside `into`: back over the whitespace before it. */
function contentEnd(html: string, into: ScannedElement, at: number) {
  let p = at;
  while (p > into.innerStart && isSpace(html[p - 1])) p--;
  return p;
}

/** The indentation of the line `el` starts on, when nothing but spaces comes before it there. */
function indentOf(html: string, el: ScannedElement): string | null {
  let q = el.start;
  while (q > 0 && (html[q - 1] === " " || html[q - 1] === "\t")) q--;
  return q === 0 || html[q - 1] === "\n" ? html.slice(q, el.start) : null;
}

/** Elements inside `el` and itself: ids el.id … el.id + count - 1. */
const subtreeSize = (els: ScannedElement[], el: ScannedElement) => {
  let k = el.id + 1;
  while (k < els.length && els[k]!.start < el.end) k++;
  return k - el.id;
};

/**
 * An element goes in right after the content before its place (the end of `into`'s content, or what
 * comes before `before`), preceded by `lead`: by default a line break and the indentation of its
 * neighbours. Removing an element takes it and the whitespace before it, and `restoreFor` gives that
 * whitespace back as `lead`, so delete then Undo leaves the file byte for byte as it was.
 */
function insertPatch(html: string, els: ScannedElement[], edit: InsertEdit, check = true): Patch {
  const into = els[edit.id];
  if (!into || !Number.isInteger(edit.id)) throw new EditError(`No element ${edit.id} in this scene`);
  if (!into.closed || VOID.has(into.tag) || RAW.has(into.tag) || into.tag === "html") throw new EditError(`Nothing can go inside <${into.tag}>`);
  const why = check ? checkInsert(edit.insert) : null;
  if (why) throw new EditError(why);
  if (edit.lead !== undefined && (typeof edit.lead !== "string" || !/^[ \t\r\n]{0,400}$/.test(edit.lead))) throw new EditError("Bad spacing");
  const nl = html.includes("\r\n") ? "\r\n" : "\n";
  if (edit.before !== undefined) {
    const b = els[edit.before];
    if (!b || !Number.isInteger(edit.before) || b.parent !== into.id) throw new EditError("That isn't a place inside this element");
    const p = contentEnd(html, into, b.start);
    const indent = indentOf(html, b);
    const lead = edit.lead ?? (indent !== null && /\n/.test(html.slice(p, b.start)) ? nl + indent : "");
    return { from: p, to: p, text: lead + edit.insert };
  }
  const p = contentEnd(html, into, into.innerEnd);
  let lead = edit.lead;
  if (lead === undefined) {
    const run = html.slice(p, into.innerEnd);
    const kids = els.filter((e) => e.parent === into.id);
    const last = kids[kids.length - 1];
    const indent = last ? indentOf(html, last) : null;
    // The indentation of its last child on a line of its own, else the end tag's plus two spaces.
    lead = !run.includes("\n") ? "" : nl + (indent ?? `${run.slice(run.lastIndexOf("\n") + 1)}  `);
  }
  return { from: p, to: p, text: lead + edit.insert };
}

function patchesFor(html: string, els: ScannedElement[], edit: SceneEdit): Patch[] {
  const el = els[edit.id];
  if (!el || !Number.isInteger(edit.id)) throw new EditError(`No element ${edit.id} in this scene`);
  switch (editKind(edit)) {
    case "text": {
      const { text: raw } = edit as TextEdit;
      if (!el.leaf) throw new EditError(`<${el.tag}> isn't plain text`);
      if (typeof raw !== "string") throw new EditError("Text must be a string");
      const text = raw.replace(/[\r\n]+/g, " ");
      // Empty text would leave nothing to click (or edit) next time.
      if (!text.trim()) throw new EditError("Text can't be empty"); // JS trim: a lone &nbsp; is empty too
      if (textOf(html, el) === collapseHtmlSpace(text)) return [];
      // Keep the source's own leading and trailing whitespace (indentation).
      const inner = html.slice(el.innerStart, el.innerEnd);
      const lead = inner.length - inner.replace(/^[ \t\n\r\f]+/, "").length;
      const trail = inner.length - inner.replace(/[ \t\n\r\f]+$/, "").length;
      return [{ from: el.innerStart + lead, to: el.innerEnd - trail, text: escapeText(text) }];
    }
    case "move": {
      const { left, top } = edit as MoveEdit;
      if (!Number.isFinite(left) || !Number.isFinite(top)) throw new EditError("Position must be numbers");
      const pos = positionOf(html, el);
      if (!pos) throw new EditError(`<${el.tag}> has no inline left/top in px`);
      return [
        { from: pos.leftAt[0], to: pos.leftAt[1], text: formatPx(left) },
        { from: pos.topAt[0], to: pos.topAt[1], text: formatPx(top) },
      ].filter((p) => html.slice(p.from, p.to) !== p.text);
    }
    case "size": {
      const { width, height, left, top } = edit as SizeEdit;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new EditError("Size must be positive numbers");
      const size = sizeOf(html, el);
      if (!size) throw new EditError(`<${el.tag}> has no inline width/height in px`);
      const out = [
        { from: size.widthAt[0], to: size.widthAt[1], text: formatPx(width) },
        { from: size.heightAt[0], to: size.heightAt[1], text: formatPx(height) },
      ];
      if (left !== undefined || top !== undefined) {
        const pos = positionOf(html, el);
        if (!pos) throw new EditError(`<${el.tag}> has no inline left/top in px`);
        if (left !== undefined) {
          if (!Number.isFinite(left)) throw new EditError("Position must be numbers");
          out.push({ from: pos.leftAt[0], to: pos.leftAt[1], text: formatPx(left) });
        }
        if (top !== undefined) {
          if (!Number.isFinite(top)) throw new EditError("Position must be numbers");
          out.push({ from: pos.topAt[0], to: pos.topAt[1], text: formatPx(top) });
        }
      }
      return out.filter((p) => html.slice(p.from, p.to) !== p.text);
    }
    case "src": {
      const { src } = edit as SrcEdit;
      if (el.tag !== "img") throw new EditError(`<${el.tag}> isn't an image`);
      if (!isLibraryUrl(src) || checkInsert(`<img src="${src}">`)) throw new EditError("That isn't an image the scene can show");
      const a = el.attrs.find((x) => x.name === "src" && x.valueStart >= 0);
      if (!a) throw new EditError("This image has no src to replace");
      return html.slice(a.valueStart, a.valueEnd) === src ? [] : [{ from: a.valueStart, to: a.valueEnd, text: src }];
    }
    case "insert":
      return [insertPatch(html, els, edit as InsertEdit)];
    case "remove": {
      if (el.parent === null || ["html", "head", "body"].includes(el.tag)) throw new EditError(`<${el.tag}> can't be deleted`);
      if (!el.closed) throw new EditError(`<${el.tag}> has no end tag, so it can't be deleted here`);
      return [{ from: contentEnd(html, els[el.parent]!, el.start), to: el.end, text: "" }];
    }
  }
}

/**
 * Apply edits whose ids all refer to `html` as it is now. Patches go from the end of the file
 * backwards, so earlier ranges stay valid; every byte outside them is unchanged.
 */
export function applyEdits(html: string, edits: SceneEdit[]): string {
  const els = scanElements(html);
  const patches = edits.flatMap((e) => patchesFor(html, els, e)).sort((a, b) => b.from - a.from);
  for (let k = 1; k < patches.length; k++) {
    if (patches[k]!.to > patches[k - 1]!.from) throw new EditError("Two edits change the same part of the scene");
  }
  let out = html;
  for (const p of patches) out = out.slice(0, p.from) + p.text + out.slice(p.to);
  return out;
}

export const setText = (html: string, id: number, text: string) => applyEdits(html, [{ id, text }]);
export const setPosition = (html: string, id: number, left: number, top: number) => applyEdits(html, [{ id, left, top }]);
export const setSize = (html: string, id: number, width: number, height: number, at?: { left?: number; top?: number }) =>
  applyEdits(html, [{ id, width, height, ...at }]);
/** Insert one element into element `into` (before its child `before`, else last). Its id is `idsAfter(...).added`. */
export const insertElement = (html: string, into: number, markup: string, before?: number) =>
  applyEdits(html, [before === undefined ? { id: into, insert: markup } : { id: into, insert: markup, before }]);
export const removeElement = (html: string, id: number) => applyEdits(html, [{ id, remove: true }]);

/**
 * Element ids once a structural edit is applied to `html`: `map` takes an id from before to after
 * (null: removed), and `added` is the inserted element's id.
 */
export function idsAfter(html: string, edit: InsertEdit | RemoveEdit): { map: (id: number) => number | null; added: number | null } {
  const els = scanElements(html);
  if ("insert" in edit) {
    const at = insertPatch(html, els, edit, false).from;
    let n = 0;
    while (n < els.length && els[n]!.start < at) n++;
    const count = scanElements(edit.insert).length;
    return { map: (id) => (id < n ? id : id + count), added: n };
  }
  const el = els[edit.id];
  if (!el) throw new EditError(`No element ${edit.id} in this scene`);
  const count = subtreeSize(els, el);
  return { map: (id) => (id < el.id ? id : id < el.id + count ? null : id - count), added: null };
}

/** The edit that puts element `id` back where it is, after removing it (ids as they are after the removal). */
export function restoreFor(html: string, id: number): InsertEdit {
  const els = scanElements(html);
  const el = els[id];
  if (!el || el.parent === null) throw new EditError(`No element ${id} to put back`);
  const count = subtreeSize(els, el);
  const next = els.find((e) => e.parent === el.parent && e.start >= el.end);
  const insert = html.slice(el.start, el.end);
  const lead = html.slice(contentEnd(html, els[el.parent]!, el.start), el.start);
  return next ? { id: el.parent, insert, before: next.id - count, lead } : { id: el.parent, insert, lead };
}

/**
 * Whether the editor can delete element `id` with an Undo that puts back exactly what was there:
 * nothing it couldn't insert again (scripts, forms…), and a place it can find again.
 */
export function canRemove(html: string, id: number): boolean {
  try {
    const els = scanElements(html);
    const el = els[id];
    if (!el || el.parent === null || ["html", "head", "body"].includes(el.tag) || id === sceneRoot(html)) return false;
    const back = restoreFor(html, id);
    return checkInsert(back.insert) === null && applyEdits(removeElement(html, id), [back]) === html;
  } catch {
    return false;
  }
}

/** The element new things go into: the scene's root (class "scene"), else <body>. */
export function sceneRoot(html: string): number | null {
  const els = scanElements(html);
  const cls = (e: ScannedElement) => {
    const a = e.attrs.find((x) => x.name === "class" && x.valueStart >= 0);
    return a ? html.slice(a.valueStart, a.valueEnd).split(/\s+/) : [];
  };
  const root = els.find((e) => e.closed && cls(e).includes("scene")) ?? els.find((e) => e.tag === "body" && e.closed);
  return root?.id ?? null;
}

/** The scene's <title> set to `name` (added at the top of <head> when there's none). */
export function setTitle(html: string, name: string): string {
  const clean = collapseHtmlSpace(String(name ?? "").replace(/[\r\n]+/g, " "));
  if (!clean.trim()) throw new EditError("A scene needs a name");
  if (clean.length > 120) throw new EditError("That name is too long");
  const els = scanElements(html);
  const title = els.find((e) => e.tag === "title" && e.closed);
  const text = escapeText(clean);
  if (title) return html.slice(0, title.innerStart) + text + html.slice(title.innerEnd);
  const head = els.find((e) => e.tag === "head" && e.closed);
  if (!head) return html;
  const first = els.find((e) => e.parent === head.id);
  const p = insertPatch(html, els, first ? { id: head.id, insert: `<title>${text}</title>`, before: first.id } : { id: head.id, insert: `<title>${text}</title>` }, false);
  return html.slice(0, p.from) + p.text + html.slice(p.to);
}

/** Where the version stamp goes: the root <html>, else (a bare fragment) the first top-level element. */
function stampedElement(els: ScannedElement[]): number | null {
  const html = els.find((e) => e.tag === "html" && e.parent === null);
  return (html ?? els.find((e) => e.parent === null && !["script", "style", "link", "meta", "title"].includes(e.tag)) ?? null)?.id ?? null;
}

/**
 * The scene with data-vs="<id>" on every start tag, for the editor and the program page. Never written to disk.
 * With `hash`, the <html> element (or a fragment's first element) also carries data-vs-hash="<hash>":
 * the version those ids belong to, so a page showing it can tell whether an edit's ids are for it.
 */
export function tagForEdit(html: string, hash?: string): string {
  const els = scanElements(html);
  const stampAt = stampedElement(els);
  let out = html;
  for (let k = els.length - 1; k >= 0; k--) {
    const el = els[k]!;
    const at = el.start + 1 + el.tag.length;
    const stamp = hash && el.id === stampAt ? ` data-vs-hash="${hash.replace(/[^\w-]/g, "")}"` : "";
    out = `${out.slice(0, at)} data-vs="${el.id}"${stamp}${out.slice(at)}`;
  }
  return out;
}

/** The file `tagForEdit` started from: removes exactly the ids it added, nothing else. */
export function untagForEdit(tagged: string): string {
  const els = scanElements(tagged);
  const stampAt = stampedElement(els);
  let out = tagged;
  for (let k = els.length - 1; k >= 0; k--) {
    const el = els[k]!;
    const at = el.start + 1 + el.tag.length;
    const attr = ` data-vs="${el.id}"`;
    if (!out.startsWith(attr, at)) continue;
    let end = at + attr.length;
    const stamp = el.id === stampAt ? /^ data-vs-hash="[\w-]*"/.exec(out.slice(end)) : null;
    if (stamp) end += stamp[0].length;
    out = out.slice(0, at) + out.slice(end);
  }
  return out;
}

// ---------------------------------------------------------------- conflicts

/** What makes an element itself: its start tag, its text when it's a leaf, and the start tag it sits in. */
function signature(html: string, el: ScannedElement, els: ScannedElement[]) {
  // Every enclosing start tag, minus its style (a moved panel shouldn't mark everything inside it).
  const chain: string[] = [];
  for (let up = el.parent; up !== null; up = els[up]!.parent) {
    chain.push(html.slice(els[up]!.start, els[up]!.openEnd).replace(/\sstyle\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/i, ""));
  }
  return `${html.slice(el.start, el.openEnd)}\u0000${el.leaf ? textOf(html, el) : ""}\u0000${chain.join("\u0001")}`;
}

/** Ids in `next` whose start tag or text isn't in `prev`: what someone else changed. */
export function changedElements(prev: string, next: string): number[] {
  const before = new Map<string, number>();
  const a = scanElements(prev);
  for (const el of a) {
    const s = signature(prev, el, a);
    before.set(s, (before.get(s) ?? 0) + 1);
  }
  const changed: number[] = [];
  const b = scanElements(next);
  for (const el of b) {
    const s = signature(next, el, b);
    const left = before.get(s) ?? 0;
    if (left > 0) before.set(s, left - 1);
    else changed.push(el.id);
  }
  return changed;
}

/**
 * Find element `id` of `prev` in `next`: the one element with the same start tag, the same text (for
 * a text edit) and the same enclosing start tag. Null when there's none, or more than one: the
 * editor then says the change can't go there. Never replays onto a guess.
 */
export function retarget(prev: string, next: string, edit: SceneEdit): SceneEdit | null {
  // Something added to the scene goes into the new version's scene too (at the end: where it was may be gone).
  if ("insert" in edit) {
    const from = sceneRoot(prev), to = sceneRoot(next);
    return from === edit.id && to !== null ? { id: to, insert: edit.insert } : null;
  }
  const a = scanElements(prev);
  const el = a[edit.id];
  if (!el) return null;
  const open = prev.slice(el.start, el.openEnd);
  const parentOpen = (html: string, els: ScannedElement[], e: ScannedElement) =>
    e.parent === null ? "" : html.slice(els[e.parent]!.start, els[e.parent]!.openEnd);
  const text = el.leaf ? textOf(prev, el) : null;
  const b = scanElements(next);
  const sameTag = b.filter((e) => e.tag === el.tag);
  const kind = editKind(edit);
  const fits = (html: string, e: ScannedElement) =>
    kind === "text" ? e.leaf : kind === "move" ? positionOf(html, e) !== null : kind === "size" ? sizeOf(html, e) !== null && (("left" in edit && edit.left !== undefined) || ("top" in edit && edit.top !== undefined) ? positionOf(html, e) !== null : true) : kind === "src" ? e.tag === "img" : true;
  const sameOpen = sameTag.filter((e) => next.slice(e.start, e.openEnd) === open && fits(next, e));
  const twin = (html: string, els: ScannedElement[], e: ScannedElement) =>
    html.slice(e.start, e.openEnd) === open && (text === null || (e.leaf && textOf(html, e) === text)) && parentOpen(html, els, e) === parentOpen(prev, a, el);
  // Exactly one element that's the same in every way we can see. Twins (or none) can't be told apart.
  const exact = sameOpen.filter((e) => twin(next, b, e));
  const pick = exact.length === 1 ? exact[0] : undefined;
  return pick ? { ...edit, id: pick.id } : null;
}
