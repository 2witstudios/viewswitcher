import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fontsFromCss, parseCredits } from "./credits";
import { SHOWS } from "../data/shows";

const site = join(import.meta.dir, "../..");

describe("parseCredits", () => {
  test("reads a photo row", () => {
    const c = parseCredits("| src/assets/media/cook.jpg | Cook | [Woman cooking](https://unsplash.com/photos/x) | [@jsnbrsc](https://unsplash.com/@jsnbrsc) | Unsplash License |");
    expect(c.cook).toEqual({ file: "cook", photo: "Woman cooking", photoUrl: "https://unsplash.com/photos/x", by: "@jsnbrsc", byUrl: "https://unsplash.com/@jsnbrsc", license: "Unsplash License" });
  });
  test("CREDITS.md credits every photo the example shows use", () => {
    const c = parseCredits(readFileSync(join(site, "CREDITS.md"), "utf8"));
    for (const s of SHOWS) for (const v of s.views) for (const m of Object.values(v.media ?? {})) expect({ show: s.id, media: m, credited: !!c[m] }).toEqual({ show: s.id, media: m, credited: true });
  });
});

describe("fontsFromCss", () => {
  test("reads every family in a Google Fonts import", () => {
    expect(fontsFromCss('@import url("https://fonts.googleapis.com/css2?family=Caveat:wght@500&family=Work+Sans:wght@400;600&display=swap");')).toEqual(["Caveat", "Work Sans"]);
  });
  test("every template set names at least one font", () => {
    for (const id of readdirSync(join(site, "scripts/shows")).filter((d) => d !== "_shared")) expect(fontsFromCss(readFileSync(join(site, "scripts/shows", id, "theme.css"), "utf8")).length).toBeGreaterThan(0);
  });
});
