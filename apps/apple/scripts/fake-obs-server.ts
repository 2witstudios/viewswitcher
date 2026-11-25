// A stand-in OBS for screenshots: an obs-websocket v5 server (no password) around the in-memory OBS
// the server's tests use (apps/server/src/fake-obs.ts). OBS already has the ViewSwitcher scene with
// its device sources, so once the switcher's "Set up OBS" has run there's nothing left to set up.
//
//   bun apps/apple/scripts/fake-obs-server.ts [port]       (default 4466; FAKE_OBS_STREAMING=1: live)
//
// Never 4455 (OBS's own port): a real OBS may be running on this Mac.
import { fakeObs } from "../../server/src/fake-obs";
import { OBSRequestError } from "../../server/src/obs";

const port = Number(process.argv[2] ?? process.env.FAKE_OBS_PORT ?? 4466);
if (port === 4455) throw new Error("4455 is OBS's own port; use another");
const devices = (process.env.OBS_DEVICES ?? "Camera,Screen,iPad,Guest").split(",").map((s) => s.trim()).filter(Boolean);
const obs = fakeObs({
  scenes: { Scene: [], ViewSwitcher: devices },
  inputs: Object.fromEntries(devices.map((d) => [d, { kind: d === "Screen" ? "screen_capture" : "av_capture_input_v2", settings: {} }])),
});
let streaming = process.env.FAKE_OBS_STREAMING === "1";
let recording = false;
const transforms = new Map<string, Record<string, unknown>>();

type Sock = { send(s: string): void };
const clients = new Set<Sock>();
const emit = (eventType: string, eventData: object) => {
  for (const ws of clients) ws.send(JSON.stringify({ op: 5, d: { eventType, eventIntent: 64, eventData } }));
};

/** What the in-memory OBS doesn't answer: outputs, video, versions and scene item transforms. */
async function answer(type: string, d: any): Promise<object> {
  switch (type) {
    case "GetVersion":
      return { obsVersion: "31.0.0", obsWebSocketVersion: "5.5.0", rpcVersion: 1, availableRequests: [], supportedImageFormats: ["png"], platform: "macos", platformDescription: "macOS" };
    case "GetStreamStatus":
      return { outputActive: streaming, outputReconnecting: false, outputTimecode: "00:42:17.000", outputDuration: 2_537_000, outputBytes: 0, outputSkippedFrames: 0, outputTotalFrames: 0 };
    case "GetRecordStatus":
      return { outputActive: recording, outputPaused: false, outputTimecode: "00:00:00.000", outputDuration: 0, outputBytes: 0 };
    case "ToggleStream":
      streaming = !streaming;
      emit("StreamStateChanged", { outputActive: streaming, outputState: streaming ? "OBS_WEBSOCKET_OUTPUT_STARTED" : "OBS_WEBSOCKET_OUTPUT_STOPPED" });
      return { outputActive: streaming };
    case "ToggleRecord":
      recording = !recording;
      emit("RecordStateChanged", { outputActive: recording, outputState: recording ? "OBS_WEBSOCKET_OUTPUT_STARTED" : "OBS_WEBSOCKET_OUTPUT_STOPPED" });
      return { outputActive: recording };
    case "GetVideoSettings":
      return { baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080, fpsNumerator: 30, fpsDenominator: 1 };
    case "GetSceneItemTransform":
      return { sceneItemTransform: { sourceWidth: 1920, sourceHeight: 1080, ...transforms.get(`${d.sceneName}/${d.sceneItemId}`) } };
    case "SetSceneItemTransform":
      transforms.set(`${d.sceneName}/${d.sceneItemId}`, { ...transforms.get(`${d.sceneName}/${d.sceneItemId}`), ...d.sceneItemTransform });
      return {};
    case "SetSceneItemEnabled":
      return {};
  }
  return obs.request(type, d);
}

Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch(req, server) {
    return server.upgrade(req) ? undefined : new Response("obs-websocket (fake)", { status: 426 });
  },
  websocket: {
    open(ws) {
      ws.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: "5.5.0", rpcVersion: 1 } }));
    },
    async message(ws, raw) {
      const msg = JSON.parse(String(raw));
      if (msg.op === 1) {
        clients.add(ws);
        ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
        return;
      }
      if (msg.op !== 6) return;
      const { requestType, requestId, requestData } = msg.d;
      try {
        const responseData = await answer(requestType, requestData ?? {});
        ws.send(JSON.stringify({ op: 7, d: { requestType, requestId, requestStatus: { result: true, code: 100 }, responseData } }));
      } catch (e) {
        const code = e instanceof OBSRequestError ? e.code : 205;
        ws.send(JSON.stringify({ op: 7, d: { requestType, requestId, requestStatus: { result: false, code, comment: (e as Error).message } } }));
      }
    },
    close(ws) {
      clients.delete(ws);
    },
  },
});
console.log(`fake OBS on ws://127.0.0.1:${port}${streaming ? " (streaming)" : ""}`);
