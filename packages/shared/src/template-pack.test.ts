// The template pack format's validator.
import { describe, expect, test } from "bun:test";
import { checkPack, fillPlaceholders, installedPath, isTextFile, PACK_LIMITS, type PackEntry, placeholdersIn, placeholderVars, planPack, readManifest } from "./template-pack";

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

  test("a show's name or initial in a script, a style, an on… attribute or a .js file is a warning", () => {
    const r = checkPack(planned(basic), texts({
      "templates/main.html": `<html><head><style>.n::after { content: "{{ORG_NAME}}" }</style></head><body><h1>{{ORG_NAME}}</h1><button onclick="say('{{ORG_INITIAL}}')">x</button><p style="--n: '{{ORG_NAME}}'">y</p><script>const show = "{{ORG_NAME}}";</script></body></html>`,
      "_shared/scene.js": `document.title = "{{ORG_NAME}}";`,
    }));
    if (!r.ok) throw new Error(r.error);
    const w = r.warnings.find((x) => x.includes("in a script, a style, or an on… or style attribute"));
    expect(w).toBeDefined();
    expect(w).toStartWith("{{ORG_NAME}}, {{ORG_INITIAL}} are in a script");
    for (const where of ["templates/main.html <style>", "templates/main.html onclick", "templates/main.html style", "templates/main.html <script>", "_shared/scene.js"]) expect(w).toContain(where);
    expect(w).toContain("Keep placeholders in text and attributes");
    // A .css file counts outside its comments: the starter names the show in one, where it's safe.
    const css = checkPack(planned(basic), texts({ "_shared/theme.css": `/* {{ORG_NAME}} theme */ .n::after { content: "{{ORG_NAME}}" }` }));
    expect(css.ok && css.warnings.find((x) => x.includes("in a script"))).toContain("_shared/theme.css");
    // A "/*" inside a CSS string doesn't open a comment that would hide what follows.
    const quoted = checkPack(planned(basic), texts({ "_shared/theme.css": `.a::before { content: "/*" } .n::after { content: "{{ORG_NAME}}" } /* end */` }));
    expect(quoted.ok && quoted.warnings.find((x) => x.includes("in a script"))).toContain("_shared/theme.css");
    // An unclosed string ends at its line, as CSS ends it: a later comment stays a comment.
    const unclosed = checkPack(planned(basic), texts({ "_shared/theme.css": `.a { content: "x }\n/* {{ORG_NAME}} */\n.b { content: "y" }` }));
    expect(unclosed.ok && unclosed.warnings.filter((x) => x.includes("in a script"))).toEqual([]);
    // A backslash-newline continues a CSS string: what follows on the next line is still in it.
    const continued = checkPack(planned(basic), texts({ "_shared/theme.css": `.a { content: "x\\\n/* {{ORG_NAME}} */" }` }));
    expect(continued.ok && continued.warnings.find((x) => x.includes("in a script"))).toContain("_shared/theme.css");
    // A view's <style> follows the same rule: a comment there is safe, its code isn't.
    const styled = checkPack(planned(basic), texts({ "templates/main.html": `<html><head><style>/* {{ORG_NAME}} */ .a { color: red }</style></head><body></body></html>` }));
    expect(styled.ok && styled.warnings.filter((x) => x.includes("in a script"))).toEqual([]);
  });

  test("placeholders in text and attributes, and colors, ids and {{PACK}} in code, warn nothing", () => {
    const r = checkPack(planned(basic), texts({
      "templates/main.html": `<html><head><style>:root { --accent: {{ACCENT}}; --ground: {{GROUND}} }</style><div style="color: {{ACCENT}}"></div></head><body><h1 title="{{ORG_NAME}}">{{ORG_NAME}}</h1><img alt="{{ORG_INITIAL}}" src="{{PACK}}/_shared/x.png" onerror="this.src='{{PACK}}/_shared/y.png'"><script>const org = "{{ORG_ID}}";</script></body></html>`,
      "_shared/scene.js": `fetch("{{PACK}}/_shared/data.json");`,
      "_shared/theme.css": `/* {{ORG_NAME}}, made for the show */ :root { --accent: {{ACCENT}} }`,
    }));
    expect(r.ok && r.warnings.filter((x) => x.includes("in a script"))).toEqual([]);
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
  expect(fillPlaceholders("theme.css", "{{ORG_NAME}} {{PACK}}/x {{HOST}}", { ORG_NAME: "Daisy", PACK: "/library/daisy/templates/neon" })).toBe("Daisy /library/daisy/templates/neon/x {{HOST}}");
});

