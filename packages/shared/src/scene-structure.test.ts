// EDIT-16 · EDIT-17 · EDIT-18 · EDIT-19: adding, deleting and resizing elements, swapping an image and
// renaming, each as a source patch that leaves every other byte of the file identical.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyEdits, canRemove, checkInsert, idsAfter, insertElement, markupFor, removeElement, restoreFor, retarget, scanElements, sceneRoot, setSize, setTitle, sizeOf, freeSlotName,
} from "./index";
import type { AddKind } from "./index";

const starter = join(import.meta.dir, "../../../apps/server/starter/templates");
const templates = readdirSync(starter).filter((f) => f.endsWith(".html")).map((f) => ({ name: f, html: readFileSync(join(starter, f), "utf8") }));
const KINDS: AddKind[] = ["text", "title", "image", "camera", "screen", "guest"];
const add = (kind: AddKind, slots: string[] = []) => markupFor(kind, { slots, image: { src: "/library/org/assets/logo.png", width: 800, height: 400 } });

/** `b` is `a` with exactly `inserted` put in at one place. */
function onlyInserted(a: string, b: string, inserted: string) {
  expect(b.length).toBe(a.length + inserted.length);
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  // The insertion point may be ambiguous (repeated characters): somewhere at or before the first difference.
  const at = b.indexOf(inserted, Math.max(0, i - inserted.length));
  expect(at).toBeGreaterThanOrEqual(0);
  expect(b.slice(0, at) + b.slice(at + inserted.length)).toBe(a);
}

