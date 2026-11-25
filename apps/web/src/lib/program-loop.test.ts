import { describe, expect, test } from "bun:test";
import type { Slot } from "@viewswitcher/shared";
import { createProgramLoop, type FrameIndex, type Job, type ProgramEffects } from "./program-loop";
import type { FrameState } from "./scene-frame";

const camera: Slot = { source: "Camera", x: 0, y: 0, w: 10, h: 10 };
const job = (path: string, v = "0.0", extra: Partial<Job> = {}): Job => ({ url: `/library/${path}?edit&bridge&v=${v}`, path, ...extra });

/**
 * A page whose frames load, answer and report however a test says. By default everything is instant,
 * each scene answers with its slots and a version named after its url.
 */
function page(opts: {
  load?: (url: string) => Promise<void>;
  answer?: (url: string) => FrameState | null | Promise<FrameState | null>;
  report?: () => Promise<unknown>;
} = {}) {
  const frames: [string | null, string | null] = [null, null];
  const events: string[] = [];
  const asks: string[] = [];
  const reports: { path: string; slots: Slot[] }[] = [];
  const timers: (() => void)[] = [];
  let front: FrameIndex | null = null;
  const fx: ProgramEffects = {
    load: (i, url) => {
      frames[i] = url;
      events.push(`load ${i} ${url.split("/").pop()}`);
      return opts.load ? opts.load(url) : Promise.resolve();
    },
    loadTransition: async () => {},
    ask: async (i) => {
      const url = frames[i]!;
      asks.push(url);
      return opts.answer ? opts.answer(url) : { id: 1, slots: [camera], version: url.split("v=")[1]!, hold: null };
    },
    reportSlots: (path, slots) => {
      reports.push({ path, slots });
      events.push(`report ${path}`);
      return opts.report ? opts.report() : Promise.resolve();
    },
    show: (i) => {
      front = i;
      events.push(`show ${i} ${frames[i]?.split("/").pop()}`);
    },
    unload: (i) => {
      if (frames[i]) events.push(`unload ${i}`);
      frames[i] = null;
    },
    wipe: (on) => void events.push(on ? "wipe" : "unwipe"),
    hold: () => 0,
    sleep: () => Promise.resolve(),
    later: (_ms, fn) => void timers.push(fn),
    log: () => {},
  };
  const loop = createProgramLoop(fx);
  return { loop, frames, events, asks, reports, timers, onScreen: () => (front === null ? null : frames[front]) };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const never = () => new Promise<never>(() => {});

describe("the program loop", () => {
  test("a tap on A then B before A has loaded shows B without waiting for A's load", async () => {
    const p = page({ load: (url) => (url.includes("a.html") ? never() : Promise.resolve()) });
    p.loop.request(job("org/a.html"));
    await settle();
    p.loop.request(job("org/b.html"));
    await settle();
    expect(p.onScreen()).toContain("b.html");
    expect(p.loop.shown()?.path).toBe("org/b.html");
    // A's frame was reused for B: nothing of A is left loading in the background.
    expect(p.frames.filter(Boolean)).toHaveLength(1);
  });

  test("a tap on another scene and straight back leaves nothing loading or playing behind the scene on air", async () => {
    let release!: () => void;
    const p = page({ load: (url) => (url.includes("brb") ? new Promise<void>((r) => (release = r)) : Promise.resolve()) });
    p.loop.request(job("org/a.html"));
    await settle();
    p.loop.request(job("org/brb.html"));
    await settle();
    p.loop.request(job("org/a.html"));
    await settle();
    release();
    await settle();
    expect(p.onScreen()).toContain("a.html");
    expect(p.frames.filter(Boolean)).toEqual([job("org/a.html").url]);
  });

  test("the scene that goes off air is unloaded after the wipe, so its media and timers stop", async () => {
    const p = page();
    p.loop.request(job("org/a.html"));
    await settle();
    p.loop.request(job("org/b.html"));
    await settle();
    // A went into frame 1; B loads into frame 0, behind the wipe, and A's frame is emptied once B shows.
    const b = "b.html?edit&bridge&v=0.0";
    expect(p.events.slice(p.events.indexOf(`load 0 ${b}`))).toEqual([`load 0 ${b}`, "wipe", "report org/b.html", `show 0 ${b}`, "unwipe", "unload 1", "unwipe"]);
    expect(p.frames).toEqual([job("org/b.html").url, null]);
  });

  test("a saved edit of the scene on air swaps without the transition, and the old version is unloaded too", async () => {
    const p = page();
    p.loop.request(job("org/a.html", "0.0"));
    await settle();
    p.loop.request(job("org/a.html", "1.0"));
    await settle();
    expect(p.events).not.toContain("wipe");
    expect(p.onScreen()).toContain("v=1.0");
    expect(p.frames.filter(Boolean)).toHaveLength(1);
  });

  test("renamed on air, or a stream copy reverted to the project's: no transition", async () => {
    const p = page();
    p.loop.request(job("org/a.html"));
    await settle();
    p.loop.request(job("org/b.html", "0.0", { from: "org/a.html" }));
    await settle();
    expect(p.events).not.toContain("wipe");
    expect(p.onScreen()).toContain("b.html");
  });

  test("a stuck server (OBS not answering placement) doesn't hold the switch", async () => {
    const p = page({ report: never });
    p.loop.request(job("org/a.html"));
    await settle();
    p.loop.request(job("org/b.html"));
    await settle();
    expect(p.onScreen()).toContain("b.html");
    expect(p.reports.map((r) => r.path)).toEqual(["org/a.html", "org/b.html"]);
  });

  test("a scene whose bridge never answers is asked twice the first time, once on every switch after", async () => {
    const p = page({ answer: (url) => (url.includes("quiet") ? null : { id: 1, slots: [], version: "x", hold: null }) });
    const count = () => p.asks.filter((u) => u.includes("quiet")).length;
    p.loop.request(job("org/quiet.html"));
    await settle();
    expect(count()).toBe(2);
    expect(p.reports.at(-1)).toEqual({ path: "org/quiet.html", slots: [] });
    for (let n = 1; n <= 2; n++) {
      p.loop.request(job("org/other.html"));
      await settle();
      p.loop.request(job("org/quiet.html"));
      await settle();
      expect(count()).toBe(2 + n);
    }
    // And a late answer still places its sources.
    expect(p.timers.length).toBeGreaterThan(0);
  });

  test("a scene that didn't answer this time keeps the slots its version reported before", async () => {
    let quiet = false;
    const p = page({ answer: (url) => (quiet && url.includes("a.html") ? null : { id: 1, slots: [camera], version: "va", hold: null }) });
    p.loop.request(job("org/a.html"));
    await settle();
    p.loop.request(job("org/b.html"));
    await settle();
    quiet = true;
    p.loop.request(job("org/a.html"));
    await settle();
    expect(p.reports.at(-1)).toEqual({ path: "org/a.html", slots: [camera] });
    expect(p.asks.filter((u) => u.includes("a.html"))).toHaveLength(2); // known: one ask, not two
  });

  test("the same file version again (every url changed when the live socket came back) keeps the frame that's playing", async () => {
    const p = page({ answer: () => ({ id: 1, slots: [camera], version: "hash-1", hold: null }) });
    p.loop.request(job("org/a.html", "0.0"));
    await settle();
    const playing = p.onScreen();
    p.loop.request(job("org/a.html", "0.1"));
    await settle();
    expect(p.onScreen()).toBe(playing);
    expect(p.loop.shown()?.url).toBe(job("org/a.html", "0.1").url);
    expect(p.frames.filter(Boolean)).toHaveLength(1);
    // Unless the reload is wanted (live previews to throw away).
    p.loop.request(job("org/a.html", "0.1", { url: `${job("org/a.html", "0.1").url}&fresh=1`, force: true }));
    await settle();
    expect(p.onScreen()).toContain("fresh=1");
  });

  test("however fast the taps, it ends on the last one", async () => {
    const p = page({ load: () => new Promise((r) => setTimeout(r, Math.random() * 5)) });
    const paths = ["a", "b", "c", "d", "e", "f"].map((n) => `org/${n}.html`);
    for (const path of paths) {
      p.loop.request(job(path));
      await new Promise((r) => setTimeout(r, Math.random() * 4));
    }
    await new Promise((r) => setTimeout(r, 50));
    expect(p.loop.shown()?.path).toBe("org/f.html");
    expect(p.onScreen()).toContain("f.html");
  });
});
