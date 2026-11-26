// A stand-in OBS for screenshots: the in-memory OBS the server's tests use (apps/server/src/fake-obs.ts),
// on a real obs-websocket v5 socket with no password. OBS already has the ViewSwitcher scene with its
// device sources, so once the switcher's "Set up OBS" has run there's nothing left to set up.
//
//   bun apps/apple/scripts/fake-obs-server.ts [port]       (default 4466; FAKE_OBS_STREAMING=1: live)
//
// Never 4455 (OBS's own port): a real OBS may be running on this Mac.
import { fakeObs, serveFakeObs } from "../../server/src/fake-obs";

const port = Number(process.argv[2] ?? process.env.FAKE_OBS_PORT ?? 4466);
if (port === 4455) throw new Error("4455 is OBS's own port; use another");
const sources = (process.env.OBS_SOURCES ?? process.env.OBS_DEVICES ?? "Camera,Screen,iPad,Guest").split(",").map((s) => s.trim()).filter(Boolean);
const streaming = process.env.FAKE_OBS_STREAMING === "1";
const obs = fakeObs({
  scenes: { Scene: [], ViewSwitcher: sources },
  inputs: Object.fromEntries(sources.map((d) => [d, { kind: d === "Screen" ? "screen_capture" : "av_capture_input_v2", settings: {} }])),
  streaming,
});
serveFakeObs(obs, { port });
console.log(`fake OBS on ws://127.0.0.1:${port}${streaming ? " (streaming)" : ""}`);
