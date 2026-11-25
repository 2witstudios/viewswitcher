import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeObs, type FakeObsInit } from "./fake-obs";
import { OBSRequestError } from "./obs";
import { setupObs } from "./obs-setup";
import { PathError } from "./paths";
import { solidPng } from "./png";
import { createPreviewer } from "./preview";

const PORT = 7433;
const names = {
  url: "ws://127.0.0.1:4455", password: undefined as string | undefined,
  scene: "ViewSwitcher", programSource: "ViewSwitcher Program", groundSource: "ViewSwitcher Ground", devices: ["Camera", "Screen", "iPad"],
  previewScene: "ViewSwitcher Preview", previewSource: "ViewSwitcher Preview Render",
};
const SCENE = "daisy/projects/p1/Title.html";
const SPACED = "daisy/projects/p1/Be Right Back.html";

const library = await mkdtemp(join(tmpdir(), "vs-preview-"));
await mkdir(join(library, "daisy/projects/p1"), { recursive: true });
for (const p of [SCENE, SPACED, "daisy/org.json"]) await writeFile(join(library, p), "<!doctype html><title>x</title>");
afterAll(() => rm(library, { recursive: true, force: true }));

type Rgba = [number, number, number, number];
const GROUND: Rgba = [14, 15, 19, 255];
const png = (c: Rgba, w = 960, h = 540) => solidPng(w, h, c);
/** A color per scene, so a picture shows which page the preview source was on. */
const colorOf = (url: string): Rgba => (url.includes("Back") ? [200, 0, 0, 255] : [0, 0, 200, 255]);
const pageOf = (url: unknown) => String(url).replace(/&load=[^&]*$/, "");

/** A connected fake OBS (streaming and recording, to show previews are safe while live). */
function connected(init: FakeObsInit = {}) {
  return Object.assign(fakeObs(init), { status: { connected: true, streaming: true, recording: true } });
}

/** Screenshots of the preview source show its current page's color once `blanks` empty frames have gone by for that load. */
function rendering(blanks = 0) {
  const seen = new Map<string, number>();
  const obs: ReturnType<typeof connected> = connected({
    screenshot: (source, { width, height }) => {
      if (source !== names.previewSource) return png(GROUND, width, height);
      const url = String(obs.inputs.get(source)!.settings.url);
      const n = (seen.get(url) ?? 0) + 1;
      seen.set(url, n);
      return n <= blanks ? png([0, 0, 0, 0], width, height) : png(colorOf(url), width, height);
    },
  });
  return obs;
}

const opts = (more: object = {}) => ({ obs: names, port: PORT, library, intervalMs: 2, ...more });
const shots = (obs: ReturnType<typeof fakeObs>) => obs.requests.filter((r) => r.type === "GetSourceScreenshot");

