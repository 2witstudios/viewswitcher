// settings.json edited by hand while the real server runs (from source, OBS offline, no USB, a temp
// library): the agent on-air setting in live state, which the agents' guard reads, follows the file.
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Subprocess } from "bun";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, SERVER_START_MS, startServer } from "./test-server";

let port = 0;
let proc: Subprocess;
const library = mkdtempSync(join(tmpdir(), "vs-settings-"));
const file = join(library, ".viewswitcher/settings.json");
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
  mkdirSync(join(library, ".viewswitcher"), { recursive: true });
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