test("fillPlaceholders escapes values for the file they land in", () => {
  const vars = { ORG_NAME: `R&B <Live> "Club"`, ORG_INITIAL: "<" };
  expect(fillPlaceholders("templates/brb.html", "<h1 title=\"{{ORG_NAME}}\">{{ORG_NAME}}</h1>", vars)).toBe("<h1 title=\"R&amp;B &lt;Live&gt; &quot;Club&quot;\">R&amp;B &lt;Live&gt; &quot;Club&quot;</h1>");
  expect(fillPlaceholders("_shared/mark.svg", "<text>{{ORG_INITIAL}}</text>", vars)).toBe("<text>&lt;</text>");
  expect(fillPlaceholders("brb.html", "<img alt='{{ORG_NAME}}'>", { ORG_NAME: "O'Brien' onerror='x" })).toBe("<img alt='O&#39;Brien&#39; onerror=&#39;x'>"); // single quotes too
  expect(fillPlaceholders("TEMPLATES/BRB.HTML", "{{ORG_INITIAL}}", vars)).toBe("&lt;");
  const json = fillPlaceholders("org.json", '{ "name": "{{ORG_NAME}}" }', vars);
  expect(JSON.parse(json).name).toBe(vars.ORG_NAME);
  expect(fillPlaceholders("BRAND.md", "# {{ORG_NAME}}", vars)).toBe(`# ${vars.ORG_NAME}`);
  expect(fillPlaceholders("_shared/theme.css", "/* {{ORG_NAME}} */", vars)).toBe(`/* ${vars.ORG_NAME} */`);
  // A name can't close the CSS comment it's in and swallow the next rule.
  expect(fillPlaceholders("_shared/theme.css", "/* {{ORG_NAME}} */ :root { --x: 1 }", { ORG_NAME: "A*/B" })).toBe("/* A* /B */ :root { --x: 1 }");
  expect(fillPlaceholders("dir.html/notes", "{{ORG_NAME}}", { ORG_NAME: "<b>" })).toBe("<b>"); // not an .html file
});

test("isTextFile: the library's text files, by extension in any case", () => {
  for (const p of ["a.html", "t/A.HTML", "x.css", "x.js", "org.json", "BRAND.md", "n.txt", "m.svg"]) expect(isTextFile(p)).toBe(true);
  for (const p of ["a.png", "a.woff2", "html", "dir.html/file", ".html.png", "a"]) expect(isTextFile(p)).toBe(false);
});

test("placeholdersIn names each placeholder once, known or not, and only upper-case ones", () => {
  const text = "{{ORG_NAME}} {{PACK}}/x {{ORG_NAME}} {{HOST}} {{lower}} {ORG_ID}";
  expect(placeholdersIn(text)).toEqual(["ORG_NAME", "PACK", "HOST"]);
  expect(placeholdersIn(text)).toEqual(["ORG_NAME", "PACK", "HOST"]); // the same again: no state between calls
});

test("placeholderVars: the org's values, its initial upper-case, {{PACK}} only for a set", () => {
  const org = { id: "rb", name: "  r&b night ", accent: "#f00", ground: "#000" };
  expect(placeholderVars(org)).toEqual({ ORG_ID: "rb", ORG_NAME: "r&b night", ORG_INITIAL: "R", ACCENT: "#f00", GROUND: "#000" });
  expect(placeholderVars(org, "/library/rb/templates/neon").PACK).toBe("/library/rb/templates/neon");
  expect(placeholderVars({ ...org, name: " " }).ORG_INITIAL).toBe("?");
  expect(placeholderVars({ ...org, name: "🎸 Band" }).ORG_INITIAL).toBe("🎸");
  expect(placeholderVars({ ...org, name: "🇺🇸 Club" }).ORG_INITIAL).toBe("🇺🇸");
  expect(placeholderVars({ ...org, name: "👍🏽 crew" }).ORG_INITIAL).toBe("👍🏽");
});
