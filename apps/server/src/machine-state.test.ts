import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { machineStateDir, migrateMachineState } from "./machine-state";

const scratch = () => mkdtempSync(join(tmpdir(), "vs-ms-"));
function library(files: Record<string, string>) {
  const lib = scratch();
  mkdirSync(join(lib, ".viewswitcher"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(lib, ".viewswitcher", name), text);
  return lib;
}

describe("machineStateDir", () => {
  test("another spelling of the same library (through a link) is the same folder", () => {
    const real = scratch();
    const link = join(scratch(), "via-link");
    require("node:fs").symlinkSync(real, link);
    expect(machineStateDir("/state", link)).toBe(machineStateDir("/state", real));
  });

  test("one folder per library path, under the state root, outside the library", () => {
    const a = machineStateDir("/state", "/Users/me/ViewSwitcher Library");
    expect(a).toMatch(/^\/state\/libraries\/[0-9a-f]{16}$/);
    expect(machineStateDir("/state", "/Users/me/ViewSwitcher Library/")).toBe(a); // the same path, written another way
    expect(machineStateDir("/state", "/Users/me/Other Library")).not.toBe(a);
  });
});

describe("migrateMachineState", () => {
  test("paired devices that came in the library are never trusted: they're dropped, so phones pair again", async () => {
    const lib = library({ "devices.json": JSON.stringify({ devices: [{ id: "x", tokenHash: "abc" }] }) });
    const dir = scratch();
    expect(await migrateMachineState(lib, dir)).toEqual({ settings: null, devices: "dropped" });
    expect(existsSync(join(lib, ".viewswitcher", "devices.json"))).toBe(false);
    expect(existsSync(join(dir, "devices.json"))).toBe(false);
  });

  test('an agent setting of "never" carries over; anything looser goes back to the default', async () => {
    const never = library({ "settings.json": JSON.stringify({ agentOnAir: "never" }) });
    const d1 = scratch();
    expect((await migrateMachineState(never, d1)).settings).toBe("kept-never");
    expect(JSON.parse(readFileSync(join(d1, "settings.json"), "utf8"))).toEqual({ agentOnAir: "never" });

    const always = library({ "settings.json": JSON.stringify({ agentOnAir: "always" }) });
    const d2 = scratch();
    expect((await migrateMachineState(always, d2)).settings).toBe("dropped");
    expect(existsSync(join(d2, "settings.json"))).toBe(false); // the default (When not live) until chosen again
    expect(existsSync(join(always, ".viewswitcher", "settings.json"))).toBe(false);
  });

  test("read as settings.ts reads it: an unreadable file or a bad value meant never and carries over; no setting yet is the default", async () => {
    for (const text of ["{ nope", "[]", JSON.stringify({ agentOnAir: "sometimes" })]) {
      const d = scratch();
      expect((await migrateMachineState(library({ "settings.json": text }), d)).settings).toBe("kept-never");
      expect(JSON.parse(readFileSync(join(d, "settings.json"), "utf8"))).toEqual({ agentOnAir: "never" });
    }
    const d = scratch();
    expect((await migrateMachineState(library({ "settings.json": JSON.stringify({ other: 1 }) }), d)).settings).toBe("dropped");
    expect(existsSync(join(d, "settings.json"))).toBe(false);
  });

  test("this Mac's own setting is never overwritten by one in the library", async () => {
    const lib = library({ "settings.json": JSON.stringify({ agentOnAir: "never" }) });
    const dir = scratch();
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ agentOnAir: "always" }));
    expect((await migrateMachineState(lib, dir)).settings).toBe("dropped"); // nothing was carried over
    expect(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"))).toEqual({ agentOnAir: "always" });
  });

  test("nothing to do in a library without them, or one that doesn't exist yet", async () => {
    expect(await migrateMachineState(library({ "state.json": "{}" }), scratch())).toEqual({ settings: null, devices: null });
    expect(await migrateMachineState(join(scratch(), "not-yet"), scratch())).toEqual({ settings: null, devices: null });
  });
});
