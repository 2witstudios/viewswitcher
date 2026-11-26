import { describe, expect, test } from "bun:test";
import { clampSize, cornerPoint, dragTo, MIN_SIZE, nudge, resizeEdit, resizeTo, sidesOf } from "./geometry";

const box = { x: 100, y: 100, w: 200, h: 100 };

describe("dragTo", () => {
  const d = { start: { left: 100, top: 100 }, rect: box, others: [], x0: 150, y0: 150 };

  test("follows the pointer on the 8 px grid", () => {
    expect(dragTo(d, { x: 150, y: 150 }, 7)).toMatchObject({ left: 104, top: 104 });
    expect(dragTo(d, { x: 163, y: 141 }, 7)).toMatchObject({ left: 112, top: 88 });
    expect(dragTo(d, { x: 150, y: 150 }, 7).guides).toEqual({ x: [], y: [] });
  });

  test("the grid is the saved left and top's, not the screen's", () => {
    // The box sits 3 px off its saved position on screen (a parent's offset): the saved value stays on the grid.
    const off = { ...d, start: { left: 97, top: 97 } };
    const p = dragTo(off, { x: 170, y: 170 }, 7);
    expect(p.left % 8).toBe(0);
    expect(p.top % 8).toBe(0);
  });

  test("snaps exactly to another box's edge, and says where", () => {
    const other = { x: 400, y: 300, w: 100, h: 100 };
    // The box's right edge (300 + dx) comes within 7 px of the other's left edge (400).
    const p = dragTo({ ...d, others: [other] }, { x: 150 + 97, y: 150 }, 7);
    expect(p.left).toBe(200);
    expect(p.guides.x).toContain(400);
  });
});

describe("resizeTo", () => {
  const start = { left: 100, top: 100, width: 400, height: 200 };

  test("the opposite corner stays put", () => {
    expect(resizeTo({ corner: "se", start, x0: 500, y0: 300, slot: false }, { x: 540, y: 340 }, false)).toEqual({ left: 100, top: 100, width: 440, height: 240 });
    expect(resizeTo({ corner: "nw", start, x0: 100, y0: 100, slot: false }, { x: 60, y: 60 }, false)).toEqual({ left: 60, top: 60, width: 440, height: 240 });
    expect(resizeTo({ corner: "ne", start, x0: 500, y0: 100, slot: false }, { x: 540, y: 60 }, false)).toEqual({ left: 100, top: 60, width: 440, height: 240 });
    expect(resizeTo({ corner: "sw", start, x0: 100, y0: 300, slot: false }, { x: 60, y: 340 }, false)).toEqual({ left: 60, top: 100, width: 440, height: 240 });
  });

  test("sizes go on the grid and never below the smallest box", () => {
    expect(resizeTo({ corner: "se", start, x0: 500, y0: 300, slot: false }, { x: 503, y: 305 }, false)).toMatchObject({ width: 400, height: 208 });
    expect(resizeTo({ corner: "se", start, x0: 500, y0: 300, slot: false }, { x: -900, y: -900 }, false)).toMatchObject({ width: MIN_SIZE, height: MIN_SIZE });
  });

  test("a device box keeps 16:9 unless Shift is held", () => {
    const slot = { corner: "se" as const, start: { left: 0, top: 0, width: 640, height: 360 }, x0: 640, y0: 360, slot: true };
    const kept = resizeTo(slot, { x: 960, y: 380 }, false);
    expect(kept.width / kept.height).toBeCloseTo(16 / 9);
    expect(kept.width % 16).toBe(0);
    // Mostly downwards: the height leads.
    const tall = resizeTo(slot, { x: 650, y: 540 }, false);
    expect(tall.width / tall.height).toBeCloseTo(16 / 9);
    expect(tall.height).toBeGreaterThan(360);
    expect(resizeTo(slot, { x: 960, y: 380 }, true)).toMatchObject({ width: 960, height: 384 });
  });
});

describe("corners", () => {
  test("each corner moves its own edges, and the edit carries only those", () => {
    expect(sidesOf("nw")).toEqual({ west: true, north: true });
    expect(sidesOf("se")).toEqual({ west: false, north: false });
    const v = { left: 1, top: 2, width: 300, height: 200 };
    expect(resizeEdit(7, "se", v)).toEqual({ id: 7, width: 300, height: 200 });
    expect(resizeEdit(7, "nw", v)).toEqual({ id: 7, width: 300, height: 200, left: 1, top: 2 });
    expect(resizeEdit(7, "ne", v)).toEqual({ id: 7, width: 300, height: 200, top: 2 });
    expect(resizeEdit(7, "sw", v)).toEqual({ id: 7, width: 300, height: 200, left: 1 });
  });

  test("handles sit on the box's corners", () => {
    expect(cornerPoint(box, "nw")).toEqual({ x: 100, y: 100 });
    expect(cornerPoint(box, "se")).toEqual({ x: 300, y: 200 });
    expect(cornerPoint(box, "ne")).toEqual({ x: 300, y: 100 });
    expect(cornerPoint(box, "sw")).toEqual({ x: 100, y: 200 });
  });
});

describe("keys and typed sizes", () => {
  test("arrows nudge 1 px, 10 with Shift; other keys don't", () => {
    expect(nudge({ left: 10, top: 10 }, "ArrowLeft", false)).toEqual({ left: 9, top: 10 });
    expect(nudge({ left: 10, top: 10 }, "ArrowDown", true)).toEqual({ left: 10, top: 20 });
    expect(nudge({ left: 10, top: 10 }, "a", false)).toBeNull();
  });

  test("a typed size is whole pixels and at least the smallest box", () => {
    expect(clampSize(100.4, 3)).toEqual({ width: 100, height: MIN_SIZE });
  });
});
