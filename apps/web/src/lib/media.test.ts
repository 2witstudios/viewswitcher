import { describe, expect, test } from "bun:test";
import { DECK, isUprightPhone, UPRIGHT } from "./media";

/** Sideways viewports: [width, height, gets the deck?]. */
const SIDEWAYS: [number, number, boolean][] = [
  [956, 440, true], // iPhone 16 and 17 Pro Max
  [932, 430, true], // 14 and 15 Pro Max
  [844, 390, true],
  [568, 320, true], // SE (1st): the upright query matches too; the deck wins
  [1133, 480, false], // iPad mini sideways, keyboard up
  [1180, 480, false], // iPad Air sideways, keyboard up
  [790, 480, true], // the known trade-off: an iPad in 2/3 Split View with the keyboard up
];

describe("phone layouts", () => {
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
