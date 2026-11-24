import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyEdits, changedElements, decodeEntities, positionOf, retarget, scanElements, setPosition, setText, snapMove, tagForEdit, textOf, untagForEdit,
} from "./index";

const starter = join(import.meta.dir, "../../../apps/server/starter/templates");
const starterFiles = [
  ...readdirSync(starter).filter((f) => f.endsWith(".html")).map((f) => join(starter, f)),
  ...readdirSync(join(starter, "_shared")).filter((f) => f.endsWith(".html")).map((f) => join(starter, "_shared", f)),
];

/** Every byte outside [from, to) of `a` is the same in `b`, around a replacement. */
function onlyChanged(a: string, b: string, from: number, to: number) {
  const tail = a.length - to;
  expect(b.slice(0, from)).toBe(a.slice(0, from));
  expect(b.slice(b.length - tail)).toBe(a.slice(to));
}

const el = (html: string, tag: string, nth = 0) => scanElements(html).filter((e) => e.tag === tag)[nth]!;

describe("scanElements", () => {
  test("lists elements in source order with exact ranges", () => {
    const html = `<div class="a"><h1>Hi</h1><p>One <b>two</b></p></div>`;
    const els = scanElements(html);
    expect(els.map((e) => e.tag)).toEqual(["div", "h1", "p", "b"]);
    const [div, h1, p, b] = els;
    expect(html.slice(div!.start, div!.openEnd)).toBe(`<div class="a">`);
    expect(html.slice(div!.start, div!.end)).toBe(html);
    expect(html.slice(h1!.innerStart, h1!.innerEnd)).toBe("Hi");
    expect(html.slice(p!.start, p!.end)).toBe("<p>One <b>two</b></p>");
    expect([h1!.leaf, p!.leaf, b!.leaf, div!.leaf]).toEqual([true, false, true, false]);
    expect(b!.parent).toBe(p!.id);
    expect(els.map((e) => e.id)).toEqual([0, 1, 2, 3]);
  });

  test("void tags have no content and don't swallow their siblings", () => {
    const html = `<div><img src="a.png" alt=""><br><span>x</span><input value=1></div>`;
    const els = scanElements(html);
    expect(els.map((e) => [e.tag, e.parent])).toEqual([["div", null], ["img", 0], ["br", 0], ["span", 0], ["input", 0]]);
    expect(els[1]!.innerStart).toBe(els[1]!.innerEnd);
    expect(els[3]!.leaf).toBe(true);
  });

  test("comments are skipped, and an element with one isn't plain text", () => {
    const html = `<!-- <p>not me</p> --><p>a<!-- note -->b</p><h2>ok</h2>`;
    const els = scanElements(html);
    expect(els.map((e) => e.tag)).toEqual(["p", "h2"]);
    expect(els[0]!.leaf).toBe(false);
    expect(els[1]!.leaf).toBe(true);
  });

  test("quoted attributes may hold > and quotes of the other kind", () => {
    const html = `<a title="a > b" data-x='say "hi"' href=/x>link</a><span>after</span>`;
    const [a, span] = scanElements(html);
    expect(html.slice(a!.start, a!.openEnd)).toBe(`<a title="a > b" data-x='say "hi"' href=/x>`);
    expect(a!.attrs.map((x) => [x.name, html.slice(x.valueStart, x.valueEnd)])).toEqual([["title", "a > b"], ["data-x", 'say "hi"'], ["href", "/x"]]);
    expect(textOf(html, a!)).toBe("link");
    expect(span!.tag).toBe("span");
  });

  test("script and style content is raw text, even when it looks like tags", () => {
    const html = `<style>a > b { content: "<p>" }</style><script>if (a < b) document.write("<div>")</script><p>real</p>`;
    const els = scanElements(html);
    expect(els.map((e) => e.tag)).toEqual(["style", "script", "p"]);
    expect(html.slice(els[1]!.innerStart, els[1]!.innerEnd)).toBe(`if (a < b) document.write("<div>")`);
    expect(els[0]!.leaf || els[1]!.leaf).toBe(false);
  });

  test("doctype, self-closed SVG children, stray < and unclosed elements", () => {
    const html = `<!doctype html><svg viewBox="0 0 2 2"><path d="M0 0"/><circle r="1" /></svg><p>1 < 2</p><div><span>open`;
    const els = scanElements(html);
    expect(els.map((e) => [e.tag, e.parent])).toEqual([["svg", null], ["path", 0], ["circle", 0], ["p", null], ["div", null], ["span", 4]]);
    expect(els[3]!.leaf).toBe(true);
    expect(els[5]!.leaf).toBe(false); // never closed: not safe to retype
    expect(els[5]!.innerEnd).toBe(html.length);
  });

  test("a mismatched end tag closes what it skipped", () => {
    const html = `<div><p>one<span>two</div><h2>x</h2>`;
    const els = scanElements(html);
    expect(els.map((e) => [e.tag, e.parent])).toEqual([["div", null], ["p", 0], ["span", 1], ["h2", null]]);
    expect(els[0]!.closed).toBe(true);
    expect(els[1]!.closed).toBe(false);
  });

  test("empty elements and whitespace-only content aren't editable text", () => {
    const [a, b] = scanElements(`<span class="dot"></span><p>   </p>`);
    expect([a!.leaf, b!.leaf]).toEqual([false, false]);
  });

  test.each(starterFiles)("starter %s: ranges are consistent and tags round-trip", (file) => {
    const html = readFileSync(file, "utf8");
    const els = scanElements(html);
    expect(els.length).toBeGreaterThan(3);
    for (const e of els) {
      expect(html[e.start]).toBe("<");
      expect(html.slice(e.start + 1, e.start + 1 + e.tag.length).toLowerCase()).toBe(e.tag);
      expect(html[e.openEnd - 1]).toBe(">");
      expect(e.start < e.openEnd && e.openEnd <= e.innerStart && e.innerStart <= e.innerEnd && e.innerEnd <= e.end).toBe(true);
      expect(e.closed).toBe(true); // the starter kit is well-formed
      if (e.parent !== null) {
        const p = els[e.parent]!;
        expect(p.innerStart <= e.start && e.end <= p.innerEnd).toBe(true);
      }
      if (e.leaf) expect(html.slice(e.innerStart, e.innerEnd)).not.toContain("<");
    }
    // Tagging adds exactly one data-vs per element and nothing else.
    const tagged = tagForEdit(html);
    expect(tagged.replace(/ data-vs="\d+"/g, "")).toBe(html);
    expect(untagForEdit(tagged)).toBe(html);
    expect(scanElements(tagged).map((e) => e.tag)).toEqual(els.map((e) => e.tag));
    expect(scanElements(tagged).map((e) => e.leaf)).toEqual(els.map((e) => e.leaf));
  });

  test("starter teaching: finds the editable text and the movable boxes", () => {
    const html = readFileSync(join(starter, "teaching.html"), "utf8");
    const els = scanElements(html);
    const texts = els.filter((e) => e.leaf).map((e) => textOf(html, e));
    expect(texts).toEqual(["Notes", "Key point, link or question for chat.", "{{ORG_NAME}}", "Today's topic"]);
    const movable = els.filter((e) => positionOf(html, e)).map((e) => [e.tag, positionOf(html, e)!.left, positionOf(html, e)!.top]);
    expect(movable).toEqual([["div", 32, 32], ["div", 1528, 32], ["section", 1528, 506], ["footer", 32, 884]]);
  });
});

