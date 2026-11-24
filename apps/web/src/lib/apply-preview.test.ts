// PR #1 architecture #1: a preview made against another version of the file must not touch the stream.
import { describe, expect, test } from "bun:test";
import { applyPreview, type PreviewDoc, type PreviewTarget } from "./apply-preview";

function el(children = 0, slot = false): PreviewTarget {
  return { textContent: "old", childElementCount: children, style: { left: "1px", top: "2px" }, matches: (s) => slot && s === "[data-slot]", querySelector: () => null };
}
function doc(hash: string | undefined, els: Record<number, PreviewTarget>): PreviewDoc {
  return { documentElement: { dataset: { vsHash: hash } }, querySelector: (s) => els[Number(/data-vs="(\d+)"/.exec(s)?.[1])] ?? null };
}

describe("applyPreview", () => {
  test("applies text and position when the frame shows the editor's version", () => {
    const t = el(), cam = el(0, true);
    const d = doc("v1", { 3: t, 4: cam });
    expect(applyPreview(d, "v1", { id: 3, text: "new" })).toEqual({ slotMoved: false });
    expect(t.textContent).toBe("new");
    expect(applyPreview(d, "v1", { id: 4, left: 40, top: 50 })).toEqual({ slotMoved: true });
    expect(cam.style).toEqual({ left: "40px", top: "50px" });
  });
  test("ignores a preview for another version (the agent saved: ids shifted)", () => {
    const panel = el(3, true);
    const d = doc("v2", { 3: panel });
    expect(applyPreview(d, "v1", { id: 3, text: "typed" })).toBeNull();
    expect(applyPreview(d, "v1", { id: 3, left: 0, top: 0 })).toBeNull();
    expect(panel.textContent).toBe("old");
    expect(panel.style.left).toBe("1px");
    expect(applyPreview(doc(undefined, { 3: el() }), "", { id: 3, text: "x" })).toBeNull();
  });
  test("a fragment's stamp on its first element counts (round 3)", () => {
    const t = el();
    const d: PreviewDoc = {
      documentElement: { dataset: {} },
      querySelector: (s) => (s === "[data-vs-hash]" ? { ...el(), dataset: { vsHash: "v1" } } : s.includes('"3"') ? t : null),
    };
    expect(applyPreview(d, "v1", { id: 3, text: "new" })).toEqual({ slotMoved: false });
    expect(t.textContent).toBe("new");
  });
  test("never puts text into an element with children (it would wipe them, slots included)", () => {
    const parent = el(2);
    expect(applyPreview(doc("v1", { 5: parent }), "v1", { id: 5, text: "x" })).toBeNull();
    expect(parent.textContent).toBe("old");
  });
});
