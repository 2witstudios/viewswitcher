import { describe, expect, test } from "bun:test";
import type { LiveState } from "@viewswitcher/shared";
import { trayStatus } from "./status";

const base: LiveState = {
  onAir: null,
  obs: { connected: true, recording: false, streaming: false },
  obsSetup: { scene: true, program: true, ground: true, missingDevices: [] },
  usb: { enabled: true, attached: false, connected: false },
  warnings: [],
};

describe("trayStatus (MAC-6 menu bar)", () => {
  test("nothing on air: template icon, no title", () => {
    expect(trayStatus(base)).toMatchObject({ title: "", live: false, onAir: "Nothing on air", obs: "OBS: connected", ipad: "iPad: not plugged in", obsReady: true });
  });
  test("on air: red icon and the scene as the title, shortened", () => {
    const s = trayStatus({ ...base, onAir: { path: "a/b.html", org: "a", label: "Teaching with the whiteboard and camera" } });
    expect(s.live).toBe(true);
    expect(s.onAir).toBe("On air: Teaching with the whiteboard and camera");
    expect(s.title).toBe("Teaching with the white…");
  });
  test("OBS states", () => {
    expect(trayStatus({ ...base, obs: { ...base.obs, connected: false }, obsSetup: null }).obs).toBe("OBS: not connected");
    const unset = trayStatus({ ...base, obsSetup: { scene: false, program: false, ground: false, missingDevices: ["Camera"] } });
    expect(unset).toMatchObject({ obs: "OBS: needs setup", needsSetup: true, obsReady: false });
    expect(trayStatus({ ...base, obsSetup: { ...base.obsSetup!, missingDevices: ["iPad"] } }).obs).toBe("OBS: connected · add iPad");
    expect(trayStatus({ ...base, obs: { connected: true, recording: true, streaming: true } }).obs).toBe("OBS: connected · live, recording");
  });
  test("iPad states (MAC-4)", () => {
    expect(trayStatus({ ...base, usb: { enabled: true, attached: true, connected: true } }).ipad).toBe("iPad: connected over USB");
    expect(trayStatus({ ...base, usb: { enabled: true, attached: true, connected: false } }).ipad).toBe("iPad: plugged in · open ViewSwitcher on it");
    expect(trayStatus({ ...base, usb: { enabled: false, attached: false, connected: false } }).ipad).toBe("iPad: USB link off");
  });
  test("no server", () => {
    expect(trayStatus(null)).toMatchObject({ onAir: "Server not responding", live: false });
  });
});
