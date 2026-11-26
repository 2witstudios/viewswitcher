// Every on-air view is served through the scanner (?edit). With
// VIEWSWITCHER_LIBRARY set, check every scene in that library tags and untags byte for byte and
// closes every element, so a scanner change can't silently blank a show.
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { scanElements, tagForEdit, untagForEdit } from "@viewswitcher/shared";

const library = process.env.VIEWSWITCHER_LIBRARY;

describe.skipIf(!library)("the library round-trips through the scanner", () => {
  test("every scene tags and untags to the same bytes", async () => {
    let n = 0;
    for await (const f of new Glob("**/*.html").scan({ cwd: library!, dot: false })) {
      const html = await Bun.file(`${library}/${f}`).text();
      expect({ f, back: untagForEdit(tagForEdit(html, "h")) === html }).toEqual({ f, back: true });
      expect({ f, unclosed: scanElements(html).filter((e) => !e.closed).map((e) => e.tag) }).toEqual({ f, unclosed: [] });
      n++;
    }
    expect(n).toBeGreaterThan(0);
  });
});