describe("preview renderer (MCP-1)", () => {
  test("creates the preview scene and its muted browser source on first use, then renders the scene in it", async () => {
    const obs = rendering(2);
    await setupObs(obs, { ...names, previewScene: "elsewhere", previewSource: "elsewhere render" }, PORT); // an OBS set up before previews existed
    obs.requests.length = 0;
    const r = await createPreviewer(obs, opts()).scene(SCENE);

    expect(r).toEqual({ ok: true, png: png(colorOf(SCENE)), width: 960, height: 540 });
    expect(obs.scenes.get(names.previewScene)!.map((i) => i.sourceName)).toEqual([names.previewSource]);
    const input = obs.inputs.get(names.previewSource)!;
    expect(input).toMatchObject({ kind: "browser_source", muted: true, settings: { width: 1920, height: 1080, shutdown: false, reroute_audio: true } });
    expect(pageOf(input.settings.url)).toBe(`http://127.0.0.1:${PORT}/library/${SCENE}?preview`);
    expect(shots(obs).map((s) => s.data)).toContainEqual({ sourceName: names.previewSource, imageFormat: "png", imageWidth: 960, imageHeight: 540 });

    // Once there, it is reused, and each preview reloads the page.
    obs.requests.length = 0;
    const before = input.settings.url;
    await createPreviewer(obs, opts()).scene(SCENE);
    expect(obs.requests.some((r) => r.type === "CreateScene" || r.type === "CreateInput")).toBe(false);
    expect(obs.inputs.get(names.previewSource)!.settings.url).not.toBe(before);
  });

  test("full renders at 1920×1080", async () => {
    const obs = rendering();
    const r = await createPreviewer(obs, opts()).scene(SCENE, { full: true });
    expect(r).toEqual({ ok: true, png: png(colorOf(SCENE), 1920, 1080), width: 1920, height: 1080 });
    expect(shots(obs)[0]!.data).toMatchObject({ imageWidth: 1920, imageHeight: 1080 });
  });

  test("never switches the program or touches the ViewSwitcher scene, even while live", async () => {
    const obs = rendering(1);
    await setupObs(obs, names, PORT, { switchProgram: true });
    const items = structuredClone(obs.scenes.get(names.scene));
    const program = structuredClone(obs.inputs.get(names.programSource));
    obs.requests.length = 0;

    const previewer = createPreviewer(obs, opts());
    await previewer.scene(SCENE);
    await previewer.scene(SPACED, { full: true });
    await previewer.program();

    expect(obs.requests.map((r) => r.type).filter((t) => t === "SetCurrentProgramScene" || t === "SetCurrentPreviewScene" || t === "SetStudioModeEnabled")).toEqual([]);
    const onProgramScene = obs.requests.filter((r) => r.data.sceneName === names.scene || r.data.sourceName === names.scene);
    expect(onProgramScene).toEqual([{ type: "GetSourceScreenshot", data: { sourceName: names.scene, imageFormat: "png", imageWidth: 960, imageHeight: 540 } }]);
    expect(obs.requests.filter((r) => r.data.inputName && r.data.inputName !== names.previewSource)).toEqual([]);
    expect(obs.scenes.get(names.scene)).toEqual(items!);
    expect(obs.inputs.get(names.programSource)).toEqual(program!);
    expect(obs.program()).toBe(names.scene);
  });

  test("refuses paths outside the library, and anything that isn't a scene, without asking OBS", async () => {
    const obs = rendering();
    const previewer = createPreviewer(obs, opts());
    for (const bad of ["../outside.html", "daisy/../../outside.html", "", "daisy/org.json", "daisy/projects/p1/missing.html"]) {
      await expect(previewer.scene(bad)).rejects.toBeInstanceOf(PathError);
    }
    expect(obs.requests).toEqual([]);
  });

  test("screenshots until two frames in a row match, ignoring empty frames", async () => {
    let n = 0;
    const frames: Rgba[] = [[0, 0, 0, 0], [0, 0, 0, 0], [1, 2, 3, 255], [4, 5, 6, 255], [4, 5, 6, 255], [7, 8, 9, 255]];
    const obs = connected({ screenshot: () => png(frames[Math.min(n++, frames.length - 1)]!) });
    const r = await createPreviewer(obs, opts()).scene(SCENE);
    expect(r).toEqual({ ok: true, png: png([4, 5, 6, 255]), width: 960, height: 540 });
    expect(shots(obs).length).toBe(5);
  });

  test("two empty frames don't count as settled", async () => {
    let n = 0;
    const obs = connected({ screenshot: () => png(n++ < 3 ? [0, 0, 0, 0] : GROUND) });
    expect(await createPreviewer(obs, opts()).scene(SCENE)).toMatchObject({ ok: true, png: png(GROUND) });
    expect(shots(obs).length).toBe(5);
  });

  test("a picture that never settles is returned as it is when the time runs out", async () => {
    let n = 0;
    const obs = connected({ screenshot: () => png([n++ % 256, 0, 0, 255]) }); // a running countdown
    const started = Date.now();
    const r = await createPreviewer(obs, opts({ timeoutMs: 120, intervalMs: 10 })).scene(SCENE);
    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(120);
    expect(took).toBeLessThan(400);
    expect(r).toEqual({ ok: true, png: png([n - 1, 0, 0, 255]), width: 960, height: 540 });
  });

  test("if OBS never draws the page, it says so and gives the URL", async () => {
    const obs = connected(); // the fake's default frame is empty
    const r = await createPreviewer(obs, opts({ timeoutMs: 60, intervalMs: 10 })).scene(SCENE);
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("didn't draw the scene"), url: `http://127.0.0.1:${PORT}/library/${SCENE}?preview` });
  });

  test("previews run one at a time, so each gets its own scene's picture", async () => {
    const obs = rendering(2);
    const previewer = createPreviewer(obs, opts());
    const [a, b, c] = await Promise.all([previewer.scene(SCENE), previewer.scene(SPACED), previewer.scene(SCENE, { full: true })]);
    expect(a).toEqual({ ok: true, png: png(colorOf(SCENE)), width: 960, height: 540 });
    expect(b).toEqual({ ok: true, png: png(colorOf(SPACED)), width: 960, height: 540 });
    expect(c).toEqual({ ok: true, png: png(colorOf(SCENE), 1920, 1080), width: 1920, height: 1080 });

    const order = obs.requests.filter((r) => r.type === "SetInputSettings" && r.data.inputSettings.url).map((r) => pageOf(r.data.inputSettings.url));
    expect(order).toEqual([SCENE, SPACED, SCENE].map((p) => `http://127.0.0.1:${PORT}/library/${p.split("/").map(encodeURIComponent).join("/")}?preview`));
  });

  test("a preview that fails doesn't hold up the next one", async () => {
    let fail = true;
    const obs = rendering();
    const real = obs.request.bind(obs);
    obs.request = async (type: string, d?: object) => {
      if (type === "GetSourceScreenshot" && fail) {
        fail = false;
        throw new OBSRequestError(type, 702, "Failed to render screenshot.");
      }
      return real(type, d);
    };
    const previewer = createPreviewer(obs, opts());
    const [a, b] = await Promise.all([previewer.scene(SCENE), previewer.scene(SPACED)]);
    expect(a).toEqual({ ok: false, reason: expect.stringContaining("Failed to render screenshot."), url: `http://127.0.0.1:${PORT}/library/${SCENE}?preview` });
    expect(b).toMatchObject({ ok: true, png: png(colorOf(SPACED)) });
  });

  test("without OBS, it says there's no picture and gives the preview URL, sending nothing", async () => {
    const obs = Object.assign(fakeObs(), { status: { connected: false, streaming: false, recording: false } });
    const previewer = createPreviewer(obs, opts());
    expect(await previewer.scene(SCENE)).toEqual({
      ok: false,
      reason: "OBS isn't connected, so there's no picture. Open the URL in a browser at 1920×1080 if you can.",
      url: `http://127.0.0.1:${PORT}/library/${SCENE}?preview`,
    });
    expect(await previewer.scene(SPACED)).toMatchObject({ url: `http://127.0.0.1:${PORT}/library/daisy/projects/p1/Be%20Right%20Back.html?preview` });
    expect(await previewer.program()).toMatchObject({ ok: false, reason: expect.stringContaining("OBS isn't connected"), url: `http://127.0.0.1:${PORT}/program` });
    expect(obs.requests).toEqual([]);
  });
});

