// The program page applying a live edit from the scene editor to the on-air frame's DOM.
import { isStructural, type SceneEdit } from "@viewswitcher/shared";

/** The bits of an element and document this needs (so it can be tested without a browser). */
export type PreviewTarget = {
  textContent: string | null; childElementCount: number; style: { left: string; top: string; width?: string; height?: string };
  matches(sel: string): boolean; querySelector(sel: string): unknown; tagName?: string; setAttribute?(name: string, value: string): void;
};
export type PreviewDoc = {
  documentElement: { dataset: Record<string, string | undefined> };
  querySelector(sel: string): (PreviewTarget & { dataset?: Record<string, string | undefined> }) | null;
};

/** The version a frame shows: stamped on <html>, or on a bare fragment's first element. */
export function shownVersion(doc: PreviewDoc): string | undefined {
  return doc.documentElement.dataset.vsHash ?? doc.querySelector("[data-vs-hash]")?.dataset?.vsHash;
}

/**
 * Apply `edit` if it was made against the version the frame shows (`hash` = its data-vs-hash), and
 * only to an element it can change safely: text goes only into an element with no child elements.
 * Returns whether it touched a device slot (so the slots need reporting again), or null if skipped.
 */
export function applyPreview(doc: PreviewDoc, hash: string, edit: SceneEdit): { slotMoved: boolean } | null {
  const shown = shownVersion(doc);
  if (!shown || shown !== hash) return null;
  const el = doc.querySelector(`[data-vs="${Number(edit.id)}"]`);
  if (!el) return null;
  if ("text" in edit) {
    if (el.childElementCount !== 0) return null;
    el.textContent = edit.text;
    return { slotMoved: false };
  }
  if ("src" in edit) {
    // Only an image, and only a library file (the server checked the path when it took the preview).
    if (el.tagName?.toLowerCase() !== "img" || !edit.src.startsWith("/library/")) return null;
    el.setAttribute?.("src", edit.src);
    return { slotMoved: false };
  }
  // Adding and deleting reach the stream as the saved file (it swaps in without a transition).
  if (isStructural(edit)) return null;
  if ("width" in edit) {
    el.style.width = `${edit.width}px`;
    el.style.height = `${edit.height}px`;
  }
  if (edit.left !== undefined) el.style.left = `${edit.left}px`;
  if (edit.top !== undefined) el.style.top = `${edit.top}px`;
  return { slotMoved: el.matches("[data-slot]") || !!el.querySelector("[data-slot]") };
}
