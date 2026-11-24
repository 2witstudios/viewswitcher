// An in-memory OBS for tests and local demos (no real OBS needed): answers the obs-websocket v5
// requests that setup and placement use, with OBS's error codes.
import { OBSRequestError } from "./obs";
import type { ObsRequester } from "./obs-setup";

/** An in-memory OBS that answers the obs-websocket v5 requests setup uses, with OBS's error codes. */
export function fakeObs(init: { scenes?: Record<string, string[]>; inputs?: Record<string, { kind: string; settings: Record<string, unknown> }> } = {}) {
  const scenes = new Map(Object.entries(init.scenes ?? {}).map(([k, v]) => [k, v.map((sourceName, i) => ({ sourceName, sceneItemId: i + 1 }))]));
  const inputs = new Map(Object.entries(init.inputs ?? {}));
  let nextId = 100;
  let program = "";
  const fail = (type: string, code: number): never => {
    throw new OBSRequestError(type, code, `fake ${code}`);
  };
  const items = (scene: string) => scenes.get(scene) ?? fail("scene", 600);
  const obs: ObsRequester & { scenes: typeof scenes; inputs: typeof inputs; program: () => string } = {
    scenes, inputs, program: () => program,
    async request(type: string, d: any = {}): Promise<any> {
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
