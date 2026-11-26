import { describe, expect, test } from "bun:test";
import { isViewPath, orgOf, parseLibraryPath, projectViewOf, transitionCandidates } from "./index";

const kind = (p: string) => parseLibraryPath(p).kind;

describe("parseLibraryPath", () => {
  test("the org's own templates", () => {
    expect(parseLibraryPath("daisy/templates/brb.html")).toEqual({ org: "daisy", kind: "template", rest: "templates/brb.html", name: "brb" });
  });

  test("a template set's views, folder, pack.json, theme, transition and assets", () => {
    expect(parseLibraryPath("daisy/templates/neon/teaching.html")).toEqual({ org: "daisy", kind: "template", rest: "templates/neon/teaching.html", set: "neon", name: "teaching" });
    expect(parseLibraryPath("daisy/templates/neon")).toMatchObject({ kind: "set", set: "neon", name: "neon" });
    expect(parseLibraryPath("daisy/templates/neon/")).toMatchObject({ kind: "set", set: "neon" });
    expect(parseLibraryPath("daisy/templates/neon/pack.json")).toMatchObject({ kind: "set", set: "neon", name: "pack.json" });
    expect(parseLibraryPath("daisy/templates/neon/_shared/theme.css")).toMatchObject({ kind: "shared", set: "neon", name: "theme.css" });
    expect(parseLibraryPath("daisy/templates/neon/_shared/fonts/a.woff2")).toMatchObject({ kind: "shared", set: "neon" });
    expect(parseLibraryPath("daisy/templates/neon/_shared/transition.html")).toMatchObject({ kind: "transition", set: "neon" });
    expect(parseLibraryPath("daisy/templates/neon/assets/bg.jpg")).toMatchObject({ kind: "asset", set: "neon", name: "bg.jpg" });
    expect(parseLibraryPath("daisy/templates/neon/notes/a.html")).toMatchObject({ kind: "other", set: "neon" });
  });

  test("the org's _shared files and transition", () => {
    expect(parseLibraryPath("daisy/templates/_shared/transition.html")).toMatchObject({ kind: "transition", name: "transition.html" });
    expect(parseLibraryPath("daisy/templates/_shared/transition.html").set).toBeUndefined();
    expect(kind("daisy/templates/_shared/theme.css")).toBe("shared");
    expect(kind("daisy/templates/_shared/brand/mark.svg")).toBe("shared");
    expect(kind("daisy/templates/_shared/order.json")).toBe("shared");
    expect(kind("daisy/templates/_shared/sub/transition.html")).toBe("shared");
  });

  test("project and stream views", () => {
    expect(parseLibraryPath("daisy/projects/ld/scenes/teaching.html")).toEqual({ org: "daisy", kind: "project", rest: "projects/ld/scenes/teaching.html", project: "ld", name: "teaching" });
    expect(parseLibraryPath("daisy/projects/ld/streams/09-14-x/teaching.html")).toEqual({
      org: "daisy", kind: "stream", rest: "projects/ld/streams/09-14-x/teaching.html", project: "ld", stream: "09-14-x", name: "teaching",
    });
  });

  test("a project's transition, folders and manifests", () => {
    expect(parseLibraryPath("daisy/projects/ld/transition.html")).toMatchObject({ kind: "transition", project: "ld" });
    expect(parseLibraryPath("daisy/projects/ld")).toMatchObject({ kind: "other", project: "ld" });
    expect(parseLibraryPath("daisy/projects/ld/project.json")).toMatchObject({ kind: "other", project: "ld", name: "project.json" });
    expect(parseLibraryPath("daisy/projects/ld/streams/09-14-x")).toMatchObject({ kind: "other", project: "ld", stream: "09-14-x" });
    expect(parseLibraryPath("daisy/projects/ld/streams/09-14-x/stream.json")).toMatchObject({ kind: "other", stream: "09-14-x" });
  });

  test("assets and the org's own files", () => {
    expect(parseLibraryPath("daisy/assets/logo.png")).toMatchObject({ kind: "asset", name: "logo.png" });
    expect(parseLibraryPath("daisy")).toEqual({ org: "daisy", kind: "org", rest: "", name: "daisy" });
    expect(kind("daisy/org.json")).toBe("org");
    expect(kind("daisy/BRAND.md")).toBe("org");
    expect(kind("daisy/templates")).toBe("other");
    expect(kind("daisy/assets")).toBe("other");
    expect(kind("daisy/projects")).toBe("other");
  });

  test("names the scan doesn't list aren't views", () => {
    expect(kind("daisy/templates/brb.HTML")).toBe("other");
    expect(kind("daisy/templates/.brb.html")).toBe("other");
    expect(kind("daisy/templates/.html")).toBe("other");
    expect(kind("daisy/templates/brb.css")).toBe("other");
    expect(kind("daisy/templates/_drafts/a.html")).toBe("other");
    expect(kind("daisy/projects/_old/scenes/a.html")).toBe("other");
    expect(kind("daisy/projects/ld/scenes/deep/a.html")).toBe("other");
    expect(kind("daisy/projects/ld/streams/s/deep/a.html")).toBe("other");
    expect(kind("daisy/projects/ld/streams/.s/a.html")).toBe("other");
    expect(kind("daisy/notes/a.html")).toBe("other");
  });

  test("an empty path or segment is other", () => {
    expect(parseLibraryPath("")).toMatchObject({ org: "", kind: "other" });
    expect(kind("daisy//templates/brb.html")).toBe("other");
    expect(kind("/daisy/templates/brb.html")).toBe("other");
  });

  test("isViewPath is true for the three kinds of view only", () => {
    expect(["daisy/templates/brb.html", "daisy/templates/neon/brb.html", "daisy/projects/ld/scenes/a.html", "daisy/projects/ld/streams/s/a.html"].every((p) => isViewPath(parseLibraryPath(p)))).toBe(true);
    expect(["daisy/templates/_shared/transition.html", "daisy/projects/ld/transition.html", "daisy/assets/a.png", "daisy/org.json"].some((p) => isViewPath(parseLibraryPath(p)))).toBe(false);
  });
});

describe("orgOf and projectViewOf", () => {
  test("orgOf is the first segment", () => {
    expect(orgOf("daisy/projects/ld/scenes/teaching.html")).toBe("daisy");
    expect(orgOf("daisy")).toBe("daisy");
  });

  test("a stream's view names the project view it copies; nothing else does", () => {
    expect(projectViewOf("daisy/projects/ld/streams/09-14-x/teaching.html")).toBe("daisy/projects/ld/scenes/teaching.html");
    expect(projectViewOf("daisy/projects/ld/scenes/teaching.html")).toBeNull();
    expect(projectViewOf("daisy/templates/teaching.html")).toBeNull();
  });
});

describe("transitionCandidates", () => {
  test("a stream's view: its project's, then the org's", () => {
    expect(transitionCandidates("daisy/projects/ld/streams/09-14-x/teaching.html")).toEqual(["daisy/projects/ld/transition.html", "daisy/templates/_shared/transition.html"]);
  });

  test("an org template: the org's only", () => {
    expect(transitionCandidates("daisy/templates/brb.html")).toEqual(["daisy/templates/_shared/transition.html"]);
  });

  test("a template set's view: the set's own first, then the org's", () => {
    expect(transitionCandidates("daisy/templates/neon/brb.html")).toEqual(["daisy/templates/neon/_shared/transition.html", "daisy/templates/_shared/transition.html"]);
  });
});
