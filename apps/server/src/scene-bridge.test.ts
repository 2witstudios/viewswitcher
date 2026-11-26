// EDIT-26: the program page reaches a sandboxed scene only through the bridge's messages.
// (Moved from apps/web's apply-preview tests: the program page no longer touches the scene's DOM.)
import { describe, expect, test } from "bun:test";
import { SCENE_BRIDGE, withBridge } from "./scene-bridge";

type El = {
  textContent: string; childElementCount: number; tagName: string; style: Record<string, string>; attrs: Record<string, string>;
  slot?: boolean; holdsSlot?: boolean; rect?: { left: number; top: number; width: number; height: number };
};
const el = (over: Partial<El> = {}): El => ({ textContent: "old", childElementCount: 0, tagName: "P", style: { left: "1px", top: "2px" }, attrs: {}, ...over });

/** Runs the bridge against a fake scene and returns a way to message it as its parent would. */
function frame(hash: string | null, els: Record<number, El>, opts: { stampOnFragment?: boolean; hold?: string } = {}) {
  const sent: any[] = [];
  const parent = { postMessage: (m: unknown) => sent.push(m) };
  let onMessage: (e: { source: unknown; data: unknown }) => void = () => {};
  const wrap = (e: El) => ({
    get textContent() { return e.textContent; },
    set textContent(v: string) { e.textContent = v; },
    childElementCount: e.childElementCount,
    tagName: e.tagName,
    style: e.style,
    setAttribute: (n: string, v: string) => void (e.attrs[n] = v),
    getAttribute: (n: string) => (n === "data-slot" ? "Camera" : e.attrs[n] ?? null),
    matches: (s: string) => s === "[data-slot]" && !!e.slot,
    querySelector: (s: string) => (s === "[data-slot]" && e.holdsSlot ? {} : null),
    getBoundingClientRect: () => e.rect ?? { left: 0, top: 0, width: 0, height: 0 },
  });
  const document = {
    documentElement: { getAttribute: (n: string) => (n === "data-vs-hash" && !opts.stampOnFragment ? hash : null) },
    querySelector: (s: string) => {
      if (s === "[data-vs-hash]") return opts.stampOnFragment ? { getAttribute: () => hash } : null;
      if (s.startsWith("meta")) return opts.hold ? { getAttribute: () => opts.hold } : null;
      const id = /data-vs="(\d+)"/.exec(s)?.[1];
      return id !== undefined && els[Number(id)] ? wrap(els[Number(id)]!) : null;
    },
    querySelectorAll: () => Object.values(els).filter((e) => e.slot).map(wrap),
  };
  const window = {};
  new Function("document", "parent", "window", "addEventListener", SCENE_BRIDGE)(document, parent, window, (_t: string, f: typeof onMessage) => (onMessage = f));
  return {
    send: (data: unknown, source: unknown = parent) => {
      sent.length = 0;
      onMessage({ source, data });
      return sent[0];
    },
  };
}
const preview = (edit: unknown, hash = "v1") => ({ viewswitcher: "frame:liveEdit", id: 7, hash, edit });

describe("frame:hello", () => {
  test("answers with the slots, the version and the transition's hold", () => {
    const f = frame("v1", { 2: el({ slot: true, rect: { left: 10, top: 20, width: 640, height: 360 } }) }, { hold: "600" });
    expect(f.send({ viewswitcher: "frame:hello", id: 1 })).toEqual({ viewswitcher: "frame:state", id: 1, slots: [{ source: "Camera", x: 10, y: 20, w: 640, h: 360 }], version: "v1", hold: "600" });
  });
  test("ignores messages from anything but its parent (the scene's own frames, other windows)", () => {
    const f = frame("v1", {});
    expect(f.send({ viewswitcher: "frame:hello", id: 1 }, {})).toBeUndefined();
    expect(f.send("frame:hello")).toBeUndefined();
  });
});

