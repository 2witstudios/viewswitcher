import { describe, expect, test } from "bun:test";
import { coverTransform, obsColor, obsReady, orgOf, resolveStream, shortDate, slugify, transitionCandidates } from "./index";
import type { Project, Scene, Stream } from "./types";

const scene = (name: string, origin: Scene["origin"], dir: string): Scene => ({
  name, label: name, origin, path: `${dir}/${name}.html`,
});

const project: Project = {
  id: "ld-2026",
  name: "LD",
  scenes: ["starting-soon", "teaching", "brb"].map((n) => scene(n, "project", "projects/ld-2026/scenes")),
  streams: [],
  transition: null,
};

describe("resolveStream", () => {
  test("an empty stream uses every project scene", () => {
    const stream: Stream = { id: "11-20-reading", name: "Reading", date: "2026-11-20", scenes: [] };
    const r = resolveStream(project, stream);
    expect(r.own).toEqual([]);
    expect(r.shared.map((s) => s.name)).toEqual(["starting-soon", "teaching", "brb"]);
  });

  test("a stream file with a project scene's name replaces it", () => {
    const dir = "projects/ld-2026/streams/12-04-burdens";
    const stream: Stream = {
      id: "12-04-burdens", name: "Burdens", date: "2026-12-04",
      scenes: [scene("teaching", "stream", dir), scene("whiteboard", "stream", dir)],
    };
    const r = resolveStream(project, stream);
    expect(r.own.map((s) => [s.name, s.overrides])).toEqual([["teaching", true], ["whiteboard", false]]);
    expect(r.shared.map((s) => s.name)).toEqual(["starting-soon", "brb"]);
  });
});

describe("coverTransform", () => {
  test("16:9 source into a 16:9 slot scales with no crop", () => {
    const t = coverTransform({ source: "Screen", x: 32, y: 32, w: 1472, h: 828 }, { width: 2560, height: 1440 });
    expect(t.positionX).toBe(32);
    expect(t.scaleX).toBeCloseTo(1472 / 2560);
    expect(t.cropLeft + t.cropRight + t.cropTop + t.cropBottom).toBe(0);
  });

  test("16:9 camera into a 4:5 slot crops the sides only", () => {
    const t = coverTransform({ source: "Camera", x: 1528, y: 32, w: 360, h: 450 }, { width: 1920, height: 1080 });
    expect(t.scaleX).toBeCloseTo(450 / 1080);
    expect(t.cropTop).toBe(0);
    // visible width = 1920 − 2·crop ≈ 360 / scale = 864
    expect(1920 - t.cropLeft - t.cropRight).toBeCloseTo(864, -1);
  });

  test("slots scale to a non-1080p OBS canvas", () => {
    const t = coverTransform({ source: "Screen", x: 960, y: 540, w: 960, h: 540 }, { width: 1920, height: 1080 }, { width: 1280, height: 720 });
    expect(t.positionX).toBe(640);
    expect(t.positionY).toBe(360);
    expect(t.scaleX).toBeCloseTo(640 / 1920);
  });
});

describe("helpers", () => {
  test("slugify", () => {
    expect(slugify("LD Resolution 2026–27")).toBe("ld-resolution-2026-27");
    expect(slugify("  ")).toBe("untitled");
  });
  test("shortDate", () => {
    expect(shortDate("2026-12-04")).toBe("Dec 4");
  });
});

describe("orgs", () => {
  test("OBS colors are opaque ABGR", () => {
    expect(obsColor("#0d1812")).toBe(0xff12180d);
    expect(obsColor("ffffff")).toBe(0xffffffff);
    expect(() => obsColor("red")).toThrow();
  });
  test("a path's org is its first folder", () => {
    expect(orgOf("daisy/projects/ld/scenes/teaching.html")).toBe("daisy");
  });
  test("a scene's transition: its project's first, then the org's", () => {
    expect(transitionCandidates("daisy/projects/ld/streams/09-14-x/teaching.html")).toEqual([
      "daisy/projects/ld/transition.html",
      "daisy/templates/_shared/transition.html",
    ]);
    expect(transitionCandidates("daisy/templates/brb.html")).toEqual(["daisy/templates/_shared/transition.html"]);
  });
});

describe("obsReady", () => {
  const full = { scene: true, program: true, ground: true, missingDevices: [] as string[] };
  test("needs the scene, program and ground; missing devices don't count", () => {
    expect(obsReady(full)).toBe(true);
    expect(obsReady({ ...full, missingDevices: ["iPad"] })).toBe(true);
    for (const k of ["scene", "program", "ground"] as const) expect(obsReady({ ...full, [k]: false })).toBe(false);
  });
});
