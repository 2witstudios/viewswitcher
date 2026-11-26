// Everything the editor does inside its frame. The frame loads the scene with ?inert (served with
// script-src 'none'), so it's the one scene frame that may be same-origin and the only one whose
// document is read: nothing else in the app touches contentDocument. Elements are found by the
// data-vs ids the server adds for ?edit; they're the source's element ids (see html-scan.ts).
import { isStructural, movableIn } from "@viewswitcher/shared";
import type { Box, idsAfter, InsertEdit, RemoveEdit, SceneBase, SceneEdit } from "@viewswitcher/shared";
import type { Pos, Size } from "./geometry";

/** Element ids under a scene point: the text there, the box that moves with it, and an image. */
export type Hit = { leaf: number | null; move: number | null; image: number | null };
export const NO_HIT: Hit = { leaf: null, move: null, image: null };

export const frameDoc = (frame: HTMLIFrameElement | null): Document | null => frame?.contentDocument ?? null;
export const nodeOf = (d: Document | null, id: number) => d?.querySelector<HTMLElement>(`[data-vs="${id}"]`) ?? null;

/** Where element `id` is on the stage, in scene pixels (the frame is 1920×1080, scaled outside it). */
export function rectIn(d: Document | null, id: number | null): Box | null {
  if (id === null) return null;
  const r = nodeOf(d, id)?.getBoundingClientRect();
  return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
}

/** The version the frame shows: stamped on <html>, or on a bare fragment's first element. */
export const shownVersion = (d: Document) => d.documentElement.dataset.vsHash ?? d.querySelector<HTMLElement>("[data-vs-hash]")?.dataset.vsHash;

// Undo and "is this a change?" compare with what's on screen now, not the last saved base: a save
// may still be on its way. The frame holds the inline style the latest change gave it.
const px = (v: string | undefined) => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : null;
};
export function shownPos(d: Document | null, id: number, filePos: Pos | null): Pos | null {
  if (!filePos) return null;
  const el = nodeOf(d, id);
  return { left: px(el?.style.left) ?? filePos.left, top: px(el?.style.top) ?? filePos.top };
}
export function shownSize(d: Document | null, id: number, fileSize: Size | null): Size | null {
  if (!fileSize) return null;
  const el = nodeOf(d, id);
  return { width: px(el?.style.width) ?? fileSize.width, height: px(el?.style.height) ?? fileSize.height };
}

/** Show a text, picture, move or resize edit in the frame (adds and deletes go through `applyStructure`). */
export function applyEdit(d: Document | null, edit: SceneEdit) {
  const el = nodeOf(d, edit.id);
  if (!el) return;
  if ("text" in edit) el.textContent = edit.text;
  else if ("src" in edit) el.setAttribute("src", edit.src);
  else if (!isStructural(edit)) {
    if ("width" in edit) {
      el.style.width = `${edit.width}px`;
      el.style.height = `${edit.height}px`;
    }
    if (edit.left !== undefined) el.style.left = `${edit.left}px`;
    if (edit.top !== undefined) el.style.top = `${edit.top}px`;
  }
}

export function hitAt(d: Document | null, b: SceneBase | null, x: number, y: number): Hit {
  const out: Hit = { ...NO_HIT };
  if (!b || !d) return out;
  let el: Element | null = d.elementFromPoint(x, y);
  while (el) {
    const id = Number((el as HTMLElement).dataset?.vs);
    if (Number.isInteger(id) && b.els[id]) {
      if (out.leaf === null && out.move === null && b.els[id]!.leaf) out.leaf = id;
      if (out.move === null && movableIn(b, id)) out.move = id;
      if (out.image === null && (out.move === null || out.move === id) && b.els[id]!.tag === "img") out.image = id;
    }
    el = el.parentElement;
  }
  return out;
}

export const textShown = (d: Document | null, id: number) => nodeOf(d, id)?.textContent ?? null;

const EDITOR_STYLE = "[contenteditable]{outline:none;caret-color:currentColor;cursor:text}[contenteditable]::selection{background:rgba(244,245,247,.28)}";
/** Editor-only touches inside a freshly loaded frame (never saved). */
export function prepareFrame(d: Document) {
  // What scene.js does for ?preview (it doesn't run here): the ground and camera box labels.
  d.documentElement.classList.add("preview");
  // While typing, the scene itself is under the pointer: a file dropped there mustn't open in it.
  for (const t of ["dragover", "drop"]) d.addEventListener(t, (e) => (e as DragEvent).dataTransfer?.types.includes("Files") && e.preventDefault());
  // No browser focus ring while typing.
  if (d.head && !d.getElementById("vs-editor-style")) {
    const style = d.createElement("style");
    style.id = "vs-editor-style";
    style.textContent = EDITOR_STYLE;
    d.head.append(style);
  }
}

/** Keys pressed while the frame has focus (typing) reach the editor too. */
export function listenKeys(d: Document | null, onKey: (e: KeyboardEvent) => void) {
  d?.addEventListener("keydown", onKey);
  return () => d?.removeEventListener("keydown", onKey);
}

