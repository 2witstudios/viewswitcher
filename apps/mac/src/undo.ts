// Edit → Undo / Redo in the Mac app.
//
// A menu item with ⌘Z as its accelerator takes the key before the page sees it, and the scene
// editor's Undo listens for ⌘Z in the page. So the menu items forward: when the focus is in
// something you type into (a field, or text being retyped in the editor), they run the native
// text undo there; otherwise they hand the page the ⌘Z it would have had in a browser, and the
// editor's own Undo (which saves the previous value back) runs. Decided for MAC-6; see the plan.

/** Runs in the page: "native" when focus is in editable text, else dispatches ⌘Z (⇧⌘Z for redo) and returns "page". */
export function forwardScript(redo: boolean): string {
  return `(() => {
  let doc = document, el = doc.activeElement;
  while (el && el.tagName === "IFRAME") {
    try { doc = el.contentDocument; el = doc && doc.activeElement; } catch { break; }
  }
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return "native";
  const target = el && el !== doc.body ? el : doc;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", metaKey: true, shiftKey: ${redo}, bubbles: true, cancelable: true }));
  return "page";
})()`;
}
