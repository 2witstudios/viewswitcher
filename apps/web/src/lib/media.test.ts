import { describe, expect, test } from "bun:test";
import { DECK, isUprightPhone, SIDEWAYS, UPRIGHT } from "./media";

describe("phone layouts (PHONE-3, PHONE-12)", () => {
  test("the queries match styles.css", () => {
    expect(UPRIGHT).toBe("(max-width: 600px)");
    expect(DECK).toBe("(max-height: 500px) and (max-width: 1000px) and (pointer: coarse)");
  });
  test("every phone sideways gets the deck, up to the 16 and 17 Pro Max (956 pt); an iPad with the keyboard up doesn't", () => {
    const [, maxH, maxW] = DECK.match(/max-height: (\d+)px\) and \(max-width: (\d+)px/)!.map(Number);
    for (const [w, h, deck] of SIDEWAYS) expect({ w, h, deck: h <= maxH && w <= maxW }).toEqual({ w, h, deck });
  });
  test("upright is the narrow layout unless the deck applies (a small phone sideways is both)", () => {
    expect(isUprightPhone({ upright: true, deck: false })).toBe(true);
    expect(isUprightPhone({ upright: true, deck: true })).toBe(false);
    expect(isUprightPhone({ upright: false, deck: true })).toBe(false);
    expect(isUprightPhone({ upright: false, deck: false })).toBe(false);
  });
});
