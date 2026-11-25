import { describe, expect, test } from "bun:test";
import { DECK, isUprightPhone, UPRIGHT } from "./media";

describe("phone layouts (PHONE-3, PHONE-12)", () => {
  test("the queries match styles.css", () => {
    expect(UPRIGHT).toBe("(max-width: 600px)");
    expect(DECK).toBe("(max-height: 500px) and (pointer: coarse)");
  });
  test("upright is the narrow layout unless the deck applies (a small phone sideways is both)", () => {
    expect(isUprightPhone({ upright: true, deck: false })).toBe(true);
    expect(isUprightPhone({ upright: true, deck: true })).toBe(false);
    expect(isUprightPhone({ upright: false, deck: true })).toBe(false);
    expect(isUprightPhone({ upright: false, deck: false })).toBe(false);
  });
});
