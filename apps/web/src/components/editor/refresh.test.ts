import { describe, expect, test } from "bun:test";
import { toBase } from "@viewswitcher/shared";
import { alreadyHave, refreshVerdict } from "./refresh";

const v1 = toBase({ html: "<p>One</p>", hash: "1" });
const v2 = toBase({ html: "<p>Two</p>", hash: "2" });

describe("a change made elsewhere, once read", () => {
  test("is shown when it's another version and nothing happened meanwhile", () => {
    expect(refreshVerdict({ readFrom: v1, now: v1, readHash: "agent", free: true })).toBe("show");
  });

  test("is nothing new when it's the version the editor has (its own save, coming back)", () => {
    expect(refreshVerdict({ readFrom: v1, now: v1, readHash: "1", free: true })).toBe("same");
    expect(refreshVerdict({ readFrom: v1, now: v1, readHash: "1", free: false })).toBe("same");
  });

  test("waits when the editor got busy while it was read", () => {
    expect(refreshVerdict({ readFrom: v1, now: v1, readHash: "agent", free: false })).toBe("retry");
  });

  test("reads again when one of the editor's own saves landed meanwhile: what was read may be older", () => {
    // The read started at v1, the editor saved v2 during it, and the read came back with v1's
    // predecessor or the agent's version: never shown over v2 without reading again.
    expect(refreshVerdict({ readFrom: v1, now: v2, readHash: "0", free: true })).toBe("retry");
  });
});

describe("a read that lands after the file changed back (A → B → A)", () => {
  test("is never shown when the newest report says the version open is the file's now", () => {
    // Open at v1; a change to v2 started a read; the file went back to v1 (reported) before the read landed with v2.
    expect(refreshVerdict({ readFrom: v1, now: v1, readHash: "2", reportedHash: "1", free: true })).toBe("same");
  });
  test("is shown when the report is that newer version, or there's none", () => {
    expect(refreshVerdict({ readFrom: v1, now: v1, readHash: "2", reportedHash: "2", free: true })).toBe("show");
    expect(refreshVerdict({ readFrom: v1, now: v1, readHash: "2", free: true })).toBe("show");
  });
});

describe("a change the server reported with its hash", () => {
  test("is nothing to read when the hash is the version open (the editor's own save, coming back)", () => {
    expect(alreadyHave("1", v1)).toBe(true);
  });
  test("is read when it's another version, when the server didn't say, or before anything is open", () => {
    expect(alreadyHave("2", v1)).toBe(false);
    expect(alreadyHave(undefined, v1)).toBe(false);
    expect(alreadyHave("1", null)).toBe(false);
  });
});
