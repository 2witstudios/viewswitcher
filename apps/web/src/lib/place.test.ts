import { describe, expect, test } from "bun:test";
import type { OrgContent } from "@viewswitcher/shared";
import { placeOf } from "./place";

const scene = (path: string, label: string) => ({ path, label }) as OrgContent["templates"][number];
const lib = {
  org: { id: "daisy", name: "Bible Study" },
  templates: [scene("daisy/templates/teaching.html", "Teaching")],
  projects: [{
    name: "Genesis",
    scenes: [scene("daisy/projects/genesis/intro.html", "Intro")],
    streams: [
      { name: "day-1", date: "2026-11-24", scenes: [scene("daisy/projects/genesis/day-1/intro.html", "Intro (Day 1)")] },
      { name: "extra", date: null, scenes: [scene("daisy/projects/genesis/extra/q.html", "Q&A")] },
    ],
  }],
} as unknown as OrgContent;

describe("placeOf", () => {
  test("names where a scene lives, for the crumb", () => {
    expect(placeOf(lib, "daisy/templates/teaching.html")).toEqual({ crumb: "Bible Study · Templates", title: "Teaching" });
    expect(placeOf(lib, "daisy/projects/genesis/intro.html")).toEqual({ crumb: "Bible Study · Genesis", title: "Intro" });
    expect(placeOf(lib, "daisy/projects/genesis/day-1/intro.html")).toEqual({ crumb: "Bible Study · Genesis · Nov 24", title: "Intro (Day 1)" });
    expect(placeOf(lib, "daisy/projects/genesis/extra/q.html")).toEqual({ crumb: "Bible Study · Genesis · extra", title: "Q&A" });
  });

  test("falls back to the file name until the library knows it", () => {
    expect(placeOf(undefined, "daisy/templates/new-one.html")).toEqual({ crumb: "", title: "new-one" });
    expect(placeOf(lib, "daisy/templates/new-one.html")).toEqual({ crumb: "Bible Study", title: "new-one" });
  });
});
