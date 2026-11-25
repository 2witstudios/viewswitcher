// An in-memory OBS for tests and local demos (no real OBS needed): answers the obs-websocket v5
// requests that setup, placement and previews use, with OBS's error codes. It records every request.
import { OBSRequestError } from "./obs";
import type { ObsRequester } from "./obs-setup";
import { solidPng } from "./png";

type FakeInput = { kind: string; settings: Record<string, unknown>; muted?: boolean };

export type FakeObsInit = {
  scenes?: Record<string, string[]>;
  inputs?: Record<string, FakeInput>;
  /**
   * The PNG GetSourceScreenshot returns for a source (a scene or an input) at the size asked for.
   * Called once per screenshot, so it can change from frame to frame. Defaults to an empty frame.
   */
  screenshot?: (sourceName: string, size: { width: number; height: number }) => Uint8Array | Promise<Uint8Array>;
};

/** An in-memory OBS that answers the obs-websocket v5 requests setup uses, with OBS's error codes. */
export function fakeObs(init: FakeObsInit = {}) {
  const scenes = new Map(Object.entries(init.scenes ?? {}).map(([k, v]) => [k, v.map((sourceName, i) => ({ sourceName, sceneItemId: i + 1 }))]));
  const inputs = new Map<string, FakeInput>(Object.entries(init.inputs ?? {}));
  const requests: { type: string; data: any }[] = [];
  let nextId = 100;
  let program = "";
  const fail = (type: string, code: number): never => {
    throw new OBSRequestError(type, code, `fake ${code}`);
  };
  const items = (scene: string) => scenes.get(scene) ?? fail("scene", 600);
  const obs: ObsRequester & { scenes: typeof scenes; inputs: typeof inputs; program: () => string; requests: typeof requests } = {
    scenes, inputs, requests, program: () => program,
    async request(type: string, d: any = {}): Promise<any> {
      requests.push({ type, data: structuredClone(d) });
      switch (type) {
        case "SetSceneName": {
          if (!scenes.has(d.sceneName)) fail(type, 600);
          if (scenes.has(d.newSceneName)) fail(type, 601);
          scenes.set(d.newSceneName, scenes.get(d.sceneName)!);
          scenes.delete(d.sceneName);
          return {};
        }
        case "SetInputName": {
          if (!inputs.has(d.inputName)) fail(type, 600);
          if (inputs.has(d.newInputName)) fail(type, 601);
          inputs.set(d.newInputName, inputs.get(d.inputName)!);
          inputs.delete(d.inputName);
          for (const list of scenes.values()) for (const it of list) if (it.sourceName === d.inputName) it.sourceName = d.newInputName;
          return {};
        }
        case "CreateScene":
          if (scenes.has(d.sceneName)) fail(type, 601);
          scenes.set(d.sceneName, []);
          return {};
        case "GetSceneList":
          return { scenes: [...scenes.keys()].map((sceneName) => ({ sceneName })) };
        case "GetSceneItemId": {
          const it = items(d.sceneName).find((i) => i.sourceName === d.sourceName) ?? fail(type, 600);
          return { sceneItemId: it.sceneItemId };
        }
        case "CreateInput": {
          if (inputs.has(d.inputName)) fail(type, 601);
          inputs.set(d.inputName, { kind: d.inputKind, settings: { ...d.inputSettings } });
          const it = { sourceName: d.inputName, sceneItemId: nextId++ };
          items(d.sceneName).push(it);
          return { sceneItemId: it.sceneItemId };
        }
        case "CreateSceneItem": {
          if (!inputs.has(d.sourceName) && !scenes.has(d.sourceName)) fail(type, 600);
          const it = { sourceName: d.sourceName, sceneItemId: nextId++ };
          items(d.sceneName).push(it);
          return { sceneItemId: it.sceneItemId };
        }
        case "GetInputList":
          return { inputs: [...inputs].map(([inputName, i]) => ({ inputName, inputKind: i.kind })) };
        case "SetInputMute":
          (inputs.get(d.inputName) ?? fail(type, 600)).muted = !!d.inputMuted;
          return {};
        case "GetSourceScreenshot": {
          if (!inputs.has(d.sourceName) && !scenes.has(d.sourceName)) fail(type, 600);
          if (d.imageFormat !== "png") fail(type, 400);
          const size = { width: d.imageWidth ?? 1920, height: d.imageHeight ?? 1080 };
          const png = init.screenshot ? await init.screenshot(d.sourceName, size) : solidPng(size.width, size.height, [0, 0, 0, 0]);
          return { imageData: `data:image/png;base64,${Buffer.from(png).toString("base64")}` };
        }
        case "GetInputSettings":
          return { inputSettings: (inputs.get(d.inputName) ?? fail(type, 600)).settings };
        case "SetInputSettings": {
          const input = inputs.get(d.inputName) ?? fail(type, 600);
          input.settings = { ...input.settings, ...d.inputSettings };
          return {};
        }
        case "GetSceneItemList":
          return { sceneItems: items(d.sceneName).map((i) => ({ ...i })) };
        case "SetSceneItemIndex": {
          const list = items(d.sceneName);
          const at = list.findIndex((i) => i.sceneItemId === d.sceneItemId);
          const [it] = list.splice(at, 1);
          list.splice(d.sceneItemIndex, 0, it!);
          return {};
        }
        case "GetCurrentProgramScene":
          return { currentProgramSceneName: program, sceneName: program } as never;
        case "SetCurrentProgramScene":
          items(d.sceneName);
          program = d.sceneName;
          return {};
      }
      return fail(type, 204);
    },
  };
  return obs;
}
