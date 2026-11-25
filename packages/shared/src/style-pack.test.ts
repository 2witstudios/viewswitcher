// EDIT-23: the style pack format's validator.
import { describe, expect, test } from "bun:test";
import { checkPack, fillPlaceholders, installedPath, PACK_LIMITS, type PackEntry, planPack, readManifest } from "./style-pack";

const file = (path: string, size = 100): PackEntry => ({ path, size, type: "file" });
const manifest = (over: Record<string, unknown> = {}) => JSON.stringify({ format: 1, id: "neon", name: "Neon", version: "1.0.0", description: "Bright.", views: ["main", "brb"], placeholders: ["ORG_NAME", "PACK"], ...over });
const VIEW = `<!doctype html><html><head><title>Main</title><link rel="stylesheet" href="{{PACK}}/_shared/theme.css"></head><body><main class="scene"><h1>{{ORG_NAME}}</h1></main><script src="{{PACK}}/_shared/scene.js"></script></body></html>`;
const basic = [file("pack.json"), file("templates/main.html"), file("templates/brb.html"), file("_shared/theme.css"), file("_shared/scene.js"), file("_shared/brand/mark.svg"), file("assets/bg.jpg")];
const texts = (over: Record<string, string> = {}) => ({ "pack.json": manifest(), "templates/main.html": VIEW, "templates/brb.html": VIEW, "_shared/theme.css": "body{}", "_shared/scene.js": "", "_shared/brand/mark.svg": "<svg/>", ...over });

const planned = (entries: PackEntry[]) => {
  const p = planPack(entries);
  if (!p.ok) throw new Error(p.error);
  return p.files;
};

