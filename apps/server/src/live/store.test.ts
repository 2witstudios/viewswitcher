// The live store against a temp library: ordering of on-air requests, the saved record, renames and
// the on-air file going away.
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LiveState, ServerMessage } from "@viewswitcher/shared";
import { LiveStore, missingWarning } from "./store";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const ORG = "show";
const scene = (title: string) => `<!doctype html><title>${title}</title>`;
const initial: Omit<LiveState, "onAir" | "warnings"> = {
  obs: { connected: false, recording: false, streaming: false },
  obsSetup: null,
  usb: { enabled: false, attached: false, connected: false },
  agent: { onAir: "not-live", lastSeen: null, client: null },
};

let root: string;
let file: string;
let sent: ServerMessage[];
const put = async (rel: string, text: string) => {
  await mkdir(join(root, rel, ".."), { recursive: true });
  await writeFile(join(root, rel), text);
};
const open = () => LiveStore.open({ root, file, publish: (m) => sent.push(structuredClone(m)), initial });
const saved = async () => JSON.parse(await readFile(file, "utf8")).onAir;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "vs-store-"));
  roots.push(root);
  file = join(root, ".viewswitcher", "state.json");
  sent = [];
  await put(`${ORG}/org.json`, JSON.stringify({ name: "Show", accent: "#fff", ground: "#101010" }));
  for (const n of ["a", "b", "c", "d"]) await put(`${ORG}/templates/${n}.html`, scene(n.toUpperCase()));
  await put(`${ORG}/projects/p/scenes/brb.html`, scene("BRB"));
  await put(`${ORG}/projects/p/streams/s/brb.html`, scene("BRB, this week"));
});

describe("going on air", () => {
  test("requests close together end on the one asked last, and state.json is never half-written", async () => {
    const store = await open();
    const paths = Array.from({ length: 40 }, (_, i) => `${ORG}/templates/${"abcd"[i % 4]}.html`);
    let reading = true;
    let reads = 0;
    const reader = (async () => {
      while (reading) {
        const text = await readFile(file, "utf8").catch(() => null);
        if (text !== null) {
          JSON.parse(text); // throws on a torn file
          reads++;
        }
        await Bun.sleep(0);
      }
    })();
    const results = await Promise.all(paths.map((path, i) => store.goOnAir({ path, label: `#${i}` })));
    reading = false;
    await reader;
    expect(reads).toBeGreaterThan(0);
    expect(store.state.onAir).toMatchObject({ path: paths.at(-1), label: "#39", org: ORG, ground: "#101010" });
    expect(await saved()).toMatchObject({ path: paths.at(-1), label: "#39" });
    // Each caller got the state as its own request left it, in the order they were asked.
    expect(results.every((r) => r === store.state)).toBe(true);
    const published = sent.flatMap((m) => (m.t === "state" ? [m.state.onAir?.label] : []));
    expect(published).toEqual(paths.map((_, i) => `#${i}`));
    // No temp files are left beside it.
    expect(await readdir(join(root, ".viewswitcher"))).toEqual(["state.json"]);
  });

  test("a scene that isn't there is refused, and what's on air stays", async () => {
    const store = await open();
    await store.goOnAir({ path: `${ORG}/templates/a.html`, label: "A" });
    await expect(store.goOnAir({ path: `${ORG}/templates/gone.html`, label: "Gone" })).rejects.toThrow("There's no view at show/templates/gone.html");
    await expect(store.goOnAir({ path: `${ORG}/templates`, label: "A folder" })).rejects.toThrow("There's no view at");
    expect(store.state.onAir?.label).toBe("A");
    expect((await saved()).label).toBe("A");
    // And a refused one doesn't hold up the next.
    await store.goOnAir({ path: `${ORG}/templates/b.html`, label: "B" });
    expect(store.state.onAir?.label).toBe("B");
  });

  test("the agent guard: checked after the lookup and again after saving; a late refusal puts the saved record back", async () => {
    const store = await open();
    await store.goOnAir({ path: `${ORG}/templates/a.html`, label: "A" });
    let calls = 0;
    const refuseSecond = () => {
      if (++calls === 2) throw new Error("OBS went live");
    };
    await expect(store.goOnAir({ path: `${ORG}/templates/b.html`, label: "B" }, refuseSecond)).rejects.toThrow("OBS went live");
    expect(calls).toBe(2);
    expect(store.state.onAir?.label).toBe("A");
    expect((await saved()).label).toBe("A");
    const refuseFirst = () => {
      throw new Error("not while live");
    };
    await expect(store.goOnAir({ path: `${ORG}/templates/b.html`, label: "B" }, refuseFirst)).rejects.toThrow("not while live");
    expect((await saved()).label).toBe("A");
  });

  test("a new scene on air clears the last one's warnings", async () => {
    const store = await open();
    await store.goOnAir({ path: `${ORG}/templates/a.html`, label: "A" });
    store.setPlacementWarnings(["no Camera"]);
    expect(store.state.warnings).toEqual(["no Camera"]);
    await store.goOnAir({ path: `${ORG}/templates/b.html`, label: "B" });
    expect(store.state.warnings).toEqual([]);
  });
});

