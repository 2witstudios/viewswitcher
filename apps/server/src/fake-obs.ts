// An in-memory OBS for tests and local demos (no real OBS needed): answers the obs-websocket v5
// requests that setup, placement and previews use, with OBS's error codes. It records every request.
// serveFakeObs puts one on a real WebSocket, speaking the protocol (hello, auth, requests, batches,
// events), so OBSClient itself can be tested against it.
import { createHash } from "node:crypto";
import { type BatchRequest, type BatchResult, CLOSE_AUTH_FAILED, OBSRequestError } from "./obs";
import type { ObsRequester } from "./obs-setup";
import { solidPng } from "./png";

/** `size`: the source's picture (0×0 for a camera that isn't sending yet). Defaults to 1920×1080. */
type FakeInput = { kind: string; settings: Record<string, unknown>; muted?: boolean; size?: { width: number; height: number } };
type FakeItem = { sourceName: string; sceneItemId: number; sceneItemEnabled: boolean; transform: Record<string, unknown> };

export type FakeObsInit = {
  scenes?: Record<string, string[]>;
  inputs?: Record<string, FakeInput>;
  /** The canvas (GetVideoSettings). Defaults to 1920×1080. */
  video?: { baseWidth: number; baseHeight: number };
  /**
   * The PNG GetSourceScreenshot returns for a source (a scene or an input) at the size asked for.
   * Called once per screenshot, so it can change from frame to frame. Defaults to an empty frame.
   */
  screenshot?: (sourceName: string, size: { width: number; height: number }) => Uint8Array | Promise<Uint8Array>;
};

/** An in-memory OBS that answers the obs-websocket v5 requests setup and placement use, with OBS's error codes. */
export function fakeObs(init: FakeObsInit = {}) {
  let nextId = 100;
  const item = (sourceName: string, sceneItemId = nextId++): FakeItem => ({ sourceName, sceneItemId, sceneItemEnabled: true, transform: {} });
  const scenes = new Map(Object.entries(init.scenes ?? {}).map(([k, v]) => [k, v.map((sourceName, i) => item(sourceName, i + 1))]));
  const inputs = new Map<string, FakeInput>(Object.entries(init.inputs ?? {}));
  const requests: { type: string; data: any }[] = [];
  const video = { baseWidth: 1920, baseHeight: 1080, ...init.video };
  let program = "";
  const fail = (type: string, code: number): never => {
    throw new OBSRequestError(type, code, `fake ${code}`);
  };
  const items = (scene: string) => scenes.get(scene) ?? fail("scene", 600);
  const itemById = (type: string, d: any) => items(d.sceneName).find((i) => i.sceneItemId === d.sceneItemId) ?? fail(type, 600);
  const sizeOf = (name: string) => inputs.get(name)?.size ?? { width: 1920, height: 1080 };
  const answer = async (type: string, d: any = {}): Promise<any> => {
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
        // Like OBS: an input name is unique across the whole collection, in any scene or none.
        if (inputs.has(d.inputName)) fail(type, 601);
        inputs.set(d.inputName, { kind: d.inputKind, settings: { ...d.inputSettings } });
        const it = item(d.inputName);
        items(d.sceneName).push(it);
        return { sceneItemId: it.sceneItemId };
      }
      case "CreateSceneItem": {
        if (!inputs.has(d.sourceName) && !scenes.has(d.sourceName)) fail(type, 600);
        const it = item(d.sourceName);
        it.sceneItemEnabled = d.sceneItemEnabled ?? true;
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
        return { sceneItems: items(d.sceneName).map((i, sceneItemIndex) => ({ sourceName: i.sourceName, sceneItemId: i.sceneItemId, sceneItemEnabled: i.sceneItemEnabled, sceneItemIndex })) };
      case "SetSceneItemIndex": {
        const list = items(d.sceneName);
        const at = list.findIndex((i) => i.sceneItemId === d.sceneItemId);
        const [it] = list.splice(at, 1);
        list.splice(d.sceneItemIndex, 0, it!);
        return {};
      }
      case "GetVideoSettings":
        return { ...video, outputWidth: video.baseWidth, outputHeight: video.baseHeight };
      case "GetSceneItemTransform": {
        const it = itemById(type, d);
        const size = sizeOf(it.sourceName);
        return { sceneItemTransform: { ...it.transform, sourceWidth: size.width, sourceHeight: size.height } };
      }
      case "SetSceneItemTransform":
        Object.assign(itemById(type, d).transform, d.sceneItemTransform);
        return {};
      case "SetSceneItemEnabled":
        itemById(type, d).sceneItemEnabled = !!d.sceneItemEnabled;
        return {};
      case "GetCurrentProgramScene":
        return { currentProgramSceneName: program, sceneName: program } as never;
      case "SetCurrentProgramScene":
        items(d.sceneName);
        program = d.sceneName;
        return {};
    }
    return fail(type, 204);
  };
  /** Like OBS's SerialRealtime batch: each request in turn, each with its own result. */
  const batch = async (list: BatchRequest[], { haltOnFailure = false }: { haltOnFailure?: boolean } = {}): Promise<BatchResult[]> => {
    requests.push({ type: "RequestBatch", data: list.map((r) => r.requestType) });
    const results: BatchResult[] = [];
    for (const r of list) {
      try {
        results.push({ requestType: r.requestType, requestStatus: { result: true, code: 100 }, responseData: await answer(r.requestType, r.requestData) });
      } catch (e) {
        const code = e instanceof OBSRequestError ? e.code : 205;
        results.push({ requestType: r.requestType, requestStatus: { result: false, code, comment: (e as Error).message } });
        if (haltOnFailure) break;
      }
    }
    return results;
  };
  const obs: ObsRequester & {
    scenes: typeof scenes; inputs: typeof inputs; program: () => string; requests: typeof requests;
    requestBatch: typeof batch;
    /** The scene's items as OBS would list them, bottom first: name and whether it's shown. */
    shown: (scene: string) => Record<string, boolean>;
    /** An item's transform as last set. */
    transformOf: (scene: string, sourceName: string) => Record<string, unknown> | undefined;
  } = {
    scenes, inputs, requests, program: () => program,
    request: (type: string, d?: any) => answer(type, d),
    requestBatch: batch,
    shown: (scene) => Object.fromEntries(items(scene).map((i) => [i.sourceName, i.sceneItemEnabled])),
    transformOf: (scene, name) => items(scene).find((i) => i.sourceName === name)?.transform,
  };
  return obs;
}