describe("planPack", () => {
  test("a folder's files, as they are", () => {
    expect(planned(basic).map((f) => f.path)).toEqual(basic.map((e) => e.path));
  });

  test("strips the one folder a zipped folder is wrapped in", () => {
    const files = planned([{ path: "neon/", size: 0, type: "dir" }, ...basic.map((e) => ({ ...e, path: `neon/${e.path}` }))]);
    expect(files[0]).toEqual({ path: "pack.json", from: "neon/pack.json", size: 100 });
    expect(files.every((f) => f.from === `neon/${f.path}`)).toBe(true);
  });

  test("leaves out what Finder and zip tools add", () => {
    const p = planPack([...basic, file("__MACOSX/._main.html"), file(".DS_Store"), file("_shared/.DS_Store"), file("templates/Thumbs.db")]);
    expect(p.ok && p.files.length).toBe(basic.length);
    expect(p.ok && p.skipped).toBe(4);
  });

  const refused: [string, PackEntry[], RegExp][] = [
    ["zip-slip with ..", [...basic, file("../../evil.html")], /outside the pack/],
    ["zip-slip in the middle", [...basic, file("templates/../../../x.js")], /outside the pack/],
    ["an absolute path", [...basic, file("/etc/passwd")], /outside the pack/],
    ["a Windows drive path", [...basic, file("C:/x.html")], /outside the pack/],
    ["a backslash", [...basic, file("templates\\..\\x.html")], /character/],
    ["a NUL", [...basic, file("templates/a\u0000.html")], /character/],
    ["a symlink", [...basic, { path: "_shared/theme.css.lnk", size: 10, type: "symlink" }], /link/],
    ["a symlink hidden as junk", [...basic, { path: "__MACOSX/x", size: 10, type: "symlink" }], /link/],
    ["a device or fifo", [...basic, { path: "assets/x.jpg", size: 0, type: "other" }], /plain file/],
    ["a script outside _shared", [...basic, file("assets/x.js")], /assets\/ holds/],
    ["html in assets", [...basic, file("assets/x.html")], /assets\/ holds/],
    ["an executable", [...basic, file("_shared/run.sh")], /_shared\/ holds/],
    ["html in _shared other than the transition", [...basic, file("_shared/other.html")], /_shared\/ holds/],
    ["a folder under templates", [...basic, file("templates/more/x.html")], /only the views/],
    ["css in templates", [...basic, file("templates/x.css")], /only the views/],
    ["a view with an upper-case .HTML", [...basic, file("templates/extra.HTML")], /lower-case \.html/],
    ["an unknown top folder", [...basic, file("scripts/x.js")], /doesn't belong/],
    ["a stray file at the top", [...basic, file("install.command")], /doesn't belong/],
    ["the same file twice in different case", [...basic, file("assets/BG.jpg")], /twice/],
    ["an odd file name", [...basic, file("assets/<b>.jpg")], /file names/],
    ["one big file", [...basic, file("assets/huge.mp4", PACK_LIMITS.fileBytes + 1)], /over 25 MB/],
    ["too much in all", [...basic, ...Array.from({ length: 5 }, (_, i) => file(`assets/v${i}.mp4`, 24 * 1024 * 1024))], /over 100 MB unpacked/],
    ["too many files", [...basic, ...Array.from({ length: PACK_LIMITS.files }, (_, i) => file(`assets/${i}.png`, 1))], /more than 400 files/],
    ["too deep", [...basic, file("_shared/a/b/c/d/e.png")], /deep/],
    ["no pack.json", basic.slice(1), /no pack.json/],
    ["a negative size", [...basic, { path: "assets/x.png", size: -1, type: "file" }], /no size/],
  ];
  for (const [what, entries, why] of refused) {
    test(`refuses ${what}`, () => {
      const p = planPack(entries);
      expect(p.ok).toBe(false);
      if (!p.ok) expect(p.error).toMatch(why);
    });
  }
});

describe("readManifest", () => {
  test("reads a good one", () => {
    const r = readManifest(manifest({ author: " Studio " }));
    expect(r).toEqual({ ok: true, manifest: { format: 1, id: "neon", name: "Neon", version: "1.0.0", description: "Bright.", author: "Studio", views: ["main", "brb"], placeholders: ["ORG_NAME", "PACK"] } });
  });
  test("format defaults to 1; placeholders and description are optional", () => {
    const r = readManifest(JSON.stringify({ id: "a", name: "A", version: "0.1", views: ["x"] }));
    expect(r.ok && r.manifest).toMatchObject({ format: 1, description: "", placeholders: [] });
  });
  const bad: [string, string, RegExp][] = [
    ["not JSON", "{", /valid JSON/],
    ["an array", "[]", /object/],
    ["a newer format", manifest({ format: 2 }), /newer ViewSwitcher/],
    ["an id with a slash", manifest({ id: "../x" }), /id should/],
    ["an id starting with _", manifest({ id: "_shared" }), /id should/],
    ["no name", manifest({ name: " " }), /name should/],
    ["no version", manifest({ version: undefined }), /version/],
    ["a bad version", manifest({ version: "latest" }), /version/],
    ["no views", manifest({ views: [] }), /views should list/],
    ["a view with a path", manifest({ views: ["../main"] }), /views:/],
    ["a view twice", manifest({ views: ["main", "main"] }), /twice/],
    ["an unknown placeholder", manifest({ placeholders: ["SECRET"] }), /isn't one ViewSwitcher fills/],
  ];
  for (const [what, text, why] of bad) {
    test(`refuses ${what}`, () => {
      const r = readManifest(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(why);
    });
  }
});

describe("checkPack", () => {
  test("a good pack: views in order, its transition, what it runs", () => {
    const files = planned([...basic, file("_shared/transition.html")]);
    const r = checkPack(files, texts({ "_shared/transition.html": "<html><body></body></html>" }));
    if (!r.ok) throw new Error(r.error);
    expect(r.views).toEqual([{ name: "main", file: "templates/main.html" }, { name: "brb", file: "templates/brb.html" }]);
    expect(r.transition).toBe("_shared/transition.html");
    expect(r.scripts).toEqual({ files: ["_shared/scene.js"], inline: [], remote: [] });
    expect(r.warnings).toEqual([]);
  });

  test("reports inline code and scripts from other sites", () => {
    const r = checkPack(planned(basic), texts({
      "templates/main.html": `<html><body><button onclick="x()">x</button></body></html>`,
      "templates/brb.html": `<html><body><script>fetch('/api/onair', {method:'POST'})</script><script src="https://cdn.example/x.js"></script></body></html>`,
    }));
    expect(r.ok && r.scripts).toEqual({ files: ["_shared/scene.js"], inline: ["templates/main.html", "templates/brb.html"], remote: ["https://cdn.example/x.js"] });
  });

  test("an SVG with a script or handler counts as code (a view can frame it)", () => {
    const r = checkPack(planned([...basic, file("assets/x.svg")]), texts({ "assets/x.svg": `<svg onload="fetch('/api')"/>`, "_shared/brand/mark.svg": "<svg><script>x()</script></svg>" }));
    expect(r.ok && r.scripts.inline).toEqual(["_shared/brand/mark.svg", "assets/x.svg"]);
  });

  test("an SVG that only loads a script (href or xlink:href) is code, and the script is listed", () => {
    const r = checkPack(planned([...basic, file("assets/x.svg")]), texts({ "assets/x.svg": `<svg><script href="https://cdn.example/a.js"/><script xlink:href="https://cdn.example/b.js"></script></svg>` }));
    expect(r.ok && r.scripts.inline).toEqual(["assets/x.svg"]);
    expect(r.ok && r.scripts.remote).toEqual(["https://cdn.example/a.js", "https://cdn.example/b.js"]);
  });

  test("javascript: links count as code", () => {
    const r = checkPack(planned(basic), texts({ "templates/main.html": `<a href=" JavaScript:alert(1)">x</a>` }));
    expect(r.ok && r.scripts.inline).toEqual(["templates/main.html"]);
  });

  test("a listed view that's missing is refused", () => {
    const r = checkPack(planned(basic.filter((e) => e.path !== "templates/brb.html")), texts());
    expect(r).toEqual({ ok: false, error: `pack.json lists the view "brb", but templates/brb.html isn't in the pack` });
  });

  test("an unlisted view installs after the listed ones, with a warning", () => {
    const r = checkPack(planned([...basic, file("templates/extra.html")]), texts({ "templates/extra.html": VIEW }));
    expect(r.ok && r.views.map((v) => v.name)).toEqual(["main", "brb", "extra"]);
    expect(r.ok && r.warnings[0]).toMatch(/doesn't list "extra"/);
  });

  test("an unlisted view with a bad name is refused", () => {
    const r = checkPack(planned([...basic, file("templates/My View.html")]), texts());
    expect(r.ok).toBe(false);
  });

  test("warns about placeholders it doesn't fill or that aren't declared, and links to missing files", () => {
    const r = checkPack(planned(basic), texts({ "templates/brb.html": `<h1>{{HOST}} {{ACCENT}}</h1><img src="{{PACK}}/assets/missing.png"><a href="{{PACK}}/main.html">` }));
    expect(r.ok && r.warnings).toEqual([
      "{{HOST}} isn't a placeholder ViewSwitcher fills, so it stays as typed",
      "pack.json doesn't list {{ACCENT}} in placeholders (filled anyway)",
      "Links to files that aren't in the pack: templates/brb.html → {{PACK}}/assets/missing.png",
    ]);
  });
});

test("installed paths: views move up out of templates/", () => {
  expect(installedPath("templates/main.html")).toBe("main.html");
  expect(installedPath("_shared/theme.css")).toBe("_shared/theme.css");
  expect(installedPath("pack.json")).toBe("pack.json");
});

test("fillPlaceholders fills known ones and leaves the rest", () => {
  expect(fillPlaceholders("{{ORG_NAME}} {{PACK}}/x {{HOST}}", { ORG_NAME: "Daisy", PACK: "/library/daisy/templates/neon" })).toBe("Daisy /library/daisy/templates/neon/x {{HOST}}");
});
