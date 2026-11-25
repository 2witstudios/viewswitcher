import { describe, expect, test } from "bun:test";
import { caughtUp, missedChanges, sceneUrl } from "./live";

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
