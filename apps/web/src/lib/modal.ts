// A modal dialog (role="dialog" aria-modal="true", e.g. Edit with AI) owns the keyboard while it's
// open: pages behind it (the scene editor's Delete, arrows, undo) must not act on keys meant for it.
export const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"]';

/** Whether a modal dialog is open in `root` (the document). */
export const modalOpen = (root: Pick<ParentNode, "querySelector">): boolean => root.querySelector(MODAL_SELECTOR) !== null;

/** Tab and Shift-Tab wrap inside `items` (the dialog's focusable elements): the next one to focus, or null to let the browser move. */
export function trapTab<T>(items: T[], active: T | null, back: boolean): T | null {
  if (!items.length) return null;
  const i = active === null ? -1 : items.indexOf(active);
  if (i === -1) return back ? items[items.length - 1]! : items[0]!;
  if (back && i === 0) return items[items.length - 1]!;
  if (!back && i === items.length - 1) return items[0]!;
  return null;
}