describe("renames", () => {
  test("the on-air record follows a rename of the scene on air, and only that one", async () => {
    const store = await open();
    await store.goOnAir({ path: `${ORG}/projects/p/streams/s/brb.html`, label: "BRB, this week · S" });
    const to = `${ORG}/projects/p/streams/s/pause.html`;
    await store.renamed(`${ORG}/templates/a.html`, "Pause", { ok: true, path: to, hash: "h", was: "BRB, this week" });
    expect(store.state.onAir?.path).toBe(`${ORG}/projects/p/streams/s/brb.html`);
    await store.renamed(`${ORG}/projects/p/streams/s/brb.html`, "Pause", { ok: true, path: to, hash: "h", was: "BRB, this week" });
    expect(store.state.onAir).toMatchObject({ path: to, label: "Pause · S", renamedFrom: `${ORG}/projects/p/streams/s/brb.html` });
    expect((await saved()).path).toBe(to);
  });
});

describe("the on-air file going away", () => {
  test("a stream's own copy that's deleted (Revert) falls back to the project's scene, swapped without a transition", async () => {
    const store = await open();
    const own = `${ORG}/projects/p/streams/s/brb.html`;
    await store.goOnAir({ path: own, label: "BRB · S", projectId: "p", streamId: "s" });
    await rm(join(root, own));
    await store.filesChanged([own]);
    expect(store.state.onAir).toMatchObject({ path: `${ORG}/projects/p/scenes/brb.html`, label: "BRB · S", projectId: "p", streamId: "s", renamedFrom: own });
    expect(store.state.onAir?.missing).toBeUndefined();
    expect(store.state.warnings).toEqual([]);
    expect((await saved()).path).toBe(`${ORG}/projects/p/scenes/brb.html`);
  });

  test("anything else deleted keeps the last version on air with a warning, until the file is back", async () => {
    const store = await open();
    const path = `${ORG}/templates/a.html`;
    await store.goOnAir({ path, label: "A" });
    store.setPlacementWarnings(["no Camera"]);
    await rm(join(root, path));
    // The watcher may only name the folder (a removed set): the store looks at the file itself.
    await store.filesChanged([`${ORG}/templates`]);
    expect(store.state.onAir).toMatchObject({ path, missing: true });
    expect(store.state.warnings).toEqual([missingWarning(store.state.onAir!), "no Camera"]);
    const last = sent.at(-1);
    expect(last?.t === "state" && last.state.onAir?.missing).toBe(true);
    // Never saved as missing: a restart looks again.
    expect((await saved()).missing).toBeUndefined();

    await put(path, scene("A again"));
    await store.filesChanged([path]);
    expect(store.state.onAir?.missing).toBeUndefined();
    expect(store.state.warnings).toEqual(["no Camera"]);
  });

  test("a stream copy whose project scene is gone too is kept with a warning", async () => {
    const store = await open();
    const own = `${ORG}/projects/p/streams/s/brb.html`;
    await store.goOnAir({ path: own, label: "BRB" });
    await rm(join(root, own));
    await rm(join(root, `${ORG}/projects/p/scenes/brb.html`));
    await store.filesChanged([own]);
    expect(store.state.onAir).toMatchObject({ path: own, missing: true });
  });

  test("a person's request asked before the removal was noticed still wins over the fallback", async () => {
    const store = await open();
    const own = `${ORG}/projects/p/streams/s/brb.html`;
    await store.goOnAir({ path: own, label: "BRB" });
    await rm(join(root, own));
    const tap = store.goOnAir({ path: `${ORG}/templates/c.html`, label: "C" });
    await Promise.all([tap, store.filesChanged([own])]);
    expect(store.state.onAir?.label).toBe("C");
  });

  test("on start, a stream copy deleted while the server was off is replaced by its project scene", async () => {
    const own = `${ORG}/projects/p/streams/s/brb.html`;
    await (await open()).goOnAir({ path: own, label: "BRB · S", projectId: "p", streamId: "s" });
    await rm(join(root, own));
    const store = await open();
    expect(store.state.onAir).toMatchObject({ path: `${ORG}/projects/p/scenes/brb.html`, label: "BRB · S", renamedFrom: own });
    expect(store.state.onAir?.missing).toBeUndefined();
    expect(store.state.warnings).toEqual([]);
  });

  test("on start, a saved scene whose file is gone comes back marked missing", async () => {
    await (await open()).goOnAir({ path: `${ORG}/templates/a.html`, label: "A" });
    await rm(join(root, `${ORG}/templates/a.html`));
    const store = await open();
    expect(store.state.onAir).toMatchObject({ label: "A", missing: true });
    expect(store.state.warnings).toHaveLength(1);
  });

  test("a transition added for the scene on air is picked up", async () => {
    const store = await open();
    await store.goOnAir({ path: `${ORG}/templates/a.html`, label: "A" });
    expect(store.state.onAir?.transition).toBeNull();
    await put(`${ORG}/templates/_shared/transition.html`, scene("Wipe"));
    await store.filesChanged([`${ORG}/templates/_shared/transition.html`]);
    expect(store.state.onAir?.transition).toBe(`${ORG}/templates/_shared/transition.html`);
  });

  test("a template set's view plays the set's own transition, else the org's", async () => {
    await put(`${ORG}/templates/_shared/transition.html`, scene("Wipe"));
    await put(`${ORG}/templates/neon/pack.json`, "{}");
    await put(`${ORG}/templates/neon/brb.html`, scene("Neon BRB"));
    const store = await open();
    await store.goOnAir({ path: `${ORG}/templates/neon/brb.html`, label: "Neon BRB" });
    expect(store.state.onAir?.transition).toBe(`${ORG}/templates/_shared/transition.html`);
    await put(`${ORG}/templates/neon/_shared/transition.html`, scene("Neon wipe"));
    await store.goOnAir({ path: `${ORG}/templates/a.html`, label: "A" });
    expect(store.state.onAir?.transition).toBe(`${ORG}/templates/_shared/transition.html`);
    await store.goOnAir({ path: `${ORG}/templates/neon/brb.html`, label: "Neon BRB" });
    expect(store.state.onAir?.transition).toBe(`${ORG}/templates/neon/_shared/transition.html`);
  });
});

