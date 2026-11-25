// An in-memory OBS for tests and local demos (no real OBS needed): answers the obs-websocket v5
// requests that setup, placement and previews use, with OBS's error codes. It records every request.
// serveFakeObs puts one on a real WebSocket, speaking the protocol (hello, auth, requests, batches,
// events), so OBSClient itself can be tested against it.
import { type BatchRequest, type BatchResult, CLOSE_AUTH_FAILED, OBSRequestError, sha256b64 } from "./obs";
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
  /** Streaming or recording from the start (GetStreamStatus, GetRecordStatus; the toggles flip them). */
  streaming?: boolean;
  recording?: boolean;
};

/** One request's answer, as obs-websocket reports it (in op 7, and per request in op 9). */
export async function result(answer: () => Promise<unknown>): Promise<Omit<BatchResult, "requestType">> {
  try {
    return { requestStatus: { result: true, code: 100 }, responseData: await answer() };
  } catch (e) {
    const code = e instanceof OBSRequestError ? e.code : 205;
    return { requestStatus: { result: false, code, comment: (e as Error).message } };
  }
}

/** An in-memory OBS that answers the obs-websocket v5 requests setup and placement use, with OBS's error codes. */
export function fakeObs(init: FakeObsInit = {}) {
  let nextId = 100;
  const item = (sourceName: string, sceneItemId = nextId++): FakeItem => ({ sourceName, sceneItemId, sceneItemEnabled: true, transform: {} });
  const scenes = new Map(Object.entries(init.scenes ?? {}).map(([k, v]) => [k, v.map((sourceName, i) => item(sourceName, i + 1))]));
  const inputs = new Map<string, FakeInput>(Object.entries(init.inputs ?? {}));
  const requests: { type: string; data: any }[] = [];
  const video = { baseWidth: 1920, baseHeight: 1080, ...init.video };
  let program = "";
  const outputs = { streaming: !!init.streaming, recording: !!init.recording };
  /** Where OBS's events go (serveFakeObs sends them to its clients). */
  let emit: (eventType: string, eventData: Record<string, unknown>) => void = () => {};
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
      case "GetVersion":
        return { obsVersion: "31.0.0", obsWebSocketVersion: "5.5.0", rpcVersion: 1, availableRequests: [], supportedImageFormats: ["png"], platform: "macos", platformDescription: "macOS" };
      case "GetStreamStatus":
        return { outputActive: outputs.streaming, outputReconnecting: false, outputTimecode: "00:42:17.000", outputDuration: 2_537_000, outputBytes: 0, outputSkippedFrames: 0, outputTotalFrames: 0 };
      case "GetRecordStatus":
        return { outputActive: outputs.recording, outputPaused: false, outputTimecode: "00:00:00.000", outputDuration: 0, outputBytes: 0 };
      case "ToggleStream":
      case "ToggleRecord": {
        const key = type === "ToggleStream" ? "streaming" : "recording";
        outputs[key] = !outputs[key];
        const outputActive = outputs[key];
        emit(type === "ToggleStream" ? "StreamStateChanged" : "RecordStateChanged", { outputActive, outputState: outputActive ? "OBS_WEBSOCKET_OUTPUT_STARTED" : "OBS_WEBSOCKET_OUTPUT_STOPPED" });
        return { outputActive };
      }
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
  const batch = async (list: BatchRequest[], { haltOnFailure = false }: { haltOnFailure?: boolean; timeoutMs?: number } = {}): Promise<BatchResult[]> => {
    requests.push({ type: "RequestBatch", data: list.map((r) => r.requestType) });
    const results: BatchResult[] = [];
    for (const r of list) {
      const one = { requestType: r.requestType, ...(await result(() => answer(r.requestType, r.requestData))) };
      results.push(one);
      if (haltOnFailure && !one.requestStatus.result) break;
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
    /** Where to send OBS's events (stream and record state changes). */
    onEvent: (send: typeof emit) => void;
  } = {
    scenes, inputs, requests, program: () => program,
    onEvent: (send) => void (emit = send),
    request: (type: string, d?: any) => answer(type, d),
    requestBatch: batch,
    shown: (scene) => Object.fromEntries(items(scene).map((i) => [i.sourceName, i.sceneItemEnabled])),
    transformOf: (scene, name) => items(scene).find((i) => i.sourceName === name)?.transform,
  };
  return obs;
}

export type FakeObs = ReturnType<typeof fakeObs>;

/**
 * `obs` on a real obs-websocket v5 server on 127.0.0.1 (`port`: 0 picks a free one). `password()` is
 * asked at each hello, so a test can turn authentication on or change the password while clients are
 * connected or retrying. `stall` makes it stop answering requests while keeping the socket open (a hung OBS).
 */
export function serveFakeObs(obs: FakeObs, opts: { password?: () => string | undefined; port?: number } = {}) {
  type Data = { salt: string; challenge: string; password?: string; identified: boolean };
  const control = { stall: false, connections: 0 };
  const sockets = new Set<import("bun").ServerWebSocket<Data>>();
  const server = Bun.serve<Data>({
    hostname: "127.0.0.1",
    port: opts.port ?? 0,
    fetch: (req, srv) => (srv.upgrade(req, { data: { salt: "salt", challenge: crypto.randomUUID(), identified: false } }) ? undefined : new Response("obs-websocket (fake)", { status: 426 })),
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
          ws.send(JSON.stringify({ op: 7, d: { requestType, requestId, ...(await result(() => obs.request(requestType, requestData))) } }));
        }
        if (m.op === 8) {
          const results = await obs.requestBatch(m.d.requests, { haltOnFailure: m.d.haltOnFailure });
          ws.send(JSON.stringify({ op: 9, d: { requestId: m.d.requestId, results } }));
        }
      },
    },
  });
  /** Sends an OBS event (op 5) to every identified client. */
  const event = (eventType: string, eventData: Record<string, unknown> = {}) => {
    for (const ws of sockets) if (ws.data.identified) ws.send(JSON.stringify({ op: 5, d: { eventType, eventIntent: 0, eventData } }));
  };
  obs.onEvent(event);
  return { url: `ws://127.0.0.1:${server.port}`, port: server.port, control, event, stop: () => server.stop(true) };
}