describe("insertElement (EDIT-16)", () => {
  for (const t of templates) {
    test(`${t.name}: every kind goes in as one element at the end of the scene, and nothing else changes`, () => {
      const root = sceneRoot(t.html)!;
      expect(scanElements(t.html)[root]!.tag).toBe("main");
      for (const kind of KINDS) {
        const markup = add(kind);
        expect(checkInsert(markup)).toBeNull();
        const next = insertElement(t.html, root, markup);
        onlyInserted(t.html, next, `\n  ${markup}`);
        // On a line of its own, indented like the scene's other children, just before </main>.
        expect(next).toContain(`\n  ${markup}\n</main>`);
        const { added, map } = idsAfter(t.html, { id: root, insert: markup });
        const els = scanElements(next);
        expect(next.slice(els[added!]!.start, els[added!]!.end)).toBe(markup);
        // Every element that was there is the same element after, by its id map.
        for (const e of scanElements(t.html)) expect(next.slice(els[map(e.id)!]!.start, els[map(e.id)!]!.end).replace(`\n  ${markup}`, "")).toBe(t.html.slice(e.start, e.end));
        // Undo: removing it gives back the file byte for byte.
        expect(removeElement(next, added!)).toBe(t.html);
      }
    });
  }

  test("inserts before a given child, and into an empty element", () => {
    const html = `<main class="scene">\n  <p>a</p>\n  <p>b</p>\n</main>`;
    const b = scanElements(html).filter((e) => e.tag === "p")[1]!;
    expect(insertElement(html, 0, "<i>x</i>", b.id)).toBe(`<main class="scene">\n  <p>a</p>\n  <i>x</i>\n  <p>b</p>\n</main>`);
    expect(insertElement(`<main class="scene"></main>`, 0, "<i>x</i>")).toBe(`<main class="scene"><i>x</i></main>`);
    expect(insertElement(`<main class="scene">\n</main>`, 0, "<i>x</i>")).toBe(`<main class="scene">\n  <i>x</i>\n</main>`);
    expect(() => insertElement(html, 1, "<i>x</i>", 0)).toThrow(); // `before` must be a child of `into`
  });

  test("refuses anything but one plain element", () => {
    for (const bad of ["", " <p>x</p>", "<p>x</p><p>y</p>", "text", "<script>alert(1)</script>", `<div onclick="x()"></div>`,
      `<a href="javascript:alert(1)">x</a>`, `<a href="java&#115;cript:x">x</a>`, `<a href="javascript&colon;alert(1)">x</a>`, `<a href="java&Tab;script:alert(1)">x</a>`,
      `<a href="java&NewLine;script:x">x</a>`, `<img src="https://evil.example/x.png">`, `<img src="/library/o/a.png" srcset="https://evil.example/x.png 2x">`,
      `<div style="background: url(https://evil.example/x.png)"></div>`, `<video poster="//evil.example/x.png"></video>`, `<img src="/library/../x.png">`, `<div><iframe src="x"></iframe></div>`, "<p>x", `<img src="data:text/html,x">`, "<!-- x --><p></p>", "<svg><script/></svg>"]) {
      expect(checkInsert(bad)).not.toBeNull();
      expect(() => insertElement(`<main class="scene"></main>`, 0, bad)).toThrow();
    }
    expect(() => insertElement(`<img src="a"><main></main>`, 0, "<p>x</p>")).toThrow(); // nothing goes inside an img
  });

  test("the scene root is .scene, else <body>", () => {
    expect(sceneRoot(`<body><div class="a scene b"></div></body>`)).toBe(1);
    expect(sceneRoot(`<html><body><p>x</p></body></html>`)).toBe(1);
    expect(sceneRoot(`<p>x</p>`)).toBeNull();
  });

  test("a second camera box asks for Camera 2", () => {
    expect(freeSlotName("Camera", ["Screen", "Camera"])).toBe("Camera 2");
    expect(freeSlotName("Camera", ["Camera", "Camera 2"])).toBe("Camera 3");
    expect(add("camera", ["Camera"])).toContain(`data-slot="Camera 2"`);
    expect(add("guest")).toContain(`data-slot="Guest"`);
  });

  test("new elements sit in the middle of the 1920×1080 scene, with inline px boxes", () => {
    for (const kind of KINDS) {
      const html = `<main class="scene">\n${add(kind)}\n</main>`;
      const el = scanElements(html)[1]!;
      const s = sizeOf(html, el)!;
      const m = /left: (\d+)px; top: (\d+)px/.exec(add(kind))!;
      expect(Number(m[1]) + s.width / 2).toBeCloseTo(960, -1);
      expect(Number(m[2]) + s.height / 2).toBeCloseTo(540, -1);
    }
    expect(add("image")).toContain("width: 600px; height: 300px"); // keeps the picture's shape
  });

  test("a conflicting insert goes into the new version's scene root", () => {
    const prev = `<main class="scene">\n  <p>a</p>\n</main>`;
    const next = `<header></header><main class="scene">\n  <p>b</p>\n</main>`;
    expect(retarget(prev, next, { id: 0, insert: "<i>x</i>" })).toEqual({ id: 1, insert: "<i>x</i>" });
  });
});

describe("removeElement (EDIT-17)", () => {
  for (const t of templates) {
    test(`${t.name}: each element removes cleanly and its restore puts back the same bytes`, () => {
      const els = scanElements(t.html);
      let tried = 0;
      for (const el of els) {
        if (el.parent === null || ["html", "head", "body"].includes(el.tag) || !el.closed) continue;
        // The editor deletes only what it could put back (everything in the scene itself; not <meta> or <script>).
        const inScene = el.start > scanElements(t.html)[sceneRoot(t.html)!]!.start && el.end <= scanElements(t.html)[sceneRoot(t.html)!]!.end;
        if (!inScene || !canRemove(t.html, el.id)) continue;
        tried++;
        const next = removeElement(t.html, el.id);
        expect(t.html.length - next.length).toBeGreaterThanOrEqual(el.end - el.start);
        // Only that element (and the line break and indentation it sat on) went.
        let i = 0;
        while (next[i] === t.html[i]) i++;
        expect(t.html.slice(0, i) + t.html.slice(i + (t.html.length - next.length))).toBe(next);
        const back = restoreFor(t.html, el.id);
        expect(applyEdits(next, [back])).toBe(t.html);
        const { map } = idsAfter(t.html, { id: el.id, remove: true });
        expect(map(el.id)).toBeNull();
        const after = scanElements(next);
        for (const e of els) {
          const m = map(e.id);
          if (m !== null) expect(after[m]!.tag).toBe(e.tag);
        }
      }
      // Every box and panel in the scene can go (only a few bits of inline text can't).
      const boxes = els.filter((e) => e.parent === sceneRoot(t.html));
      expect(boxes.every((e) => canRemove(t.html, e.id))).toBe(true);
      expect(tried).toBeGreaterThan(0);
    });
  }

  test("canRemove refuses what Undo couldn't put back exactly", () => {
    const html = `<main class="scene">\n  <span class="chip"><span class="dot"></span>LIVE</span>\n  <div><script>x()</script></div>\n</main>`;
    const els = scanElements(html);
    expect(canRemove(html, 1)).toBe(true);
    expect(canRemove(html, 2)).toBe(false); // text after it, nowhere to put it back
    expect(canRemove(html, 3)).toBe(false); // holds a script
    expect(canRemove(html, 0)).toBe(false); // the scene itself
    expect(els.length).toBe(5);
  });

  test("refuses the page itself", () => {
    const html = `<html><body><main class="scene"></main></body></html>`;
    expect(() => removeElement(html, 0)).toThrow();
    expect(() => removeElement(html, 1)).toThrow();
    expect(removeElement(html, 2)).toBe(`<html><body></body></html>`);
  });
});

