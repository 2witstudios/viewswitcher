// The backstop's decision, tested apart from the route.
import { describe, expect, test } from "bun:test";
import { freshUrl, shouldBackstop } from "./backstop";

const a = { url: "/library/x/a.html?edit&v=1.0", path: "x/a.html" };
const b = { url: "/library/x/b.html?edit&v=1.0", path: "x/b.html" };
const a2 = { url: "/library/x/a.html?edit&v=2.0", path: "x/a.html" };

describe("shouldBackstop", () => {
  test("fires when the previewed scene is still shown and nothing newer was asked for", () => {
    expect(shouldBackstop(a, a, a)).toBe(true);
  });
  test("bails when a saved version replaced it", () => {
    expect(shouldBackstop(a2, a2, a)).toBe(false);
  });
  test("bails when the operator asked for another scene that's still loading", () => {
    expect(shouldBackstop(a, b, a)).toBe(false);
  });
});

describe("freshUrl", () => {
  test("keeps one marker however often it fires", () => {
    const once = freshUrl(a.url, 3);
    expect(once).toBe(`${a.url}&fresh=3`);
    expect(freshUrl(freshUrl(once, 7), 9)).toBe(`${a.url}&fresh=9`);
  });
});
