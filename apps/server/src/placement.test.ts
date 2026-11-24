// EDIT-7: while a camera box is dragged on air, the program page reports the moved slot and the
// server re-places the OBS source there. This checks the OBS calls one such report produces.
import { describe, expect, test } from "bun:test";
import { coverTransform } from "@viewswitcher/shared";
import type { OBSClient } from "./obs";
import { placeDevices } from "./placement";

function fakeObs() {
  const calls: { type: string; data: any }[] = [];
  const obs = {
    request: async (type: string, data: any) => {
      calls.push({ type, data });
      if (type === "GetVideoSettings") return { baseWidth: 1920, baseHeight: 1080 };
      if (type === "GetSceneItemId") return { sceneItemId: ["Camera", "Screen", "iPad"].indexOf(data.sourceName) + 1 };
      if (type === "GetSceneItemTransform") return { sceneItemTransform: { sourceWidth: 1920, sourceHeight: 1080 } };
      return {};
    },
  } as unknown as OBSClient;
  return { obs, calls };
}

describe("placeDevices follows a dragged camera box", () => {
  test("each slot report moves the Camera source to the box's new position", async () => {
    const { obs, calls } = fakeObs();
    const opts = { scene: "ViewSwitcher", devices: ["Camera", "Screen", "iPad"] };
    const frames = [{ x: 1528, y: 32 }, { x: 900, y: 200 }, { x: 32, y: 408 }];
    for (const f of frames) await placeDevices(obs, [{ source: "Camera", ...f, w: 360, h: 450 }, { source: "Screen", x: 32, y: 32, w: 1472, h: 828 }], opts);
    const moves = calls.filter((c) => c.type === "SetSceneItemTransform" && c.data.sceneItemId === 1).map((c) => c.data.sceneItemTransform);
    expect(moves).toHaveLength(3);
    expect(moves.map((t) => [t.positionX, t.positionY])).toEqual(frames.map((f) => [coverTransform({ source: "Camera", ...f, w: 360, h: 450 }, { width: 1920, height: 1080 }).positionX, f.y]));
    expect(moves[2]).toEqual(coverTransform({ source: "Camera", x: 32, y: 408, w: 360, h: 450 }, { width: 1920, height: 1080 }));
    // The iPad isn't in the scene: hidden, never moved.
    expect(calls.some((c) => c.type === "SetSceneItemEnabled" && c.data.sceneItemId === 3 && c.data.sceneItemEnabled === false)).toBe(true);
  });
});
