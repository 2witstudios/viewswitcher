import { describe, expect, test } from "bun:test";
import { cueAfterTap, cueAfterOnAir, PHONE_QUERY } from "./cue";

describe("cue then Take on a phone (PHONE-2)", () => {
  test("a tap on a scene that isn't on air cues it", () => {
    expect(cueAfterTap({ cued: null, onAir: "a" }, "b")).toBe("b");
  });
  test("a tap on another scene moves the cue", () => {
    expect(cueAfterTap({ cued: "b", onAir: "a" }, "c")).toBe("c");
  });
  test("a tap on the cued scene clears the cue", () => {
    expect(cueAfterTap({ cued: "b", onAir: "a" }, "b")).toBeNull();
  });
  test("a tap on the scene on air clears the cue", () => {
    expect(cueAfterTap({ cued: "b", onAir: "a" }, "a")).toBeNull();
    expect(cueAfterTap({ cued: null, onAir: "a" }, "a")).toBeNull();
  });
  test("with nothing on air, a tap cues", () => {
    expect(cueAfterTap({ cued: null, onAir: undefined }, "a")).toBe("a");
  });
  test("the cue clears once the cued scene goes on air, from this phone or anywhere else", () => {
    expect(cueAfterOnAir("b", "b")).toBeNull();
  });
  test("the cue stays when something else goes on air", () => {
    expect(cueAfterOnAir("b", "c")).toBe("b");
    expect(cueAfterOnAir("b", undefined)).toBe("b");
    expect(cueAfterOnAir(null, "c")).toBeNull();
  });
  test("the phone layout and cue then Take start at the same width", () => {
    expect(PHONE_QUERY).toBe("(max-width: 600px)");
  });
});