describe("frame:preview (live edits, as apply-preview did)", () => {
  test("applies text and position when the frame shows the editor's version", () => {
    const t = el(), cam = el({ slot: true });
    const f = frame("v1", { 3: t, 4: cam });
    expect(f.send(preview({ id: 3, text: "new" }))).toMatchObject({ applied: true, slotMoved: false, slots: null });
    expect(t.textContent).toBe("new");
    expect(f.send(preview({ id: 4, left: 40, top: 50 }))).toMatchObject({ applied: true, slotMoved: true, version: "v1" });
    expect(cam.style).toEqual({ left: "40px", top: "50px" });
  });
  test("a moved panel that holds a slot reports the slots again", () => {
    const f = frame("v1", { 3: el({ holdsSlot: true }), 4: el({ slot: true }) });
    const r = f.send(preview({ id: 3, left: 0, top: 0 }));
    expect(r.slotMoved).toBe(true);
    expect(r.slots).toHaveLength(1);
  });
  test("ignores a preview for another version (the agent saved: ids shifted)", () => {
    const panel = el({ childElementCount: 3 });
    const f = frame("v2", { 3: panel });
    expect(f.send(preview({ id: 3, text: "typed" }))).toMatchObject({ applied: false });
    expect(f.send(preview({ id: 3, left: 0, top: 0 }))).toMatchObject({ applied: false });
    expect(panel.style.left).toBe("1px");
    expect(frame(null, { 3: el() }).send(preview({ id: 3, text: "x" }, ""))).toMatchObject({ applied: false });
  });
  test("a fragment's stamp on its first element counts", () => {
    const t = el();
    expect(frame("v1", { 3: t }, { stampOnFragment: true }).send(preview({ id: 3, text: "new" }))).toMatchObject({ applied: true });
    expect(t.textContent).toBe("new");
  });
  test("never puts text into an element with children (it would wipe them, slots included)", () => {
    const parent = el({ childElementCount: 2 });
    expect(frame("v1", { 5: parent }).send(preview({ id: 5, text: "x" }))).toMatchObject({ applied: false });
    expect(parent.textContent).toBe("old");
  });
  test("a resize changes the box (and moves it from another corner)", () => {
    const cam = el({ slot: true });
    expect(frame("v1", { 4: cam }).send(preview({ id: 4, width: 480, height: 270, left: 10 }))).toMatchObject({ applied: true, slotMoved: true });
    expect(cam.style).toEqual({ left: "10px", top: "2px", width: "480px", height: "270px" });
  });
  test("an image's src changes live, only to a library file; adding and deleting wait for the saved file", () => {
    const img = el({ tagName: "IMG" }), p = el();
    const f = frame("v1", { 5: img, 6: p });
    expect(f.send(preview({ id: 5, src: "/library/o/assets/b.png" }))).toMatchObject({ applied: true });
    expect(img.attrs.src).toBe("/library/o/assets/b.png");
    expect(f.send(preview({ id: 5, src: "https://x/y.png" }))).toMatchObject({ applied: false });
    expect(f.send(preview({ id: 6, src: "/library/o/assets/b.png" }))).toMatchObject({ applied: false });
    expect(f.send(preview({ id: 6, remove: true }))).toMatchObject({ applied: false });
    expect(f.send(preview({ id: 6, insert: "<p>x</p>" }))).toMatchObject({ applied: false });
  });
  test("odd ids and values are ignored, not thrown", () => {
    const f = frame("v1", { 3: el() });
    expect(f.send(preview({ id: '3"],*,["', text: "x" }))).toMatchObject({ applied: false });
    expect(f.send(preview({ id: 3, left: "1px; color: red" }))).toMatchObject({ applied: true });
    expect(f.send(preview(null))).toMatchObject({ applied: false });
  });
});

test("withBridge adds the script once, at the end", () => {
  const out = withBridge("<html><body></body></html>");
  expect(out.startsWith("<html><body></body></html>\n<script>(function () {")).toBe(true);
  expect(out.endsWith("})();</script>\n")).toBe(true);
});

test("the editor's copy defuses every <meta>, however it's written or hidden (it could navigate the same-origin frame away)", async () => {
  const { defuseMeta } = await import("./scene-sandbox");
  const cases: [string, string][] = [
    [`<meta http-equiv="refresh" content="0; url=/daisy/templates">`, `<link data-vs-meta http-equiv="refresh" content="0; url=/daisy/templates">`],
    [`<META HTTP-EQUIV=Refresh content=1>`, `<link data-vs-meta HTTP-EQUIV=Refresh content=1>`],
    [`<meta http-equiv="&#114;efresh" content="0;url=x.html/">`, `<link data-vs-meta http-equiv="&#114;efresh" content="0;url=x.html/">`],
    [`<meta content="0;url=/a?>" http-equiv="refresh">`, `<link data-vs-meta content="0;url=/a?>" http-equiv="refresh">`],
    // Where an editor's scanner sees less markup than a browser does:
    [`<!--><meta http-equiv=refresh content="0;url=/"><!-- -->`, `<!--><link data-vs-meta http-equiv=refresh content="0;url=/"><!-- -->`],
    [`<![CDATA[><meta http-equiv=refresh content=0;url=/>]]>`, `<![CDATA[><link data-vs-meta http-equiv=refresh content=0;url=/>]]>`],
    [`<svg><title><meta http-equiv=refresh content=0;url=/></title></svg>`, `<svg><title><link data-vs-meta http-equiv=refresh content=0;url=/></title></svg>`],
    [`<meta a/http-equiv=refresh content=0;url=/>`, `<link data-vs-meta a/http-equiv=refresh content=0;url=/>`],
    [`<meta/http-equiv=refresh>`, `<link data-vs-meta/http-equiv=refresh>`],
    [`<meta\nhttp-equiv=refresh>`, `<link data-vs-meta\nhttp-equiv=refresh>`],
  ];
  for (const [meta, out] of cases) expect(defuseMeta(`<head>${meta}<title>t</title></head>`)).toBe(`<head>${out}<title>t</title></head>`);
  expect(defuseMeta(`<metadata><p>metal</p><meter>`)).toBe(`<metadata><p>metal</p><meter>`);
});
