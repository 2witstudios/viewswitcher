// OBSClient against the fake OBS served on a real obs-websocket v5 socket (hello, auth, answers).
import { afterEach, describe, expect, test } from "bun:test";
import type { ObsStatus } from "@viewswitcher/shared";
import { fakeObs, serveFakeObs } from "./fake-obs";
import { OBSClient } from "./obs";

let cleanup: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanup.splice(0)) c();
});

function serve(password?: () => string | undefined) {
  const fake = fakeObs({ scenes: { ViewSwitcher: ["Camera"] }, inputs: { Camera: { kind: "av_capture_input", settings: {} } } });
  const served = serveFakeObs(fake, { password });
  cleanup.push(served.stop);
  return { fake, served };
}
function client(url: string, opts: Partial<ConstructorParameters<typeof OBSClient>[0]> = {}) {
  const statuses: ObsStatus[] = [];
  const c = new OBSClient({ url, retryMs: 20, onStatus: (s) => statuses.push(s), ...opts }).start();
  cleanup.push(() => c.stop());
  return { c, statuses };
}
async function until(ok: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await Bun.sleep(10);
  }
}

describe("OBSClient requests", () => {
  test("answers, and an unanswered request is rejected and forgotten after its timeout", async () => {
    const { served } = serve();
    const { c } = client(served.url);
    await c.ready(2000);
    await until(() => c.outputsKnown); // it said it isn't streaming or recording
    expect(await c.request("GetSceneItemId", { sceneName: "ViewSwitcher", sourceName: "Camera" })).toEqual({ sceneItemId: 1 });
    await expect(c.request("GetSceneItemId", { sceneName: "Nope", sourceName: "Camera" })).rejects.toThrow("fake 600");
    served.control.stall = true;
    const before = c.pendingCount;
    await expect(c.request("GetSceneList", {}, { timeoutMs: 30 })).rejects.toThrow("OBS didn't answer GetSceneList within 0.03 s");
    expect(c.pendingCount).toBe(before);
    served.control.stall = false;
    expect(await c.request("GetSceneList", {}, { timeoutMs: 1000 })).toMatchObject({ scenes: [{ sceneName: "ViewSwitcher" }] });
    expect(c.pendingCount).toBe(before);
  });

  test("every request has a deadline, even without its own", async () => {
    const { served } = serve();
    const { c } = client(served.url, { defaultTimeoutMs: 40 });
    await c.ready(2000);
    served.control.stall = true;
    await expect(c.request("GetSceneList")).rejects.toThrow("within 0.04 s");
    await expect(c.requestBatch([{ requestType: "GetSceneList" }])).rejects.toThrow("OBS didn't answer RequestBatch within 0.04 s");
  });

  test("a batch is one message, and answers with each request's own result, failures included", async () => {
    const { fake, served } = serve();
    const { c } = client(served.url);
    await c.ready(2000);
    const results = await c.requestBatch([
      { requestType: "GetSceneItemId", requestData: { sceneName: "ViewSwitcher", sourceName: "Camera" } },
      { requestType: "GetSceneItemId", requestData: { sceneName: "ViewSwitcher", sourceName: "Nope" } },
      { requestType: "SetSceneItemEnabled", requestData: { sceneName: "ViewSwitcher", sceneItemId: 1, sceneItemEnabled: false } },
    ]);
    expect(results.map((r) => [r.requestType, r.requestStatus.result, r.requestStatus.code])).toEqual([
      ["GetSceneItemId", true, 100], ["GetSceneItemId", false, 600], ["SetSceneItemEnabled", true, 100],
    ]);
    expect(results[0]!.responseData).toEqual({ sceneItemId: 1 });
    expect(fake.shown("ViewSwitcher").Camera).toBe(false);
    expect(fake.requests.filter((r) => r.type === "RequestBatch")).toHaveLength(1);
    expect(await c.requestBatch([])).toEqual([]);
  });
});

describe("OBSClient and OBS's password", () => {
  test("a password set after start is used on the next connect; until then the status says it's missing", async () => {
    const { served } = serve(() => "secret");
    let known: string | undefined;
    const { c, statuses } = client(served.url, { password: () => known });
    await until(() => c.status.auth === "missing");
    expect(c.status.connected).toBe(false);
    const tries = served.control.connections;
    await until(() => served.control.connections > tries); // it closed and keeps trying, not stuck on one socket
    known = "secret";
    await c.ready(2000);
    expect(c.status).toEqual({ connected: true, recording: false, streaming: false });
    expect(statuses.some((s) => s.auth === "missing")).toBe(true);
  });

  test("a wrong password says so, and a corrected one connects", async () => {
    const { served } = serve(() => "right");
    let given = "wrong";
    const { c } = client(served.url, { password: () => given });
    await until(() => c.status.auth === "wrong");
    given = "right";
    await c.ready(2000);
    expect(c.status.auth).toBeUndefined();
  });
});
