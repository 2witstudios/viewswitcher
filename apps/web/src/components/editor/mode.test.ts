import { describe, expect, test } from "bun:test";
import { toBase } from "@viewswitcher/shared";
import { canReloadIn, canStart, canUndo, IDLE, type Mode, type ModeEvent, reduce } from "./mode";

const v1 = toBase({ html: `<main><p style="left: 0px; top: 0px">One</p><p>Two</p></main>`, hash: "1" });
const v2 = toBase({ html: `<main><p style="left: 0px; top: 0px">One</p><p>Changed</p></main>`, hash: "2" });
const made = { gen: 1, layout: 1, base: v1 };
const conflict = { edits: [{ id: 1, text: "Mine" }], changed: [], prev: v1, latest: v1 };
const file = new File(["x"], "a.png", { type: "image/png" });

const run = (...events: ModeEvent[]) => events.reduce<Mode>(reduce, IDLE);
const typing: ModeEvent = { t: "type", id: 1, original: "One", gen: 1 };
const drag = (left: number): ModeEvent => ({ t: "drag", id: 1, left, top: 0, guides: { x: [], y: [] } });

describe("starting a mode", () => {
  test("each starts from idle", () => {
    expect(run(typing).kind).toBe("typing");
    expect(run(drag(8)).kind).toBe("dragging");
    expect(run({ t: "resize", id: 1, width: 100, height: 50 }).kind).toBe("resizing");
    expect(run({ t: "structure" }).kind).toBe("saving-structure");
    expect(run({ t: "pick", replace: null, made }).kind).toBe("picking");
    expect(run({ t: "dropChoice", choice: { file, at: { x: 1, y: 1 }, image: 1, x: 0, y: 0, made } }).kind).toBe("dropChoice");
    expect(run({ t: "leave" }).kind).toBe("leaving");
  });

  test("nothing else starts while one is under way", () => {
    for (const busy of [typing, drag(8), { t: "structure" } as ModeEvent, { t: "pick", replace: 1, made } as ModeEvent, { t: "leave" } as ModeEvent]) {
      const before = run(busy);
      for (const next of [typing, { t: "structure" } as ModeEvent, { t: "pick", replace: null, made } as ModeEvent, { t: "resize", id: 2, width: 1, height: 1 } as ModeEvent]) {
        if (next.t === busy.t) continue;
        expect(reduce(before, next)).toBe(before);
      }
    }
  });

  test("a drag updates as it goes, but only for the box being dragged", () => {
    const m = run(drag(8), drag(16));
    expect(m).toMatchObject({ kind: "dragging", left: 16 });
    expect(reduce(m, { t: "drag", id: 2, left: 0, top: 0, guides: { x: [], y: [] } })).toBe(m);
  });

  test("Done over a drop's Replace / Add choice leaves; over typing or a drag it doesn't", () => {
    expect(run({ t: "dropChoice", choice: { file, at: { x: 1, y: 1 }, image: 1, x: 0, y: 0, made } }, { t: "leave" }).kind).toBe("leaving");
    expect(run(typing, { t: "leave" }).kind).toBe("typing");
    expect(run(drag(8), { t: "leave" }).kind).toBe("dragging");
  });
});

describe("ending a mode", () => {
  test("its own end goes back to idle", () => {
    expect(run(typing, { t: "end", kind: "typing" })).toBe(IDLE);
    expect(run({ t: "structure" }, { t: "end", kind: "saving-structure" })).toBe(IDLE);
  });

  test("another mode's end changes nothing: a conflict that opened during a save stays up", () => {
    const m = run({ t: "structure" }, { t: "conflict", conflict });
    expect(m.kind).toBe("conflict");
    expect(reduce(m, { t: "end", kind: "saving-structure" })).toBe(m);
    expect(run({ t: "leave" }, { t: "conflict", conflict }, { t: "end", kind: "leaving" }).kind).toBe("conflict");
  });
});

describe("conflicts", () => {
  test("open over anything", () => {
    for (const e of [typing, drag(8), { t: "pick", replace: 1, made } as ModeEvent, { t: "leave" } as ModeEvent]) {
      expect(run(e, { t: "conflict", conflict }).kind).toBe("conflict");
    }
  });

  test("saves queued behind the conflicting one join it", () => {
    const m = run({ t: "conflict", conflict }, { t: "conflict:edits", edits: [{ id: 0, left: 8, top: 8 }] });
    expect(m.kind === "conflict" && m.edits).toEqual([{ id: 1, text: "Mine" }, { id: 0, left: 8, top: 8 }]);
    expect(run({ t: "conflict:edits", edits: [] })).toBe(IDLE);
  });

  test("follow the newest version, marking what changed in it", () => {
    const m = run({ t: "conflict", conflict }, { t: "reloaded", base: v2 });
    expect(m.kind === "conflict" && m.latest).toBe(v2);
    expect(m.kind === "conflict" && m.changed).toEqual([2]);
    expect(m.kind === "conflict" && m.prev).toBe(v1);
  });
});

describe("a new version of the file", () => {
  test("ends typing, dragging and resizing: their ids are the old version's", () => {
    expect(run(typing, { t: "reloaded", base: v2 })).toBe(IDLE);
    expect(run(drag(8), { t: "reloaded", base: v2 })).toBe(IDLE);
    expect(run({ t: "resize", id: 1, width: 1, height: 1 }, { t: "reloaded", base: v2 })).toBe(IDLE);
  });

  test("leaves the steps that check the version themselves", () => {
    for (const e of [{ t: "structure" }, { t: "pick", replace: 1, made }, { t: "leave" }] as ModeEvent[]) {
      const m = run(e);
      expect(reduce(m, { t: "reloaded", base: v2 })).toBe(m);
    }
  });
});

describe("guards", () => {
  test("Undo is off while typing, and whenever anything else is under way", () => {
    expect(canUndo(IDLE)).toBe(true);
    for (const e of [typing, drag(8), { t: "structure" }, { t: "pick", replace: null, made }, { t: "leave" }, { t: "conflict", conflict }] as ModeEvent[]) {
      expect(canUndo(run(e))).toBe(false);
      expect(canStart(run(e))).toBe(false);
    }
  });

  test("a change made elsewhere loads when idle or over a conflict, never mid-change", () => {
    expect(canReloadIn(IDLE)).toBe(true);
    expect(canReloadIn(run({ t: "conflict", conflict }))).toBe(true);
    for (const e of [typing, drag(8), { t: "resize", id: 1, width: 1, height: 1 }, { t: "structure" }, { t: "pick", replace: null, made }, { t: "leave" }] as ModeEvent[]) {
      expect(canReloadIn(run(e))).toBe(false);
    }
  });
});