describe("program picture (MCP-1, MCP-6)", () => {
  test("is one screenshot of the ViewSwitcher scene, camera and all, at 960×540 or full size", async () => {
    let frame = 0;
    const obs = connected({ screenshot: (source, { width, height }) => (source === names.scene ? png([frame++, 99, 99, 255], width, height) : png([0, 0, 0, 0])) });
    await setupObs(obs, names, PORT);
    obs.requests.length = 0;
    const previewer = createPreviewer(obs, opts());
    expect(await previewer.program()).toEqual({ ok: true, png: png([0, 99, 99, 255]), width: 960, height: 540 });
    expect(await previewer.program({ full: true })).toEqual({ ok: true, png: png([1, 99, 99, 255], 1920, 1080), width: 1920, height: 1080 });
    expect(obs.requests.map((r) => r.type)).toEqual(["GetSourceScreenshot", "GetSourceScreenshot"]);
  });

  test("a missing scene or an empty picture says why", async () => {
    const obs = connected();
    expect(await createPreviewer(obs, opts()).program()).toEqual({ ok: false, reason: expect.stringContaining(`couldn't take a picture of "${names.scene}"`), url: `http://127.0.0.1:${PORT}/program` });
    obs.scenes.set(names.scene, []);
    expect(await createPreviewer(obs, opts()).program()).toMatchObject({ ok: false, reason: expect.stringContaining("empty picture") });
  });
});