describe("setSize (EDIT-17)", () => {
  const teaching = templates.find((t) => t.name === "teaching.html")!.html;
  const camera = scanElements(teaching).find((e) => teaching.slice(e.start, e.openEnd).includes(`data-slot="Camera"`))!;
  test("changes only width and height (and left/top from another corner)", () => {
    const next = setSize(teaching, camera.id, 480, 270);
    expect(next).toContain(`data-slot="Camera" style="left: 1528px; top: 32px; width: 480px; height: 270px"`);
    expect(next.split("\n").filter((l, i) => l !== teaching.split("\n")[i])).toHaveLength(1);
    const moved = setSize(teaching, camera.id, 480, 270, { left: 1400, top: 40 });
    expect(moved).toContain(`data-slot="Camera" style="left: 1400px; top: 40px; width: 480px; height: 270px"`);
    expect(moved.split("\n").filter((l, i) => l !== teaching.split("\n")[i])).toHaveLength(1);
  });
  test("refuses an element without px width and height, or a size below 1", () => {
    expect(() => setSize(`<div style="width: 50%; height: 10px"></div>`, 0, 10, 10)).toThrow();
    expect(() => setSize(teaching, camera.id, 0, 10)).toThrow();
  });
});

describe("image src (EDIT-18)", () => {
  test("replaces only the src value", () => {
    const html = `<img class="abs" src="/library/o/assets/a.png" alt="" style="left: 1px">`;
    expect(applyEdits(html, [{ id: 0, src: "/library/o/assets/b%20c.png" }])).toBe(`<img class="abs" src="/library/o/assets/b%20c.png" alt="" style="left: 1px">`);
    for (const bad of [`x" onerror="y`, "javascript:alert(1)", "a b.png", "data:text/html,x", "https://evil.example/x.png", "/library/../x.png"]) expect(() => applyEdits(html, [{ id: 0, src: bad }])).toThrow();
    expect(checkInsert(`<div style="background: url('/library/o/assets/a.png')"></div>`)).toBeNull();
    expect(() => applyEdits(`<p>x</p>`, [{ id: 0, src: "a.png" }])).toThrow();
  });
});

describe("setTitle (EDIT-19)", () => {
  test("sets the <title> text, or adds one at the top of <head>", () => {
    expect(setTitle(`<head>\n<title>Old</title>\n</head>`, "New & <b>")).toBe(`<head>\n<title>New &amp; &lt;b&gt;</title>\n</head>`);
    expect(setTitle(`<head>\n<meta charset="utf-8">\n</head>`, "Hi")).toBe(`<head>\n<title>Hi</title>\n<meta charset="utf-8">\n</head>`);
    expect(() => setTitle(`<title>x</title>`, "  ")).toThrow();
  });
});
