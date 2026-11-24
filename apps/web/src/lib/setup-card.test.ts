import { describe, expect, test } from "bun:test";
import { cardKey, setupCard } from "./setup-card";

const on = { connected: true, recording: false, streaming: false };
const full = { scene: true, program: true, ground: true, missingDevices: [] as string[] };

describe("setupCard (MAC-3)", () => {
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
});
