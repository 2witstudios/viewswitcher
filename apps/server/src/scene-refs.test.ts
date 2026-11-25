import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadedFiles, resolveRef, sceneRefs } from "./scene-refs";

const scene = "daisy/projects/ld/streams/12-04-x/teaching.html";

describe("resolveRef: like a browser at /library/<file>", () => {
  const rows: [string, string | null][] = [
    ["/library/daisy/assets/logo.svg", "daisy/assets/logo.svg"],
    ["logo.svg", "daisy/projects/ld/streams/12-04-x/logo.svg"],
    ["./img/a.png?v=2#x", "daisy/projects/ld/streams/12-04-x/img/a.png"],
    ["../../../../assets/bg.mp4", "daisy/assets/bg.mp4"],
    ["/library/daisy/assets/my%20logo.png", "daisy/assets/my logo.png"],
    ["http://127.0.0.1:7420/library/daisy/assets/a.png", "daisy/assets/a.png"],
    ["http://localhost:7433/library/daisy/assets/a.png", "daisy/assets/a.png"],
    ["//127.0.0.1:7420/library/daisy/assets/a.png", "daisy/assets/a.png"],
    ["/library/daisy/templates/_shared/theme.css?x=1&amp;y=2", "daisy/templates/_shared/theme.css"],
    // Not library files.
    ["https://fonts.example/a.woff2", null],
    ["https://cdn.example/library/daisy/x.png", null],
    ["/program", null],
    ["/assets/index.js", null],
    ["data:image/png;base64,AAAA", null],
    ["blob:http://127.0.0.1:7420/1", null],
    ["javascript:void 0", null],
    ["#frag", null],
    ["", null],
    ["/library/daisy/assets/", null],
    ["../../../../../../../etc/passwd", null],
  ];
  test.each(rows)("%s → %p", (ref, out) => {
    expect(resolveRef(ref, scene)).toBe(out);
  });
});

describe("sceneRefs", () => {
  test("a scene's tags, srcset, inline CSS and style attributes", () => {
    const html = `<!doctype html><html><head>
      <link rel="stylesheet" href="/library/daisy/templates/_shared/theme.css">
      <link rel=icon href=fav.png>
      <style>@import "/library/daisy/assets/extra.css"; .bg { background: url('/library/daisy/assets/bg.jpg') } .f { src: url(font.woff2) }</style>
      <script src='/library/daisy/templates/_shared/scene.js'></script>
    </head><body>
      <img src="/library/daisy/assets/logo.svg" srcset="/library/daisy/assets/logo@2x.png 2x, logo@3x.png 3x" alt="">
      <video poster="/library/daisy/assets/poster.jpg" autoplay muted loop><source src="/library/daisy/assets/loop.mp4" type="video/mp4"></video>
      <audio src="../../../../assets/bed.mp3"></audio>
      <div style="background-image:url(&quot;x&quot;)"></div>
      <a href="/library/daisy/other.html">not loaded</a>
      <img src="https://example.com/x.png"><img src="data:image/gif;base64,R0lG">
    </body></html>`;
    expect(sceneRefs(html, scene).sort()).toEqual([
      "daisy/assets/bed.mp3",
      "daisy/assets/bg.jpg",
      "daisy/assets/extra.css",
      "daisy/assets/logo.svg",
      "daisy/assets/logo@2x.png",
      "daisy/assets/loop.mp4",
      "daisy/assets/poster.jpg",
      "daisy/projects/ld/streams/12-04-x/fav.png",
      "daisy/projects/ld/streams/12-04-x/font.woff2",
      "daisy/projects/ld/streams/12-04-x/logo@3x.png",
      "daisy/projects/ld/streams/12-04-x/x",
      "daisy/templates/_shared/scene.js",
      "daisy/templates/_shared/theme.css",
    ]);
  });
  test("a stylesheet's url() and @import resolve from the stylesheet", () => {
    const css = `@import 'fonts.css'; @font-face { src: url("brand/Font.woff2") } .x { background: url(../../assets/tex.png) }`;
    expect(sceneRefs(css, "daisy/templates/_shared/theme.css").sort()).toEqual([
      "daisy/assets/tex.png",
      "daisy/templates/_shared/brand/Font.woff2",
      "daisy/templates/_shared/fonts.css",
    ]);
  });
  test("a page's own tags only in HTML; a stylesheet never self-lists", () => {
    expect(sceneRefs(`<img src="a.png">`, "daisy/notes.md")).toEqual([]);
    expect(sceneRefs(`.x{background:url(theme.css)}`, "daisy/templates/_shared/theme.css")).toEqual([]);
  });
});

describe("loadedFiles", () => {
  const root = mkdtempSync(join(tmpdir(), "vs-refs-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const put = (p: string, text: string) => {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  };
  test("follows stylesheets (and pages they frame) to their pictures and fonts, once each", async () => {
    put(scene, `<link rel="stylesheet" href="/library/daisy/templates/_shared/theme.css"><img src="/library/daisy/assets/logo.svg"><img src="/library/daisy/assets/missing.png">`);
    put("daisy/templates/_shared/theme.css", `@import "more.css"; .a{background:url(brand/mark.svg)}`);
    put("daisy/templates/_shared/more.css", `.b{background:url(theme.css)} .c{background:url(/library/daisy/assets/tex.png)}`);
    put("daisy/assets/logo.svg", `<svg><image href="x.png"/></svg>`);
    expect((await loadedFiles(root, [scene])).sort()).toEqual([
      "daisy/assets/logo.svg",
      "daisy/assets/missing.png",
      "daisy/assets/tex.png",
      "daisy/templates/_shared/brand/mark.svg",
      "daisy/templates/_shared/more.css",
      "daisy/templates/_shared/theme.css",
    ]);
  });
  test("a scene that can't be read loads nothing; the limit holds", async () => {
    expect(await loadedFiles(root, ["daisy/nope.html", "../outside.html"])).toEqual([]);
    put("daisy/many.html", Array.from({ length: 50 }, (_, i) => `<img src="${i}.png">`).join(""));
    expect((await loadedFiles(root, ["daisy/many.html"], 10)).length).toBe(10);
  });
});