describe("text and entities", () => {
  test("decodes the references scenes use", () => {
    expect(decodeEntities("Q&amp;A &mdash; it&#39;s &#x2019; &nbsp;&bogus;")).toBe("Q&A — it's ’  &bogus;");
  });
  test("textOf collapses whitespace like the browser", () => {
    const html = `<p>\n    Two\n    lines  </p>`;
    expect(textOf(html, scanElements(html)[0]!)).toBe("Two lines");
  });
});

describe("edits (EDIT-2)", () => {
  const teaching = readFileSync(join(starter, "teaching.html"), "utf8");
  const title = scanElements(teaching).find((e) => e.leaf && textOf(teaching, e) === "Today's topic")!;
  const notes = el(teaching, "section");

  test("setText changes only the element's text", () => {
    const next = setText(teaching, title.id, "Romans 8: No condemnation");
    onlyChanged(teaching, next, title.innerStart, title.innerEnd);
    expect(next.slice(title.innerStart, title.innerStart + 25)).toBe("Romans 8: No condemnation");
    expect(next.split("\n").filter((l, i) => l !== teaching.split("\n")[i]).length).toBe(1);
  });

  test("setText escapes markup, keeps indentation and leaves an unchanged text alone", () => {
    const html = `<p>\n  Old &amp; tired\n</p>`;
    const p = scanElements(html)[0]!;
    expect(setText(html, p.id, "Old & tired")).toBe(html);
    expect(setText(html, p.id, "<b>new</b> & bold")).toBe(`<p>\n  &lt;b&gt;new&lt;/b&gt; &amp; bold\n</p>`);
    expect(setText(html, p.id, "two\nlines")).toBe(`<p>\n  two lines\n</p>`);
  });

  test("setText refuses an element that isn't plain text", () => {
    expect(() => setText(teaching, notes.id, "x")).toThrow();
    expect(() => setText(teaching, 9999, "x")).toThrow();
  });

  test("setPosition changes only the left and top numbers", () => {
    const next = setPosition(teaching, notes.id, 32, 408);
    const pos = positionOf(teaching, notes)!;
    // Same text before left's number, between left and top, and after top's number.
    expect(next.slice(0, pos.leftAt[0])).toBe(teaching.slice(0, pos.leftAt[0]));
    const mid = teaching.slice(pos.leftAt[1], pos.topAt[0]);
    expect(next.slice(pos.leftAt[0], pos.leftAt[0] + 2 + mid.length)).toBe(`32${mid}`);
    expect(next.slice(next.length - (teaching.length - pos.topAt[1]))).toBe(teaching.slice(pos.topAt[1]));
    expect(next).toContain(`style="left: 32px; top: 408px; width: 360px; height: 354px;`);
    const changed = next.split("\n").filter((l, i) => l !== teaching.split("\n")[i]);
    expect(changed).toHaveLength(1);
  });

  test("setPosition finds left/top anywhere in the style, not padding-left", () => {
    const html = `<div style="padding-left: 4px; width: 10px; top:7px;left :-3.5px"></div>`;
    const d = scanElements(html)[0]!;
    expect(positionOf(html, d)).toMatchObject({ left: -3.5, top: 7 });
    expect(setPosition(html, d.id, 10.4, 20)).toBe(`<div style="padding-left: 4px; width: 10px; top:20px;left :10.4px"></div>`);
    expect(positionOf(`<div style="left: 10%; top: 3px"></div>`, scanElements(`<div style="left: 10%; top: 3px"></div>`)[0]!)).toBeNull();
    expect(() => setPosition(`<p>x</p>`, 0, 1, 1)).toThrow();
  });

  test("several edits apply against the same base, from the end backwards", () => {
    const camera = scanElements(teaching).find((e) => e.attrs.some((a) => a.name === "data-slot" && teaching.slice(a.valueStart, a.valueEnd) === "Camera"))!;
    const next = applyEdits(teaching, [{ id: camera.id, left: 40, top: 48 }, { id: title.id, text: "New" }, { id: notes.id, left: 1, top: 2 }]);
    expect(next).toContain(`data-slot="Camera" style="left: 40px; top: 48px;`);
    expect(next).toContain(`>New</h2>`);
    expect(next).toContain(`style="left: 1px; top: 2px; width: 360px`);
    expect(next.split("\n").filter((l, i) => l !== teaching.split("\n")[i])).toHaveLength(3);
    expect(() => applyEdits(teaching, [{ id: title.id, text: "a" }, { id: title.id, text: "b" }])).toThrow();
  });

  test("edits through tagged ids land on the same element of the untagged file", () => {
    const tagged = tagForEdit(teaching);
    const id = Number(/data-vs="(\d+)"[^>]*>Today's topic/.exec(tagged)![1]);
    expect(id).toBe(title.id);
  });
});

describe("conflicts (EDIT-8)", () => {
  const base = `<main><section style="left: 1px; top: 2px"><span>Notes</span><p>Old note</p></section><h2>Title</h2></main>`;
  const theirs = `<main><section style="left: 1px; top: 2px"><span>Notes</span><p>Their note</p></section><h2>Title</h2><p>Added</p></main>`;

  test("changedElements marks what someone else changed", () => {
    const ids = changedElements(base, theirs);
    const els = scanElements(theirs);
    expect(ids.map((i) => textOf(theirs, els[i]!))).toEqual(["Their note", "Added"]);
    expect(changedElements(base, base)).toEqual([]);
  });

  test("retarget finds the same element by tag and position after the file moved", () => {
    const moved = `<main><!-- agent added --><div>new</div><section style="left: 1px; top: 2px"><span>Notes</span><p>Their note</p></section><h2>Title</h2></main>`;
    const h2 = scanElements(base).find((e) => e.tag === "h2")!;
    const r = retarget(base, moved, { id: h2.id, text: "Mine" })!;
    expect(scanElements(moved)[r.id]!.tag).toBe("h2");
    expect(setText(moved, r.id, "Mine")).toContain("<h2>Mine</h2>");
    const section = scanElements(base).find((e) => e.tag === "section")!;
    const s = retarget(base, moved, { id: section.id, left: 5, top: 6 })!;
    expect(scanElements(moved)[s.id]!.tag).toBe("section");
    expect(retarget(base, `<main></main>`, { id: h2.id, text: "x" })).toBeNull();
  });
});

describe("snapMove", () => {
  const others = [{ x: 32, y: 32, w: 1472, h: 828 }];
  test("snaps an edge to a nearby edge and reports a guide", () => {
    const s = snapMove({ x: 37, y: 400, w: 360, h: 450 }, others);
    expect(s.x).toBe(32);
    expect(s.guides.x).toContain(32);
  });
  test("falls back to the 8 px grid", () => {
    const s = snapMove({ x: 611, y: 397, w: 100, h: 100 }, []);
    expect([s.x, s.y]).toEqual([608, 400]);
    expect(s.guides).toEqual({ x: [], y: [] });
  });
  test("snaps to the frame's center and far edge", () => {
    const s = snapMove({ x: 905, y: 1000 - 76, w: 100, h: 150 }, []);
    expect(s.x).toBe(910); // center 960
    expect(s.y).toBe(930); // bottom 1080
  });
});

describe("untagForEdit", () => {
  test("removes only the ids tagging added, even when the text mentions data-vs", () => {
    const html = `<p title=' data-vs="7"'>about data-vs="1"</p><img src=x>`;
    const tagged = tagForEdit(html);
    expect(tagged).toBe(`<p data-vs="0" title=' data-vs="7"'>about data-vs="1"</p><img data-vs="1" src=x>`);
    expect(untagForEdit(tagged)).toBe(html);
  });
});

describe("version stamp (PR #1 architecture #1, #2)", () => {
  test("tagForEdit stamps the hash on <html> only, and untagForEdit removes it", () => {
    const html = `<!doctype html><html lang="en"><body><p>x</p></body></html>`;
    const tagged = tagForEdit(html, "abc123");
    expect(tagged).toBe(`<!doctype html><html data-vs="0" data-vs-hash="abc123" lang="en"><body data-vs="1"><p data-vs="2">x</p></body></html>`);
    expect(untagForEdit(tagged)).toBe(html);
    expect(tagForEdit(`<p>x</p>`, "abc")).toBe(`<p data-vs="0">x</p>`);
    expect(tagForEdit(html, `"><script>`)).toContain(`data-vs-hash="script"`);
  });
});

describe("CodeRabbit findings on PR #1", () => {
  const pos = (style: string) => {
    const html = `<div style="${style}"></div>`;
    return positionOf(html, scanElements(html)[0]!);
  };
  test("positionOf ignores left/top inside quoted values and comments", () => {
    expect(pos(`left:10px;top:20px;--caption:'a;left:90px;'`)).toMatchObject({ left: 10, top: 20 });
    expect(pos(`left:10px;/* left:99px; */top:20px`)).toMatchObject({ left: 10, top: 20 });
    const html = `<div style="left:10px;top:20px;--caption:'a;left:90px;'"></div>`;
    expect(setPosition(html, 0, 5, 6)).toBe(`<div style="left:5px;top:6px;--caption:'a;left:90px;'"></div>`);
  });
  test("positionOf patches the declaration that wins (!important, else the last)", () => {
    const html = `<div style="left:10px!important;left:20px;top:30px"></div>`;
    expect(positionOf(html, scanElements(html)[0]!)).toMatchObject({ left: 10, top: 30 });
    expect(setPosition(html, 0, 1, 2)).toBe(`<div style="left:1px!important;left:20px;top:2px"></div>`);
    expect(pos(`left:10px;left:20px;top:0px`)).toMatchObject({ left: 20 });
    expect(pos(`left:10px;left:50%;top:0px`)).toBeNull(); // the winning value isn't px
    expect(pos(`left:10px !important;left:50%;top:0px`)).toMatchObject({ left: 10 });
  });
  test("<xmp> and friends are raw text: nothing inside is tagged", () => {
    const html = `<xmp><b>example</b></xmp><p>x</p>`;
    expect(scanElements(html).map((e) => e.tag)).toEqual(["xmp", "p"]);
    expect(untagForEdit(tagForEdit(html))).toBe(html);
  });
  test("text can't be saved empty", () => {
    expect(() => setText(`<p>x</p>`, 0, "   ")).toThrow();
  });
  test("changedElements notices text swapped between two panels", () => {
    const a = `<div id="a"><p>A</p></div><div id="b"><p>B</p></div>`;
    const b = `<div id="a"><p>B</p></div><div id="b"><p>A</p></div>`;
    expect(changedElements(a, b).length).toBe(2);
    expect(changedElements(a, a)).toEqual([]);
  });
  test("retarget never replays onto a guess", () => {
    const prev = `<p>Title</p><p>Notes</p>`;
    const next = `<p>Intro</p><p>Title</p><p>Notes</p>`;
    const r = retarget(prev, next, { id: 1, text: "Mine" })!;
    expect(textOf(next, scanElements(next)[r.id]!)).toBe("Notes");
    // The agent changed that very text, and other <p>s look the same: can't tell which.
    expect(retarget(prev, `<p>Intro</p><p>Title</p><p>Agenda</p>`, { id: 1, text: "Mine" })).toBeNull();
  });
});

describe("/code-review findings on PR #1", () => {
  test("named entities decode (case-sensitive), so an unchanged text is left alone", () => {
    expect(decodeEntities("caf&eacute; &Eacute;t&eacute; 10&nbsp;AM &euro;5 &yuml;")).toBe("café Été 10 AM €5 ÿ");
    const html = `<p>Caf&eacute; at 10&nbsp;AM</p>`;
    expect(setText(html, 0, "Café at 10 AM")).toBe(html);
    // A real change keeps the non-breaking space as &nbsp;.
    expect(setText(html, 0, "Tea at 10 AM")).toBe(`<p>Tea at 10&nbsp;AM</p>`);
  });
});
