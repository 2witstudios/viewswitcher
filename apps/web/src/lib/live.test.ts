import { describe, expect, test } from "bun:test";
import { caughtUp, sceneUrl } from "./live";

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
});
