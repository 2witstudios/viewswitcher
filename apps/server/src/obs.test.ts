// OBSClient against a minimal obs-websocket v5 server (hello, identify, answers), no OBS.
import { afterAll, describe, expect, test } from "bun:test";
import { OBSClient } from "./obs";

/** Answers every request except "Hang", which it never answers. */
const fake = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("no", { status: 400 })),
  websocket: {
    open: (ws) => void ws.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: "5", rpcVersion: 1 } })),
    message(ws, raw) {
      const m = JSON.parse(String(raw));
      if (m.op === 1) return void ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
      if (m.op === 6 && m.d.requestType !== "Hang") {
        void ws.send(JSON.stringify({ op: 7, d: { requestType: m.d.requestType, requestId: m.d.requestId, requestStatus: { result: true, code: 100 }, responseData: { outputActive: false, ok: m.d.requestType } } }));
      }
    },
  },
});
const obs = new OBSClient({ url: `ws://127.0.0.1:${fake.port}` }).start();
afterAll(() => {
  obs.stop();
  fake.stop(true);
});

describe("OBSClient.request", () => {
  test("answers, and with timeoutMs an unanswered request is rejected and forgotten (CodeRabbit)", async () => {
    await obs.ready(2000);
    await Bun.sleep(50); // the status refresh after identify
    expect(obs.outputsKnown).toBe(true); // it said it isn't streaming or recording
    expect(await obs.request("GetVersion")).toMatchObject({ ok: "GetVersion" });
    const before = obs.pendingCount;
    await expect(obs.request("Hang", {}, { timeoutMs: 30 })).rejects.toThrow("OBS didn't answer Hang within 0.03 s");
    await expect(obs.request("Hang", {}, { timeoutMs: 30 })).rejects.toThrow();
    expect(obs.pendingCount).toBe(before);
    // An answered request with a timeout leaves nothing behind either.
    expect(await obs.request("GetVersion", {}, { timeoutMs: 1000 })).toMatchObject({ ok: "GetVersion" });
    expect(obs.pendingCount).toBe(before);
  });
});
