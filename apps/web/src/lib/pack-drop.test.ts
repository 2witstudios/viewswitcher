// What the install dialog says a pack runs.
import { expect, test } from "bun:test";
import { describeScripts } from "./pack-drop";

test("plain words for what a pack runs", () => {
  expect(describeScripts({ files: [], inline: [], remote: [], standard: false })).toEqual(["It runs no scripts."]);
  expect(describeScripts({ files: ["_shared/scene.js"], inline: [], remote: [], standard: true })).toEqual(["ViewSwitcher's standard view script (countdowns, transition effects)."]);
  expect(describeScripts({ files: ["_shared/scene.js", "_shared/fx.js"], inline: ["templates/intro.html"], remote: ["https://cdn.example/x.js"], standard: false })).toEqual([
    "Its own scripts: _shared/scene.js, _shared/fx.js.",
    "Code written into intro.html.",
    "Scripts from other sites: https://cdn.example/x.js.",
  ]);
});
