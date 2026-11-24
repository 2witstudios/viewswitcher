import { describe, expect, test } from "bun:test";
import { fakeObs } from "./fake-obs";
import { OBSRequestError } from "./obs";
import { checkObsSetup, obsReady, type ObsRequester, programUrl, setupObs } from "./obs-setup";

const names = { scene: "ViewSwitcher", programSource: "ViewSwitcher Program", groundSource: "ViewSwitcher Ground", devices: ["Camera", "Screen", "iPad"] };
const PORT = 7433;

/** Bottom to top, as OBS indexes scene items. */
const order = (obs: ReturnType<typeof fakeObs>) => obs.scenes.get(names.scene)!.map((i) => i.sourceName);

describe("setupObs (MAC-3)", () => {
  test("an empty OBS gets the scene, the program on top and the ground at the bottom", async () => {
    const obs = fakeObs();
    expect(obsReady(await checkObsSetup(obs, names, PORT))).toBe(false);
    const r = await setupObs(obs, names, PORT);
    expect(order(obs)).toEqual(["ViewSwitcher Ground", "ViewSwitcher Program"]);
    expect(obs.inputs.get("ViewSwitcher Program")).toMatchObject({ kind: "browser_source", settings: { url: programUrl(PORT), width: 1920, height: 1080 } });
    expect(obs.inputs.get("ViewSwitcher Ground")?.kind).toBe("color_source_v3");
    expect(obs.program()).toBe("ViewSwitcher");
    expect(r.missing).toEqual(["Camera", "Screen", "iPad"]);
    expect(await checkObsSetup(obs, names, PORT)).toEqual({ scene: true, program: true, ground: true, missingDevices: ["Camera", "Screen", "iPad"] });
  });

  test("running again puts the program back on top over devices added since, keeping the ground's color", async () => {
    const obs = fakeObs();
    await setupObs(obs, names, PORT);
    obs.inputs.get("ViewSwitcher Ground")!.settings.color = 0xff00ff00;
    for (const d of ["Camera", "Screen"]) await obs.request("CreateInput", { sceneName: names.scene, inputName: d, inputKind: "av_capture_input", inputSettings: {} });
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
    expect([...obs.scenes.keys()]).toEqual(["ViewSwitcher"]);
    expect(order(obs)).toEqual(["ViewSwitcher Ground", "Camera", "ViewSwitcher Program"]);
  });

  test("an OBS error other than 'already exists' surfaces", async () => {
    const obs = fakeObs();
    const broken: ObsRequester = { request: (t, d) => (t === "CreateScene" ? Promise.reject(new OBSRequestError(t, 500, "boom")) : obs.request(t, d)) };
    await expect(setupObs(broken, names, PORT)).rejects.toThrow("boom");
  });
});
