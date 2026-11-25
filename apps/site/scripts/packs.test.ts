import { describe, expect, test } from "bun:test";
import { verifyZip } from "./packs";
import { sitePacks, zipPack } from "../../server/src/export-packs";
import { writeZip } from "../../server/src/zip";
import { join } from "node:path";

describe("the site's template packs", () => {
  test("each one zips, reads back and passes the validator", async () => {
    const packs = await sitePacks(join(import.meta.dir, ".."));
    expect(packs.length).toBe(6);
    for (const { id, files } of packs) expect(verifyZip(id, zipPack(id, files)).views.length).toBe(5);
  });
  test("a zip that wouldn't install fails", () => {
    expect(() => verifyZip("fullcount", writeZip([{ name: "fullcount/templates/main.html", data: "<main></main>" }]))).toThrow(/pack\.json/);
    expect(() => verifyZip("fullcount", writeZip([{ name: "../evil.html", data: "x" }]))).toThrow();
  });
});
