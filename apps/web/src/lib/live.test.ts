import { describe, expect, test } from "bun:test";
import { caughtUp, type Live, missedChanges, nextLive, sceneUrl, sharedRootOf } from "./live";

describe("catching up after the live socket comes back", () => {
  test("every scene's url changes, whether it changed before or never did, so each one loads what's on disk now", () => {
    const before = { "org/a.html": 3, "*": 1 };
    const after = caughtUp(before);
    for (const path of ["org/a.html", "org/never-changed.html"]) {
      expect(sceneUrl(path, after)).not.toBe(sceneUrl(path, before));
      expect(sceneUrl(path, after, false, true, true)).not.toBe(sceneUrl(path, before, false, true, true));
    }
    expect(sceneUrl("org/x.html", caughtUp({}))).not.toBe(sceneUrl("org/x.html", {}));
  });

  test("a page coming back reloads only if it missed changes: the server restarted, or sent changes meanwhile", () => {
    const run = { server: "run-1", seq: 4 };
    expect(missedChanges(null, run)).toBe(false); // the first connect: nothing to catch up on
    expect(missedChanges(run, { server: "run-1", seq: 4 })).toBe(false); // a short drop with nothing changed
    expect(missedChanges(run, { server: "run-1", seq: 6 })).toBe(true); // changes sent while away
    expect(missedChanges(run, { server: "run-2", seq: 0 })).toBe(true); // a restart: anything may have changed
  });
});

describe("a change in a _shared/ folder reloads the views that use it", () => {
  const VIEWS = {
    orgTemplate: "daisy/templates/brb.html",
    neonView: "daisy/templates/neon/brb.html",
    neonTransition: "daisy/templates/neon/_shared/transition.html",
    citrusView: "daisy/templates/citrus/brb.html",
    orgTransition: "daisy/templates/_shared/transition.html",
    projectView: "daisy/projects/weekly/scenes/teaching.html",
    streamView: "daisy/projects/weekly/streams/03-01-x/teaching.html",
    projectTransition: "daisy/projects/weekly/transition.html",
    otherOrg: "grace/templates/brb.html",
    otherOrgProject: "grace/projects/sunday/scenes/live.html",
  };
  const empty: Live = { connected: true, state: null, versions: {}, hashes: {} };
  /** Which views' urls change when `paths` change. */
  const reloaded = (paths: string[]) => {
    const after = nextLive(empty, { t: "library:changed", paths, seq: 1 });
    return Object.entries(VIEWS).filter(([, p]) => sceneUrl(p, after.versions, true) !== sceneUrl(p, empty.versions, true)).map(([k]) => k);
  };

  test("the org's theme: its own templates, its sets' views (which may link it), its projects' and streams' views; never another org's", () => {
    expect(reloaded(["daisy/templates/_shared/theme.css"])).toEqual(["orgTemplate", "neonView", "neonTransition", "citrusView", "orgTransition", "projectView", "streamView", "projectTransition"]);
  });

  test("one set's theme: that set's views and the org's projects and streams, not the org's own templates or another set's", () => {
    expect(reloaded(["daisy/templates/neon/_shared/theme.css"])).toEqual(["neonView", "neonTransition", "projectView", "streamView", "projectTransition"]);
  });

  test("a file outside any _shared/ folder reloads only itself", () => {
    expect(reloaded([VIEWS.neonView])).toEqual(["neonView"]);
    expect(reloaded(["daisy/assets/logo.png"])).toEqual([]);
    expect(reloaded(["daisy/templates/neon/pack.json"])).toEqual([]);
  });

  test("a whole _shared/ folder reported (a move, a delete) counts as a change in it", () => {
    expect(reloaded(["daisy/templates/neon/_shared"])).toEqual(reloaded(["daisy/templates/neon/_shared/theme.css"]));
    expect(sharedRootOf("daisy/templates/_shared")).toBe("daisy/templates/_shared");
    expect(sharedRootOf("daisy/templates/neon/_shared/brand/mark.svg")).toBe("daisy/templates/neon/_shared");
    expect(sharedRootOf("daisy/templates/_sharedx/a.css")).toBeNull();
    expect(sharedRootOf("daisy/templates/_shared/_shared/theme.css")).toBe("daisy/templates/_shared");
    expect(sharedRootOf("daisy/templates/_drafts/_shared/theme.css")).toBeNull(); // not a set: the scan doesn't list it
    expect(sharedRootOf("daisy/projects/p/_shared/a.css")).toBeNull();
  });

  test("each change moves the url on, again and again", () => {
    let live = empty;
    const seen = new Set([sceneUrl(VIEWS.neonView, live.versions)]);
    for (const p of ["daisy/templates/neon/_shared/a.css", "daisy/templates/_shared/b.css", "daisy/templates/neon/_shared/a.css"]) {
      live = nextLive(live, { t: "library:changed", paths: [p], seq: 1 });
      seen.add(sceneUrl(VIEWS.neonView, live.versions));
    }
    expect(seen.size).toBe(4);
  });
});

describe("a change's hashes", () => {
  const empty: Live = { connected: true, state: null, versions: {}, hashes: {} };
  test("are kept per view, and a later change without one forgets the old one", () => {
    let live = nextLive(empty, { t: "library:changed", paths: ["d/templates/a.html", "d/templates/b.html"], seq: 1, hashes: { "d/templates/a.html": "h1" } });
    expect(live.hashes).toEqual({ "d/templates/a.html": "h1" });
    live = nextLive(live, { t: "library:changed", paths: ["d/templates/a.html"], seq: 2, hashes: { "d/templates/a.html": "h2" } });
    expect(live.hashes["d/templates/a.html"]).toBe("h2");
    live = nextLive(live, { t: "library:changed", paths: ["d/templates/a.html"], seq: 3 });
    expect(live.hashes["d/templates/a.html"]).toBeUndefined();
  });
});
