// Live slot reports that arrive out of order must not leave OBS mid-drag.
import { describe, expect, test } from "bun:test";
import { createSlotOrder } from "./slot-order";

describe("slot report order", () => {
  test("a report older than one already applied from the same page is ignored", () => {
    const accept = createSlotOrder();
    expect(accept("p1", 1)).toBe(true);
    expect(accept("p1", 3)).toBe(true); // the final drag position
    expect(accept("p1", 2)).toBe(false); // arrived late: mid-drag
    expect(accept("p1", 4)).toBe(true);
  });
  test("pages are independent, and unnumbered reports always apply", () => {
    const accept = createSlotOrder();
    expect(accept("p1", 10)).toBe(true);
    expect(accept("p2", 1)).toBe(true); // a second program page (another browser) starts its own count
    expect(accept(undefined, undefined)).toBe(true);
    expect(accept("p1", undefined)).toBe(true);
  });
});
