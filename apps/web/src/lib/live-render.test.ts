// Components reading a part of live state re-render only when that part changes: rendered with
// React in a DOM (happy-dom), over a store fed the messages the live socket gets.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { LiveState } from "@viewswitcher/shared";
import { act, createElement } from "react";
import { createStore, keepUnchanged, type Live, nextLive, sceneUrl, type Store, useStore } from "./live";

let createRoot: typeof import("react-dom/client").createRoot;
beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // After the DOM is there: react-dom looks for it when it loads.
  ({ createRoot } = await import("react-dom/client"));
});
afterAll(() => GlobalRegistrator.unregister());

const state = (patch: Partial<LiveState> = {}): LiveState => ({
  onAir: { path: "show/templates/brb.html", org: "show", label: "BRB" },
  obs: { connected: true, recording: false, streaming: true },
  obsSetup: null,
  usb: { enabled: true, attached: false, connected: false },
  warnings: [],
  agent: { onAir: "not-live", lastSeen: null, client: null },
  ...patch,
});
/** What the socket does with a message: a fresh object every time, as JSON.parse makes it. */
const receive = (store: Store<Live>, msg: Parameters<typeof nextLive>[1]) => act(() => store.set(nextLive(store.get(), structuredClone(msg))));

/** Renders `use` in a component and counts its renders. */
function counted<S>(store: Store<Live>, select: (l: Live) => S, isEqual?: (a: S, b: S) => boolean) {
  const seen: S[] = [];
  function Probe() {
    seen.push(useStore(store, select, isEqual));
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  return { get renders() { return seen.length; }, get last() { return seen.at(-1); }, unmount: () => act(() => root.unmount()) };
}

describe("re-rendering for the part of live state a component reads", () => {
  test("a warnings-only change doesn't re-render a tile, the on-air badge or the record buttons", () => {
    const store = createStore<Live>({ connected: true, state: null, versions: {}, hashes: {} });
    receive(store, { t: "state", state: state() });
    const tile = counted(store, (l) => sceneUrl("show/templates/title.html", l.versions, true));
    const onAir = counted(store, (l) => l.state?.onAir);
    const obs = counted(store, (l) => l.state?.obs);
    const warnings = counted(store, (l) => l.state?.warnings);

    // A placement report every 33 ms while a box is dragged, each with a different warning.
    for (let i = 0; i < 30; i++) receive(store, { t: "state", state: state({ warnings: [`Camera ${i} isn't in OBS`] }) });

    expect(tile.renders).toBe(1);
    expect(onAir.renders).toBe(1);
    expect(obs.renders).toBe(1);
    expect(warnings.renders).toBe(31);
    expect(warnings.last).toEqual(["Camera 29 isn't in OBS"]);
    for (const c of [tile, onAir, obs, warnings]) c.unmount();
  });

  test("a tile re-renders for its own file and the shared theme, not for another file", () => {
    const store = createStore<Live>({ connected: true, state: state(), versions: {}, hashes: {} });
    const tile = counted(store, (l) => sceneUrl("show/templates/title.html", l.versions, true));
    receive(store, { t: "library:changed", paths: ["show/templates/brb.html"], seq: 1 });
    expect(tile.renders).toBe(1);
    receive(store, { t: "library:changed", paths: ["show/templates/title.html"], seq: 2 });
    expect(tile.renders).toBe(2);
    receive(store, { t: "library:changed", paths: ["show/templates/_shared/theme.css"], seq: 3 });
    expect(tile.renders).toBe(3);
    expect(tile.last).toBe("/library/show/templates/title.html?preview&v=1.0.1");
    tile.unmount();
  });

  test("what's on air changing re-renders what reads it, with the new value", () => {
    const store = createStore<Live>({ connected: true, state: state(), versions: {}, hashes: {} });
    const onAir = counted(store, (l) => l.state?.onAir?.label);
    receive(store, { t: "state", state: state({ onAir: { path: "show/templates/title.html", org: "show", label: "Title" } }) });
    expect(onAir.renders).toBe(2);
    expect(onAir.last).toBe("Title");
    onAir.unmount();
  });

  test("a selector with its own equality re-renders only when that says the part changed", () => {
    const store = createStore<Live>({ connected: true, state: state(), versions: {}, hashes: {} });
    const sameLength = (a: string[] | undefined, b: string[] | undefined) => a?.length === b?.length;
    const count = counted(store, (l) => l.state?.warnings, sameLength);
    receive(store, { t: "state", state: state({ warnings: [] }) });
    expect(count.renders).toBe(1);
    receive(store, { t: "state", state: state({ warnings: ["x"] }) });
    receive(store, { t: "state", state: state({ warnings: ["y"] }) });
    expect(count.renders).toBe(2);
    expect(count.last).toEqual(["x"]); // the selection it kept, as the equality said nothing changed
    count.unmount();
  });
});

describe("keepUnchanged", () => {
  test("keeps each equal part of the previous value, and the whole when nothing changed", () => {
    const a = state();
    expect(keepUnchanged(a, structuredClone(a))).toBe(a);
    const b = keepUnchanged(a, state({ warnings: ["w"] }));
    expect(b).not.toBe(a);
    expect(b.onAir).toBe(a.onAir);
    expect(b.obs).toBe(a.obs);
    expect(b.warnings).toEqual(["w"]);
  });

  test("a key that went away, an array that grew or shrank, and null on either side are changes", () => {
    const a = state({ onAir: { path: "p", org: "o", label: "L", missing: true } });
    const b = keepUnchanged(a, state({ onAir: { path: "p", org: "o", label: "L" } }));
    expect(b.onAir).not.toBe(a.onAir);
    expect(b.onAir).toEqual({ path: "p", org: "o", label: "L" });
    expect(keepUnchanged(["a"], ["a", "b"])).toEqual(["a", "b"]);
    expect(keepUnchanged(["a", "b"], ["a"])).toEqual(["a"]);
    expect(keepUnchanged(state(), state({ onAir: null })).onAir).toBeNull();
    expect(keepUnchanged<LiveState | null>(null, state())?.onAir?.label).toBe("BRB");
  });
});
