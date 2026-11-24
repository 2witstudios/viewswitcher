// The program page applying a live edit from the scene editor to the on-air frame's DOM.
import type { SceneEdit } from "@viewswitcher/shared";

/** The bits of an element and document this needs (so it can be tested without a browser). */
export type PreviewTarget = { textContent: string | null; childElementCount: number; style: { left: string; top: string }; matches(sel: string): boolean; querySelector(sel: string): unknown };
export type PreviewDoc = { documentElement: { dataset: Record<string, string | undefined> }; querySelector(sel: string): PreviewTarget | null };

/**
 * Apply `edit` if it was made against the version the frame shows (`hash` = its data-vs-hash), and
 * only to an element it can change safely: text goes only into an element with no child elements.
 * Returns whether it touched a device slot (so the slots need reporting again), or null if skipped.
 */
export function applyPreview(doc: PreviewDoc, hash: string, edit: SceneEdit): { slotMoved: boolean } | null {
  const shown = doc.documentElement.dataset.vsHash;
  if (!shown || shown !== hash) return null;
  const el = doc.querySelector(`[data-vs="${Number(edit.id)}"]`);
  if (!el) return null;
  if ("text" in edit) {
    if (el.childElementCount !== 0) return null;
    el.textContent = edit.text;
    return { slotMoved: false };
  }
  el.style.left = `${edit.left}px`;
  el.style.top = `${edit.top}px`;
  return { slotMoved: el.matches("[data-slot]") || !!el.querySelector("[data-slot]") };
}
