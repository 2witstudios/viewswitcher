// EDIT-26: what the program page takes from a (possibly hostile) scene frame.
import { expect, test } from "bun:test";
import { cleanSlots, frameState } from "./scene-frame";

test("slots: only names and finite numbers, at most 32", () => {
  expect(cleanSlots([{ source: "Camera", x: 1, y: 2, w: 3, h: 4 }, { source: "", x: 1, y: 1, w: 1, h: 1 }, { source: "S", x: NaN, y: 0, w: 0, h: 0 }, { source: "S", x: "1", y: 0, w: 0, h: 0 }, null])).toEqual([{ source: "Camera", x: 1, y: 2, w: 3, h: 4 }]);
  expect(cleanSlots(Array.from({ length: 50 }, () => ({ source: "C", x: 0, y: 0, w: 1, h: 1 })))).toHaveLength(32);
  expect(cleanSlots("nope")).toEqual([]);
  expect(cleanSlots([{ source: "C", x: 1e9, y: 0, w: 1, h: 1 }])).toEqual([]);
});

test("frame:state is checked; anything else is ignored", () => {
  expect(frameState({ viewswitcher: "frame:state", id: 3, slots: [], version: "v1", hold: "600" })).toEqual({ id: 3, slots: [], version: "v1", hold: "600" });
  expect(frameState({ viewswitcher: "frame:state", id: "3" })).toBeNull();
  expect(frameState({ viewswitcher: "onair", id: 3 })).toBeNull();
  expect(frameState(null)).toBeNull();
  expect(frameState({ viewswitcher: "frame:state", id: 1, version: 5 })).toMatchObject({ version: null, hold: null, slots: [] });
});