describe("sources placed before", () => {
  test("are remembered across a restart, with nothing on air or with a scene going on air meanwhile", async () => {
    const store = await open();
    store.placedSources.remember(["Guest"]);
    expect(store.placedSources.has("Guest")).toBe(true); // at once, before it's saved
    await store.goOnAir({ path: `${ORG}/templates/a.html`, label: "A" });
    store.placedSources.remember(["Camera 2", "Guest"]);
    await store.goOnAir({ path: `${ORG}/templates/b.html`, label: "B" }); // queued after the save
    expect(JSON.parse(await readFile(file, "utf8")).placed).toEqual(["Camera 2", "Guest"]);
    const again = await open();
    expect(again.placedSources.has("Guest") && again.placedSources.has("Camera 2")).toBe(true);
    expect(again.placedSources.has("Mic")).toBe(false);
    expect(again.state.onAir?.label).toBe("B");
  });
});

describe("publishing", () => {
  const states = () => sent.filter((m) => m.t === "state").length;

  test("a placement report with the same warnings, every 33 ms while a box is dragged, publishes nothing", async () => {
    const store = await open();
    await store.goOnAir({ path: `${ORG}/templates/a.html`, label: "A" });
    store.setPlacementWarnings(["no Camera"]);
    const before = states();
    for (let i = 0; i < 30; i++) store.setPlacementWarnings(["no Camera"]);
    expect(states()).toBe(before);
    store.setPlacementWarnings([]);
    expect(states()).toBe(before + 1);
    expect(sent.at(-1)).toMatchObject({ t: "state", state: { warnings: [] } });
  });

  test("an update or a publish that changes nothing sends nothing; a change is sent once", async () => {
    const store = await open();
    store.publish();
    const before = states();
    store.update({ obs: { connected: false, recording: false, streaming: false } });
    store.update({ usb: { enabled: false, attached: false, connected: false } });
    store.publish();
    expect(states()).toBe(before);
    store.update({ obs: { connected: true, recording: false, streaming: false } });
    store.update({ obs: { connected: true, recording: false, streaming: false } });
    expect(states()).toBe(before + 1);
    // A part of the state changed in place by its owner (the agent's last-seen) is still noticed.
    store.state.agent = { ...store.state.agent, client: "Claude" };
    store.publish();
    expect(states()).toBe(before + 2);
  });
});

describe("the ground color", () => {
  test("read once per org, and again after its org.json changes", async () => {
    const store = await open();
    expect(await store.groundFor(`${ORG}/templates/a.html`)).toBe("#101010");
    await put(`${ORG}/org.json`, JSON.stringify({ name: "Show", ground: "#202020" }));
    expect(await store.groundFor(`${ORG}/templates/a.html`)).toBe("#101010");
    await store.filesChanged([`${ORG}/org.json`]);
    expect(await store.groundFor(`${ORG}/templates/a.html`)).toBe("#202020");
  });
});
