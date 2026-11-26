// What the scene editor knows about one version of a scene file: its source, the hash the server
// gave it, and the scanned elements whose ids every edit names. Pure reads over that, shared so they
// are tested once and the editor has no second copy of any of them.
import { collapseHtmlSpace, decodeEntities, editKind, isLibraryUrl, isStructural, positionOf, scanElements, sizeOf, textOf, untagForEdit } from "./html-scan";
import type { ScannedElement, SceneEdit } from "./html-scan";

export type SceneBase = { source: string; hash: string; els: ScannedElement[] };

/** The file as the editor reads it (`?edit` adds data-vs ids, which are never part of the file). */
export const toBase = ({ html, hash }: { html: string; hash: string }): SceneBase => {
  const source = untagForEdit(html);
  return { source, hash, els: scanElements(source) };
};

export const posIn = (b: SceneBase, id: number) => (b.els[id] ? positionOf(b.source, b.els[id]!) : null);
export const sizeIn = (b: SceneBase, id: number) => (b.els[id] ? sizeOf(b.source, b.els[id]!) : null);
/** An attribute's value as written in the file; null when it's missing or bare. */
export const attrIn = (b: SceneBase, id: number, name: string) => {
  const a = b.els[id]?.attrs.find((x) => x.name === name);
  return a && a.valueStart >= 0 ? b.source.slice(a.valueStart, a.valueEnd) : null;
};
/** Boxes with an inline left and top the editor can move; never the page itself. */
export const movableIn = (b: SceneBase, id: number) => !["html", "head", "body"].includes(b.els[id]?.tag ?? "html") && posIn(b, id) !== null;
/** The nearest movable box around element `id` (not `id` itself), or null. */
export function movableAround(b: SceneBase, id: number): number | null {
  let up = b.els[id]?.parent ?? null;
  while (up !== null && !movableIn(b, up)) up = b.els[up]?.parent ?? null;
  return up;
}
/** Camera, screen and guest boxes: the OBS sources go in them. */
export const isSlot = (b: SceneBase, id: number) => attrIn(b, id, "data-slot") !== null;
/** An image a picture can replace: one from the library, without a srcset that would still show the old one. */
export const replaceableImage = (b: SceneBase, id: number) => b.els[id]?.tag === "img" && isLibraryUrl(attrIn(b, id, "src") ?? "") && attrIn(b, id, "srcset") === null;
/** The scene's own <title>, as the browser shows it. */
export const titleIn = (b: SceneBase) => {
  const t = b.els.find((e) => e.tag === "title" && e.closed);
  return t ? collapseHtmlSpace(decodeEntities(b.source.slice(t.innerStart, t.innerEnd))) || null : null;
};
export const slotsIn = (b: SceneBase) => b.els.flatMap((e) => attrIn(b, e.id, "data-slot") ?? []);

/** The value an edit would put back: the element's text, picture, size or position in `b`. */
export function valueIn(b: SceneBase, edit: SceneEdit): SceneEdit | null {
  const el = b.els[edit.id];
  if (!el) return null;
  if ("text" in edit) return el.leaf ? { id: edit.id, text: textOf(b.source, el) } : null;
  if ("src" in edit) {
    const src = attrIn(b, edit.id, "src");
    return el.tag === "img" && src !== null ? { id: edit.id, src } : null;
  }
  if (isStructural(edit)) return null;
  const p = posIn(b, edit.id);
  if ("width" in edit) {
    const z = sizeIn(b, edit.id);
    return z && (p || (edit.left === undefined && edit.top === undefined)) ? { id: edit.id, width: z.width, height: z.height, ...(p && edit.left !== undefined ? { left: p.left } : {}), ...(p && edit.top !== undefined ? { top: p.top } : {}) } : null;
  }
  return p ? { id: edit.id, left: p.left, top: p.top } : null;
}

/** A plain name for an element: "Camera box", "Footer", "Notes panel", "Footer title". */
export function nameOf(b: SceneBase, id: number): string {
  const el = b.els[id];
  if (!el) return "Element";
  const container = (e: ScannedElement): string => {
    const slot = attrIn(b, e.id, "data-slot");
    if (slot) return `${slot} box`;
    if (e.tag === "footer") return "Footer";
    if (e.tag === "header") return "Header";
    const label = b.els.find((c) => c.leaf && c.start > e.start && c.end <= e.end && textOf(b.source, c).length <= 24);
    return label ? `${textOf(b.source, label).replace(/^\w/, (c) => c.toUpperCase())} panel` : "Panel";
  };
  if (el.tag === "img") return "Image";
  if (!el.leaf) return container(el);
  const word = /^h[1-6]$/.test(el.tag) ? "title" : el.tag === "p" ? "text" : "label";
  const up = movableAround(b, id);
  return up === null ? word.replace(/^\w/, (c) => c.toUpperCase()) : `${container(b.els[up]!)} ${word}`;
}

/** A change, in words: what it was made to, and to what. */
export function describeEdit(b: SceneBase, edit: SceneEdit): { what: string; value: string } {
  const what = nameOf(b, edit.id);
  switch (editKind(edit)) {
    case "text": return { what, value: (edit as { text: string }).text };
    case "insert": return { what: "Scene", value: "something you added" };
    case "remove": return { what, value: "deleted" };
    case "src": return { what, value: "a new picture" };
    case "size": {
      const e = edit as { width: number; height: number };
      return { what, value: `${e.width} × ${e.height}` };
    }
    default: {
      const e = edit as { left: number; top: number };
      return { what, value: `x ${e.left} · y ${e.top}` };
    }
  }
}

/** Where to mark an element someone else changed: the text or box itself, not the page around it. */
export function markFor(b: SceneBase, id: number): number | null {
  let at: number | null = id;
  while (at !== null && !(b.els[at]?.leaf || movableIn(b, at))) at = b.els[at]?.parent ?? null;
  return at;
}
