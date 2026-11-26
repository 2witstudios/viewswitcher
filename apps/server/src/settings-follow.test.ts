// settings.json edited by hand while the real server runs (from source, OBS offline, no USB, a temp
// library): the agent on-air setting in live state, which the agents' guard reads, follows the file.
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Subprocess } from "bun";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { machineStateDir } from "./machine-state";
import { freePort, SERVER_START_MS, startServer, TEST_STATE_ROOT } from "./test-server";

let port = 0;
let proc: Subprocess;
const library = mkdtempSync(join(tmpdir(), "vs-settings-"));
/** This Mac's settings for the library: outside it (machine-state.ts). */
const dir = machineStateDir(TEST_STATE_ROOT, library);
const file = join(dir, "settings.json");
const onAir = async () => ((await (await fetch(`http://127.0.0.1:${port}/api/state`)).json()) as { agent: { onAir: string } }).agent.onAir;
/** The setting once it reads `want`, or what it still read after 10 s. */
async function settlesOn(want: string) {
  let now = "";
  for (const end = Date.now() + 10_000; Date.now() < end; await Bun.sleep(50)) if ((now = await onAir()) === want) break;
  return now;
}

beforeAll(async () => {
  port = await freePort();
  proc = await startServer({ PORT: String(port), OBS_URL: "ws://127.0.0.1:1", VIEWSWITCHER_USB: "0", VIEWSWITCHER_LIBRARY: library, VIEWSWITCHER_ORIGINS: "", VIEWSWITCHER_PARENT_PID: "" }, () =>
    fetch(`http://127.0.0.1:${port}/api/state`).then((r) => r.ok),
  );
}, SERVER_START_MS);
afterAll(() => {
  proc?.kill();
  rmSync(library, { recursive: true, force: true });
});

test("a hand edit is followed: a choice, a file that can't be read (Never), the file gone (the default)", async () => {
  expect(await onAir()).toBe("not-live");
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ agentOnAir: "always" }));
  expect(await settlesOn("always")).toBe("always");
  writeFileSync(file, "{ not json");
  expect(await settlesOn("never")).toBe("never");
  writeFileSync(file, JSON.stringify({ agentOnAir: "not-live", other: 1 }));
  expect(await settlesOn("not-live")).toBe("not-live");
  writeFileSync(file, JSON.stringify({ agentOnAir: "always" }));
  expect(await settlesOn("always")).toBe("always");
  rmSync(file);
  expect(await settlesOn("not-live")).toBe("not-live");
}, 60_000);

test("a settings.json inside the library isn't this Mac's: one that came with it (a clone, a pull) changes nothing", async () => {
  writeFileSync(file, JSON.stringify({ agentOnAir: "never" }));
  expect(await settlesOn("never")).toBe("never");
  mkdirSync(join(library, ".viewswitcher"), { recursive: true });
  writeFileSync(join(library, ".viewswitcher/settings.json"), JSON.stringify({ agentOnAir: "always" }));
  await Bun.sleep(500);
  expect(await onAir()).toBe("never");
});
