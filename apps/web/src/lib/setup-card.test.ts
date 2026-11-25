import { describe, expect, test } from "bun:test";
import { cardKey, setupCard } from "./setup-card";

const on = { connected: true, recording: false, streaming: false };
const full = { scene: true, program: true, ground: true, ordered: true, missingDevices: [] as string[] };

describe("setupCard", () => {
  test("OBS offline asks to connect", () => {
    expect(setupCard({ obs: { ...on, connected: false }, obsSetup: null })).toEqual({ kind: "connect" });
  });
  test("connected but not checked yet shows nothing", () => {
    expect(setupCard({ obs: on, obsSetup: null })).toBeNull();
  });
  test("a missing scene, source, or program URL offers Set up OBS", () => {
    for (const miss of [{ scene: false }, { program: false }, { ground: false }]) {
      expect(setupCard({ obs: on, obsSetup: { ...full, ...miss } })).toEqual({ kind: "setup" });
    }
  });
  test("missing devices are listed; once all are there the card goes away", () => {
    const c = setupCard({ obs: on, obsSetup: { ...full, missingDevices: ["iPad"] } });
    expect(c).toEqual({ kind: "devices", missing: ["iPad"] });
    expect(cardKey(c!)).toBe("devices:iPad");
    expect(setupCard({ obs: on, obsSetup: full })).toBeNull();
  });
  test("OBS asking for a password, or refusing it, says so (and a dismissed plain card doesn't hide it)", () => {
    for (const auth of ["missing", "wrong"] as const) {
      const c = setupCard({ obs: { ...on, connected: false, auth }, obsSetup: null });
      expect(c).toEqual({ kind: "connect", auth });
      expect(cardKey(c!)).toBe(`connect:${auth}`);
    }
    expect(cardKey({ kind: "connect" })).toBe("connect");
  });
  test("a source added above the program page brings the card back so setup can put it back on top", () => {
    expect(setupCard({ obs: on, obsSetup: { ...full, ordered: false } })).toEqual({ kind: "order" });
    // Missing pieces come first: setup makes them and fixes the order in one go.
    expect(setupCard({ obs: on, obsSetup: { ...full, program: false, ordered: false } })).toEqual({ kind: "setup" });
    expect(setupCard({ obs: on, obsSetup: { ...full, ordered: false, missingDevices: ["iPad"] } })).toEqual({ kind: "order" });
  });
});
