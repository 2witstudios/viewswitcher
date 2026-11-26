import { describe, expect, test } from "bun:test";
import { fakeObs } from "./fake-obs";
import { OBSRequestError } from "./obs";
import { obsReady } from "@viewswitcher/shared";
import { checkObsSetup, type ObsRequester, programUrl, setupObs } from "./obs-setup";

const names = {
  obsScene: "ViewSwitcher", programSource: "ViewSwitcher Program", groundSource: "ViewSwitcher Ground", sources: ["Camera", "Screen", "iPad"],
  previewScene: "ViewSwitcher Preview", previewSource: "ViewSwitcher Preview Render",
};
const PORT = 7433;

/** Bottom to top, as OBS indexes scene items. */
const order = (obs: ReturnType<typeof fakeObs>) => obs.scenes.get(names.obsScene)!.map((i) => i.sourceName);

describe("setupObs", () => {
  test("an empty OBS gets the scene, the program on top and the ground at the bottom", async () => {
    const obs = fakeObs();
    expect(obsReady(await checkObsSetup(obs, names, PORT))).toBe(false);
    const r = await setupObs(obs, names, PORT);
    expect(order(obs)).toEqual(["ViewSwitcher Ground", "ViewSwitcher Program"]);
    expect(obs.inputs.get("ViewSwitcher Program")).toMatchObject({ kind: "browser_source", settings: { url: programUrl(PORT), width: 1920, height: 1080 } });
    expect(obs.inputs.get("ViewSwitcher Ground")?.kind).toBe("color_source_v3");
    expect(obs.program()).toBe("ViewSwitcher");
    expect(r.missing).toEqual(["Camera", "Screen", "iPad"]);
    expect(await checkObsSetup(obs, names, PORT)).toEqual({ scene: true, program: true, ground: true, ordered: true, missingDevices: ["Camera", "Screen", "iPad"] });
  });

  test("running again puts the program back on top over devices added since, keeping the ground's color", async () => {
    const obs = fakeObs();
    await setupObs(obs, names, PORT);
    obs.inputs.get("ViewSwitcher Ground")!.settings.color = 0xff00ff00;
    for (const d of ["Camera", "Screen"]) await obs.request("CreateInput", { sceneName: names.obsScene, inputName: d, inputKind: "av_capture_input", inputSettings: {} });
    const r = await setupObs(obs, names, PORT);
    expect(r.log.filter((l) => l.startsWith("Created"))).toEqual([]);
    expect(order(obs)).toEqual(["ViewSwitcher Ground", "Camera", "Screen", "ViewSwitcher Program"]);
    expect(obs.inputs.get("ViewSwitcher Ground")!.settings.color).toBe(0xff00ff00);
    expect(r.missing).toEqual(["iPad"]);
  });

  test("a program source pointing at another port needs setup, and setup repoints it", async () => {
    const obs = fakeObs();
    await setupObs(obs, names, 7420);
    expect((await checkObsSetup(obs, names, PORT)).program).toBe(false);
    await setupObs(obs, names, PORT);
    expect((await checkObsSetup(obs, names, PORT)).program).toBe(true);
  });

  test("renames the Daisy-era scene and sources so placed devices carry over", async () => {
    const obs = fakeObs({
      scenes: { "Daisy Live": ["Daisy Ground", "Camera", "Daisy Program"] },
      inputs: { "Daisy Ground": { kind: "color_source_v3", settings: {} }, "Daisy Program": { kind: "browser_source", settings: { url: "x" } }, Camera: { kind: "av_capture_input", settings: {} } },
    });
    await setupObs(obs, names, PORT);
    expect([...obs.scenes.keys()]).toEqual(["ViewSwitcher", "ViewSwitcher Preview"]);
    expect(order(obs)).toEqual(["ViewSwitcher Ground", "Camera", "ViewSwitcher Program"]);
  });

  test("while OBS is live, setup prepares the scene but never switches the program to it", async () => {
    const obs = fakeObs({ scenes: { "Starting soon": [] } });
    await obs.request("SetCurrentProgramScene", { sceneName: "Starting soon" });
    const r = await setupObs(obs, names, PORT, { switchProgram: false });
    expect(obs.program()).toBe("Starting soon");
    expect(r.switched).toBe(false);
    expect(order(obs)).toEqual(["ViewSwitcher Ground", "ViewSwitcher Program"]);
    expect((await setupObs(obs, names, PORT)).switched).toBe(true);
    expect(obs.program()).toBe("ViewSwitcher");
  });

  test("an OBS error other than 'already exists' surfaces", async () => {
    const obs = fakeObs();
    const broken: ObsRequester = { request: (t, d) => (t === "CreateScene" ? Promise.reject(new OBSRequestError(t, 500, "boom")) : obs.request(t, d)) };
    await expect(setupObs(broken, names, PORT)).rejects.toThrow("boom");
  });

  test("a preview scene that can't be made is a warning, not a failed setup (the switcher is set up)", async () => {
    const obs = fakeObs();
    // A non-browser input already has the preview source's name: OBS refuses its browser settings.
    const broken: ObsRequester = { request: (t, d) => (t === "SetInputMute" ? Promise.reject(new OBSRequestError(t, 604, "not an audio input")) : obs.request(t, d)) };
    const r = await setupObs(broken, names, PORT);
    expect(r.switched).toBe(true);
    expect(obs.program()).toBe("ViewSwitcher");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain(`Couldn't make the "${names.previewScene}" scene for previews`);
    expect(r.warnings[0]).toContain("not an audio input");
    expect((await setupObs(obs, names, PORT)).warnings).toEqual([]);
  });

  test("also makes the preview scene, muted and kept alive, which is never switched to nor checked", async () => {
    const obs = fakeObs();
    const r = await setupObs(obs, names, PORT);
    expect(order(obs)).toEqual(["ViewSwitcher Ground", "ViewSwitcher Program"]);
    expect(obs.scenes.get(names.previewScene)!.map((i) => i.sourceName)).toEqual([names.previewSource]);
    expect(obs.inputs.get(names.previewSource)).toMatchObject({ kind: "browser_source", muted: true, settings: { width: 1920, height: 1080, shutdown: false, reroute_audio: true } });
    expect(r.log).toContain(`Created scene "${names.previewScene}" for previews.`);
    expect(obs.program()).toBe("ViewSwitcher");
    expect(obs.requests.filter((q) => q.type === "SetCurrentProgramScene").map((q) => q.data.sceneName)).toEqual(["ViewSwitcher"]);
    const ready = await checkObsSetup(obs, names, PORT);
    expect(ready).toEqual({ scene: true, program: true, ground: true, ordered: true, missingDevices: ["Camera", "Screen", "iPad"] });

    // Without it, setup is still complete: nothing asks for it.
    obs.scenes.delete(names.previewScene);
    expect(await checkObsSetup(obs, names, PORT)).toEqual(ready);
    // Running again brings it back, putting the surviving source back in, and keeps its page.
    obs.inputs.get(names.previewSource)!.settings.url = "http://127.0.0.1:7433/library/x.html?preview";
    await setupObs(obs, names, PORT);
    expect(obs.scenes.get(names.previewScene)!.map((i) => i.sourceName)).toEqual([names.previewSource]);
    expect(obs.inputs.get(names.previewSource)!.settings.url).toBe("http://127.0.0.1:7433/library/x.html?preview");
  });

  test("a program or ground input left outside the scene (OBS answers 601 to creating it) is added to the scene, not a failed setup", async () => {
    // Both inputs exist in another scene only: deleted from ours by hand, or the scene was rebuilt.
    const obs = fakeObs({
      scenes: { ViewSwitcher: ["Camera"], Other: ["ViewSwitcher Program", "ViewSwitcher Ground"] },
      inputs: {
        "ViewSwitcher Program": { kind: "browser_source", settings: { url: "http://127.0.0.1:1/program" } },
        "ViewSwitcher Ground": { kind: "color_source_v3", settings: { color: 0xff00ff00 } },
        Camera: { kind: "av_capture_input", settings: {} },
      },
    });
    const r = await setupObs(obs, names, PORT);
    expect(order(obs)).toEqual(["ViewSwitcher Ground", "Camera", "ViewSwitcher Program"]);
    expect(obs.inputs.get("ViewSwitcher Program")!.settings.url).toBe(programUrl(PORT));
    expect(obs.inputs.get("ViewSwitcher Ground")!.settings.color).toBe(0xff00ff00);
    expect(r.log).toContain(`Added browser source "ViewSwitcher Program" → ${programUrl(PORT)} to "ViewSwitcher".`);
    expect(r.log).toContain(`Added color source "ViewSwitcher Ground" to "ViewSwitcher".`);
    expect(obsReady(await checkObsSetup(obs, names, PORT))).toBe(true);
  });

  test("a source added above the program covers every scene: setup is needed again, and puts the program back on top", async () => {
    const obs = fakeObs();
    await setupObs(obs, names, PORT);
    await obs.request("CreateInput", { sceneName: names.obsScene, inputName: "Camera", inputKind: "av_capture_input", inputSettings: {} });
    const above = await checkObsSetup(obs, names, PORT);
    expect(above).toMatchObject({ program: true, ground: true, ordered: false });
    expect(obsReady(above)).toBe(false);
    await setupObs(obs, names, PORT);
    expect(order(obs)).toEqual(["ViewSwitcher Ground", "Camera", "ViewSwitcher Program"]);
    expect(await checkObsSetup(obs, names, PORT)).toMatchObject({ ordered: true });
    // And one dragged under the ground hides nothing, but the ground no longer fills the bottom: also out of order.
    await obs.request("SetSceneItemIndex", { sceneName: names.obsScene, sceneItemId: obs.scenes.get(names.obsScene)![1]!.sceneItemId, sceneItemIndex: 0 });
    expect(await checkObsSetup(obs, names, PORT)).toMatchObject({ ordered: false });
  });
});
