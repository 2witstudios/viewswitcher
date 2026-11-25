// Placement against the shared fake OBS: what OBS shows after each report the program page makes.
import { afterEach, describe, expect, test } from "bun:test";
import { coverTransform, obsColor } from "@viewswitcher/shared";
import type { Slot } from "@viewswitcher/shared";
import { fakeObs, type FakeObsInit, serveFakeObs } from "../fake-obs";
import { OBSClient } from "../obs";
import { createPlacer, type PlacementObs } from "./placement";

const names = { scene: "ViewSwitcher", programSource: "ViewSwitcher Program", groundSource: "ViewSwitcher Ground" };
const SCENE_ITEMS = ["ViewSwitcher Ground", "Camera", "Screen", "Guest", "Camera 2", "Logo", "ViewSwitcher Program"];
const input = (kind: string) => ({ kind, settings: {} });
const INPUTS: FakeObsInit["inputs"] = Object.fromEntries(SCENE_ITEMS.map((n) => [n, input(n === "ViewSwitcher Ground" ? "color_source_v3" : "av_capture_input")]));

const camera: Slot = { source: "Camera", x: 1528, y: 32, w: 360, h: 450 };
const guest: Slot = { source: "Guest", x: 1528, y: 500, w: 360, h: 450 };
const screen: Slot = { source: "Screen", x: 32, y: 32, w: 1472, h: 828 };

function setup(init: FakeObsInit = {}, ground: (path: string) => string | null = () => "#112233") {
  const obs = Object.assign(fakeObs({ scenes: { ViewSwitcher: SCENE_ITEMS }, inputs: INPUTS, ...init }), { status: { connected: true } });
  const placed: string[][] = [];
  const placer = createPlacer({ obs, names, ground, onPlaced: (w) => placed.push(w) });
  return { obs, placer, placed, shown: () => obs.shown("ViewSwitcher") };
}

