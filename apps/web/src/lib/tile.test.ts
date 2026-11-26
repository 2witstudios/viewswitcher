// A tile's frame, rendered with React in a DOM (happy-dom): when it runs, and when it reloads.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, createElement } from "react";
import type { Stagger } from "./stagger";
import { ownFile, useNearScreen, useTileSrc } from "./tile";

let createRoot: typeof import("react-dom/client").createRoot;
/** The observers the page made; `show` says whether their element is near the screen now. */
let observers: { show: (near: boolean) => void; disconnected: boolean }[] = [];
beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as { IntersectionObserver: unknown }).IntersectionObserver = class {
    entry = { disconnected: false, show: (_: boolean) => {} };
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
      this.entry.show = (near) => callback([{ isIntersecting: near }]);
      observers.push(this.entry);
    }
    observe() {}
    disconnect() {
      this.entry.disconnected = true;
    }
  };
  ({ createRoot } = await import("react-dom/client"));
});
afterAll(() => GlobalRegistrator.unregister());

/** A reload queue the test runs by hand. */
function queue() {
  const waiting: { run: () => void }[] = [];
  const stagger: Stagger = {
    request(run) {
      const job = { run };
      waiting.push(job);
      return () => {
        const i = waiting.indexOf(job);
        if (i >= 0) waiting.splice(i, 1);
      };
    },
  };
  return { stagger, waiting, runNext: () => act(() => waiting.shift()?.run()) };
}

/** A tile reduced to its frame's url, with `wanted`, `own` and `near` set by the test. */
function tile(reloads: Stagger, first: { wanted: string; own: string; near: boolean }) {
  let props = first;
  const shown: string[] = [];
  function Probe() {
    shown.push(useTileSrc(props.wanted, props.own, null, props.near, reloads));
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  return {
    set(next: Partial<typeof props>) {
      props = { ...props, ...next };
      act(() => root.render(createElement(Probe)));
    },
    get src() {
      return shown.at(-1);
    },
    unmount: () => act(() => root.unmount()),
  };
}

describe("a tile's frame url", () => {
  test("its own file changing loads at once, without waiting in the queue", () => {
    const q = queue();
    const t = tile(q.stagger, { wanted: "a?v=0.0", own: "a@0", near: true });
    t.set({ wanted: "a?v=1.0", own: "a@1" });
    expect(t.src).toBe("a?v=1.0");
    expect(q.waiting).toHaveLength(0);
    t.unmount();
  });

  test("another file taking the tile's place (a Customize or Revert) loads at once", () => {
    const q = queue();
    const t = tile(q.stagger, { wanted: "a?v=0.0", own: "a@0", near: true });
    t.set({ wanted: "b?v=0.0", own: "b@0" });
    expect(t.src).toBe("b?v=0.0");
    expect(q.waiting).toHaveLength(0);
    t.unmount();
  });

  test("a shared theme change waits its turn", () => {
    const q = queue();
    const t = tile(q.stagger, { wanted: "a?v=0.0", own: "a@0", near: true });
    t.set({ wanted: "a?v=0.1" });
    expect(t.src).toBe("a?v=0.0");
    expect(q.waiting).toHaveLength(1);
    q.runNext();
    expect(t.src).toBe("a?v=0.1");
    t.unmount();
  });

  test("a tile away from the screen just takes the new url (it has no frame to reload)", () => {
    const q = queue();
    const t = tile(q.stagger, { wanted: "a?v=0.0", own: "a@0", near: false });
    t.set({ wanted: "a?v=0.1" });
    expect(t.src).toBe("a?v=0.1");
    expect(q.waiting).toHaveLength(0);
    t.unmount();
  });

  test("a newer url while one is waiting replaces it: one reload, to the newest", () => {
    const q = queue();
    const t = tile(q.stagger, { wanted: "a?v=0.0", own: "a@0", near: true });
    t.set({ wanted: "a?v=0.1" });
    t.set({ wanted: "a?v=0.2" });
    expect(q.waiting).toHaveLength(1);
    q.runNext();
    expect(t.src).toBe("a?v=0.2");
    t.unmount();
  });

  test("leaving the screen while waiting gives up its turn and takes the url", () => {
    const q = queue();
    const t = tile(q.stagger, { wanted: "a?v=0.0", own: "a@0", near: true });
    t.set({ wanted: "a?v=0.1" });
    t.set({ near: false });
    expect(q.waiting).toHaveLength(0);
    expect(t.src).toBe("a?v=0.1");
    t.unmount();
  });

  test("a tile that goes away while waiting gives up its turn", () => {
    const q = queue();
    const t = tile(q.stagger, { wanted: "a?v=0.0", own: "a@0", near: true });
    t.set({ wanted: "a?v=0.1" });
    t.unmount();
    expect(q.waiting).toHaveLength(0);
  });
});

test("ownFile: another file at the same version, and the same file at a new version, are both a change of its own", () => {
  const versions = { "o/p/scenes/brb.html": 0, "o/p/streams/s/brb.html": 0, "*": 4 };
  const before = ownFile("o/p/streams/s/brb.html", versions);
  expect(ownFile("o/p/scenes/brb.html", versions)).not.toBe(before); // Revert: the project's file takes its place
  expect(ownFile("o/p/streams/s/brb.html", { ...versions, "o/p/streams/s/brb.html": 1 })).not.toBe(before);
  expect(ownFile("o/p/streams/s/brb.html", { ...versions, "*": 5 })).toBe(before); // the shared theme isn't its own
});

describe("near the screen", () => {
  test("follows the observer, and stops observing when the tile goes away", () => {
    observers = [];
    const seen: boolean[] = [];
    const el = document.createElement("div");
    function Probe() {
      seen.push(useNearScreen(el));
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe)));
    expect(seen.at(-1)).toBe(false); // no frame until the observer says so
    act(() => observers[0]!.show(true));
    expect(seen.at(-1)).toBe(true);
    act(() => observers[0]!.show(false));
    expect(seen.at(-1)).toBe(false);
    act(() => root.unmount());
    expect(observers[0]!.disconnected).toBe(true);
  });
});
