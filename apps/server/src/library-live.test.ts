// The library listing on the real server (from source, OBS offline, no USB, a temp library), which
// keeps a finished scan briefly for every client: a change made in the switcher is in the very next
// listing, and one made on disk shows as soon as the watcher sees it.
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Subprocess } from "bun";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OrgContent } from "@viewswitcher/shared";
import { sceneHash } from "./scene-edit";
import { freePort, SERVER_START_MS, startServer } from "./test-server";

let port = 0;
let proc: Subprocess;
const library = mkdtempSync(join(tmpdir(), "vs-library-live-"));
const ORG = "my-channel";
const base = () => `http://127.0.0.1:${port}`;
const listing = async () => (await (await fetch(`${base()}/api/library?org=${ORG}`)).json()) as OrgContent;
const post = (path: string, body: unknown) => fetch(`${base()}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

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

test("a change made in the switcher is in the next listing, even right after one was kept", async () => {
  expect((await listing()).projects).toEqual([]);
  const made = await post("/api/projects", { org: ORG, name: "Weekly", templates: ["brb"] });
  expect(made.status).toBe(200);
  const { projectId } = (await made.json()) as { projectId: string };
  const after = await listing();
  expect(after.projects.map((p) => p.id)).toEqual([projectId]);
  expect((await post("/api/streams", { org: ORG, projectId, name: "First", date: "2026-12-01" })).status).toBe(200);
  expect((await listing()).projects[0]!.streams.map((s) => s.name)).toEqual(["First"]);
});

test("a change made on disk shows once the watcher sees it", async () => {
  const before = await listing();
  const brb = before.templates.find((t) => t.name === "brb")!;
  const file = join(library, brb.path);
  writeFileSync(`${file}.tmp`, `<!doctype html><title>Back in five</title><main class="scene"></main>`);
  renameSync(`${file}.tmp`, file);
  let label = brb.label;
  for (const end = Date.now() + 5_000; Date.now() < end && label !== "Back in five"; await Bun.sleep(50)) label = (await listing()).templates.find((t) => t.name === "brb")!.label;
  expect(label).toBe("Back in five");
});

test("the change message carries a changed view's hash, the version the editor gets for it", async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const changes: { paths: string[]; hashes?: Record<string, string> }[] = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.t === "library:changed") changes.push(m);
  };
  await new Promise((r) => (ws.onopen = r));
  const path = `${ORG}/templates/ending.html`;
  const text = `<!doctype html><title>The end</title><main class="scene"></main>`;
  writeFileSync(join(library, `${path}.tmp`), text);
  renameSync(join(library, `${path}.tmp`), join(library, path));
  for (const end = Date.now() + 5_000; Date.now() < end && !changes.some((c) => c.hashes?.[path]); ) await Bun.sleep(50);
  ws.close();
  const hash = changes.find((c) => c.hashes?.[path])?.hashes?.[path];
  expect(hash).toBe(sceneHash(text));
  // What the editor opens it as (api.ts sceneForEdit).
  expect((await fetch(`${base()}/library/${path}?edit`)).headers.get("x-scene-hash")).toBe(hash!);
});