export type FakeObs = ReturnType<typeof fakeObs>;

const sha256b64 = (s: string) => createHash("sha256").update(s).digest("base64");

/**
 * `obs` on a real obs-websocket v5 server on 127.0.0.1. `password()` is asked at each hello, so a test
 * can turn authentication on or change the password while clients are connected or retrying.
 * `stall` makes it stop answering requests while keeping the socket open (a hung OBS).
 */
export function serveFakeObs(obs: FakeObs, opts: { password?: () => string | undefined } = {}) {
  type Data = { salt: string; challenge: string; password?: string; identified: boolean };
  const control = { stall: false, connections: 0 };
  const sockets = new Set<import("bun").ServerWebSocket<Data>>();
  const server = Bun.serve<Data>({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req, srv) => (srv.upgrade(req, { data: { salt: "salt", challenge: crypto.randomUUID(), identified: false } }) ? undefined : new Response("no", { status: 400 })),
    websocket: {
      open(ws) {
        control.connections++;
        sockets.add(ws);
        ws.data.password = opts.password?.();
        const authentication = ws.data.password ? { salt: ws.data.salt, challenge: ws.data.challenge } : undefined;
        ws.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: "5.0.0", rpcVersion: 1, authentication } }));
      },
      close(ws) {
        sockets.delete(ws);
      },
      async message(ws, raw) {
        const m = JSON.parse(String(raw));
        if (m.op === 1) {
          const want = ws.data.password && sha256b64(sha256b64(ws.data.password + ws.data.salt) + ws.data.challenge);
          if (want && m.d.authentication !== want) return ws.close(CLOSE_AUTH_FAILED, "Authentication failed.");
          ws.data.identified = true;
          return void ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
        }
        if (!ws.data.identified || control.stall) return;
        if (m.op === 6) {
          const { requestType, requestId, requestData } = m.d;
          // The client's own status refresh: answered, but not recorded, so tests see only their own requests.
          if (requestType === "GetRecordStatus" || requestType === "GetStreamStatus") {
            return void ws.send(JSON.stringify({ op: 7, d: { requestType, requestId, requestStatus: { result: true, code: 100 }, responseData: { outputActive: false } } }));
          }
          try {
            const responseData = await obs.request(requestType, requestData);
            ws.send(JSON.stringify({ op: 7, d: { requestType, requestId, requestStatus: { result: true, code: 100 }, responseData } }));
          } catch (e) {
            const code = e instanceof OBSRequestError ? e.code : 205;
            ws.send(JSON.stringify({ op: 7, d: { requestType, requestId, requestStatus: { result: false, code, comment: (e as Error).message } } }));
          }
        }
        if (m.op === 8) {
          const results = await obs.requestBatch(m.d.requests, { haltOnFailure: m.d.haltOnFailure });
          ws.send(JSON.stringify({ op: 9, d: { requestId: m.d.requestId, results } }));
        }
      },
    },
  });
  return {
    url: `ws://127.0.0.1:${server.port}`,
    control,
    /** Sends an OBS event (op 5) to every identified client. */
    event(eventType: string, eventData: Record<string, unknown> = {}) {
      for (const ws of sockets) if (ws.data.identified) ws.send(JSON.stringify({ op: 5, d: { eventType, eventIntent: 0, eventData } }));
    },
    stop: () => server.stop(true),
  };
}