// ---------------------------------------------------------------- typing in place

/** Make element `id` editable, focused, with all its text selected. Returns the text it had, or null if it's not there. */
export function beginTyping(d: Document | null, id: number): string | null {
  const el = nodeOf(d, id);
  if (!el || !d) return null;
  const original = el.textContent ?? "";
  el.setAttribute("contenteditable", "plaintext-only");
  if (el.contentEditable !== "plaintext-only") el.setAttribute("contenteditable", "true");
  el.spellcheck = false;
  el.focus();
  const range = d.createRange();
  range.selectNodeContents(el);
  const sel = d.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  return original;
}

/** Stop typing in element `id`. Returns what was typed, or null if it's gone. */
export function endTyping(d: Document | null, id: number): string | null {
  const el = nodeOf(d, id);
  if (!el) return null;
  el.removeAttribute("contenteditable");
  el.blur();
  return el.textContent ?? "";
}

export function setShownText(d: Document | null, id: number, text: string) {
  const el = nodeOf(d, id);
  if (el) el.textContent = text;
}

/** While element `id` is being typed in: each keystroke, Return and Esc, plain-text paste, and a press outside it. */
export function listenWhileTyping(d: Document | null, id: number, on: { input: (text: string) => void; enter: () => void; escape: () => void; outside: () => void }) {
  const el = nodeOf(d, id);
  if (!el || !d) return () => {};
  const onInput = () => on.input(el.textContent ?? "");
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      on.enter();
    } else if (e.key === "Escape") {
      e.preventDefault();
      on.escape();
    }
  };
  const onPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const text = (e.clipboardData?.getData("text/plain") ?? "").replace(/[ \t\n\r\f]+/g, " ");
    d.execCommand("insertText", false, text);
  };
  const onOutside = (e: PointerEvent) => {
    if (!el.contains(e.target as Node)) on.outside();
  };
  el.addEventListener("input", onInput);
  el.addEventListener("keydown", onKey);
  el.addEventListener("paste", onPaste);
  d.addEventListener("pointerdown", onOutside, true);
  return () => {
    el.removeEventListener("input", onInput);
    el.removeEventListener("keydown", onKey);
    el.removeEventListener("paste", onPaste);
    d.removeEventListener("pointerdown", onOutside, true);
  };
}

// ---------------------------------------------------------------- adding and deleting

/** An element's tag as the file has it: ?inert serves every <meta> as <link data-vs-meta> (scene-sandbox.ts). */
const tagOf = (n: HTMLElement) => ("vsMeta" in n.dataset ? "meta" : n.tagName.toLowerCase());
/**
 * How the frame's ids line up with version `b`: how many of `b`'s elements it shows, and whether
 * every id it has names one of them, once, with the same tag.
 */
export function idCheck(d: Document, b: SceneBase): { shown: number; fits: boolean } {
  const seen = new Set<number>();
  let fits = true;
  for (const n of d.querySelectorAll<HTMLElement>("[data-vs]")) {
    const id = Number(n.dataset.vs);
    const el = Number.isInteger(id) ? b.els[id] : undefined;
    if (!el || seen.has(id) || el.tag !== tagOf(n)) fits = false;
    seen.add(id);
  }
  return { shown: seen.size, fits };
}
/**
 * Taken when a frame has loaded the version it should: elements the browser never puts in the
 * document (a <template>'s content) don't count against later checks, nor do tags it renames.
 */
export type IdBaseline = { absent: number; tags: boolean };
export function idBaseline(d: Document, b: SceneBase): IdBaseline {
  const c = idCheck(d, b);
  return { absent: b.els.length - c.shown, tags: c.fits };
}
/** Whether the frame's ids still match the source after an add or delete was patched in by hand. */
export function idsMatch(d: Document, b: SceneBase, baseline: IdBaseline): boolean {
  const c = idCheck(d, b);
  return c.shown === b.els.length - baseline.absent && (!baseline.tags || c.fits);
}

/**
 * The frame follows a saved add or delete: the same change in its DOM, and every data-vs id moved
 * to the new numbering, so it matches the saved file without loading it again.
 */
export function applyStructure(d: Document, edit: InsertEdit | RemoveEdit, ids: ReturnType<typeof idsAfter>) {
  if ("remove" in edit) nodeOf(d, edit.id)?.remove();
  for (const n of d.querySelectorAll<HTMLElement>("[data-vs]")) {
    const m = ids.map(Number(n.dataset.vs));
    if (m !== null) n.dataset.vs = String(m);
  }
  if ("insert" in edit) {
    const tpl = d.createElement("template");
    tpl.innerHTML = edit.insert;
    const fresh = tpl.content.firstElementChild as HTMLElement | null;
    if (fresh) {
      [fresh, ...fresh.querySelectorAll<HTMLElement>("*")].forEach((n, i) => (n.dataset.vs = String(ids.added! + i)));
      const parent = nodeOf(d, edit.id);
      const before = edit.before !== undefined ? nodeOf(d, ids.map(edit.before) ?? -1) : null;
      parent?.insertBefore(fresh, before);
    }
  }
}