describe("placement", () => {
  test("a Guest or Camera 2 box from the last scene is hidden when the next scene has none", async () => {
    const { placer, shown } = setup();
    await placer.report("org/projects/p/scenes/interview.html", [camera, guest, { ...guest, source: "Camera 2", y: 40 }]);
    expect(shown()).toMatchObject({ Camera: true, Guest: true, "Camera 2": true, Screen: false, Logo: false });
    // A BRB with no slots: every source goes, the program and the ground stay.
    await placer.report("org/templates/brb.html", []);
    expect(shown()).toEqual({ "ViewSwitcher Ground": true, Camera: false, Screen: false, Guest: false, "Camera 2": false, Logo: false, "ViewSwitcher Program": true });
  });

  test("each report moves the slotted source to its box, covering it", async () => {
    const { obs, placer } = setup({ inputs: { ...INPUTS, Camera: { ...input("av_capture_input"), size: { width: 1280, height: 720 } } } });
    const frames = [{ x: 1528, y: 32 }, { x: 900, y: 200 }, { x: 32, y: 408 }];
    for (const f of frames) {
      await placer.report("org/templates/talk.html", [{ ...camera, ...f }, screen]);
      expect(obs.transformOf("ViewSwitcher", "Camera")).toEqual(coverTransform({ ...camera, ...f }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }));
    }
    expect(obs.transformOf("ViewSwitcher", "Screen")).toEqual(coverTransform(screen, { width: 1920, height: 1080 }, { width: 1920, height: 1080 }));
  });

  test("batched: the scene's items and canvas once, then one batch to read sizes and one to change OBS per report", async () => {
    const { obs, placer } = setup();
    await placer.report("org/templates/talk.html", [camera]);
    await placer.report("org/templates/talk.html", [{ ...camera, x: 10 }]);
    await placer.report("org/templates/brb.html", []);
    expect(obs.requests.filter((r) => r.type === "RequestBatch").map((r) => r.data[0])).toEqual([
      "GetVideoSettings", "GetSceneItemTransform", "SetInputSettings", // first: list, sizes, ground + changes
      "GetSceneItemTransform", "SetSceneItemEnabled", // the ground is already this org's
      "SetSceneItemEnabled", // nothing slotted: nothing to read
    ]);
  });

  test("items added in OBS are seen after OBS says so", async () => {
    const { obs, placer, shown } = setup();
    await placer.report("org/templates/brb.html", []);
    await obs.request("CreateInput", { sceneName: "ViewSwitcher", inputName: "Guest 2", inputKind: "av_capture_input", inputSettings: {} });
    placer.onEvent("SceneItemCreated");
    await placer.report("org/templates/brb.html", []);
    expect(shown()["Guest 2"]).toBe(false);
  });

  test("only the newest of reports made close together is placed, and it's placed last", async () => {
    const { obs, placer, shown } = setup();
    const ids = Object.fromEntries(obs.scenes.get("ViewSwitcher")!.map((i) => [i.sourceName, i.sceneItemId]));
    const read = () => obs.requests.filter((r) => r.type === "GetSceneItemTransform").map((r) => r.data.sceneItemId);
    // Three reports before any reaches OBS: only the last one is placed.
    await Promise.all([placer.report("org/a.html", [camera]), placer.report("org/b.html", [guest]), placer.report("org/c.html", [screen])]);
    expect(shown()).toMatchObject({ Camera: false, Guest: false, Screen: true });
    expect(read()).toEqual([ids.Screen]);
    // One already being placed finishes, and the newest report waiting behind it goes next.
    const a = placer.report("org/a.html", [camera]);
    await Bun.sleep(0);
    await Promise.all([a, placer.report("org/b.html", [guest]), placer.report("org/c.html", [screen, guest])]);
    expect(shown()).toMatchObject({ Camera: false, Guest: true, Screen: true });
    expect(read().slice(1)).toEqual([ids.Camera, ids.Screen, ids.Guest]);
  });

  test("the ground follows the org, recolored only when it changes; a missing ground source is no warning", async () => {
    const grounds: Record<string, string> = { a: "#112233", b: "#445566" };
    const { obs, placer, placed } = setup({}, (path) => grounds[path.split("/")[0]!] ?? null);
    await placer.report("a/x.html", []);
    await placer.report("a/y.html", []);
    await placer.report("b/z.html", []);
    expect(obs.requests.filter((r) => r.type === "SetInputSettings").map((r) => r.data.inputSettings.color)).toEqual([obsColor("#112233"), obsColor("#445566")]);
    obs.inputs.delete("ViewSwitcher Ground");
    await placer.report("a/x.html", []);
    expect(placed.at(-1)).toEqual([]);
  });

  test("a slot OBS has no source for, or a source with no picture yet, is a warning", async () => {
    const { placer, placed, shown } = setup({ inputs: { ...INPUTS, Camera: { ...input("av_capture_input"), size: { width: 0, height: 0 } } } });
    await placer.report("org/x.html", [camera, { ...camera, source: "Phone" }, { ...camera, source: "Phone", y: 9 }]);
    expect(placed.at(-1)).toEqual([
      `This scene has a "Phone" slot, but OBS scene "ViewSwitcher" has no source with that name.`,
      `OBS source "Camera" has no picture yet, so it can't be fitted to its slot.`,
    ]);
    expect(shown().Screen).toBe(false);
  });

  test("no ViewSwitcher scene in OBS says to set it up", async () => {
    const { placer, placed } = setup({ scenes: { Other: [] } });
    await placer.report("org/x.html", [camera]);
    expect(placed.at(-1)).toEqual([`Couldn't place sources in OBS: OBS has no scene "ViewSwitcher". Press Set up OBS in the switcher.`]);
  });

  test("with OBS disconnected, nothing is sent and the warnings clear", async () => {
    const { obs, placer, placed } = setup();
    obs.status.connected = false;
    await placer.report("org/x.html", [camera]);
    expect(obs.requests).toEqual([]);
    expect(placed).toEqual([[]]);
  });
});

describe("placement with an OBS that stalls", () => {
  let stop: (() => void)[] = [];
  afterEach(() => {
    for (const s of stop) s();
    stop = [];
  });

  test("a placement OBS never answers times out, and the next switch still lands", async () => {
    const fake = fakeObs({ scenes: { ViewSwitcher: SCENE_ITEMS }, inputs: INPUTS });
    const served = serveFakeObs(fake);
    const client = new OBSClient({ url: served.url }).start();
    stop.push(() => client.stop(), served.stop);
    await client.ready(2000);
    const placed: string[][] = [];
    const placer = createPlacer({ obs: client as PlacementObs, names, ground: () => null, onPlaced: (w) => placed.push(w), timeoutMs: 150 });
    await placer.report("org/a.html", [camera]); // warm: items and canvas known
    expect(fake.shown("ViewSwitcher").Camera).toBe(true);

    served.control.stall = true; // the socket stays open; nothing is answered
    const started = Date.now();
    await placer.report("org/b.html", [guest]);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(placed.at(-1)?.[0]).toContain("OBS didn't answer RequestBatch within 0.15 s");

    served.control.stall = false;
    await placer.report("org/c.html", [guest]);
    expect(placed.at(-1)).toEqual([]);
    expect(fake.shown("ViewSwitcher")).toMatchObject({ Camera: false, Guest: true });
  });
});
