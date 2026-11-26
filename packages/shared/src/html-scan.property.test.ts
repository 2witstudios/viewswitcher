// html-scan against random and odd HTML: scanning never throws, tagging round-trips byte for byte,
// and an edit changes only the element it's for. Every byte outside that element's edited range
// stays identical, which is what lets the editor write a view back without touching the rest.
// The pages are generated from a fixed seed, so a failure names the page that caused it and
// reproduces every time.
import { describe, expect, test } from "bun:test";
import { applyEdits, EditError, readTitle, scanElements, setTitle, tagForEdit, untagForEdit } from "./html-scan";

/** A small seeded PRNG (mulberry32): the same pages on every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T,>(xs: readonly T[]): T => xs[int(xs.length)]!;
  return { next, int, pick };
}

const TAGS = ["div", "p", "span", "h1", "b", "i", "a", "section", "main", "li", "ul", "img", "br", "hr", "input", "svg", "path", "script", "style", "title", "template", "textarea", "noscript", "iframe", "x-box", "style-box"] as const;
const TEXT = ["Hello", "R&amp;B", "a < b", "x > y", "&nbsp;", " ", "emoji 🎸", "🇺🇸", "  spaced  ", "\n", "&#x1F600;", "&bogus;", "'quote'", '"dq"', "", "tab\there", "</", "<", ">", "=", "/"] as const;
const ATTRS = ['class="abs panel"', "class=x", 'style="left: 10px; top: 20px; width: 300px; height: 100px"', "style='left:1px;top:2px'", 'data-slot="Camera"', "hidden", 'title="a>b"', "data-x='<title>'", 'src="/library/o/assets/a.png"', "id=a b=c", "a=", '="x"', 'style="top: -5px; left: 0"'] as const;
const JUNK = ["<!-- c -->", "<!-- <title>t</title> -->", "<!--", "-->", "<!x>", "<?pi?>", "<![CDATA[x]]>", "</div>", "</p >", "</x <y>>", "<", "<<", "<div", "<p class=", "&", "&amp", "\u0000", "�", "<br/>", "<img/>", "<span/>"] as const;

/** One random page: nested elements, text, attributes, and malformed bits, often cut short. */
function page(seed: number): string {
  const r = rng(seed);
  const out: string[] = [];
  const open: string[] = [];
  const steps = 5 + r.int(60);
  for (let i = 0; i < steps; i++) {
    const roll = r.next();
    if (roll < 0.35) {
      const tag = r.pick(TAGS);
      const attrs = Array.from({ length: r.int(3) }, () => " " + r.pick(ATTRS)).join("");
      out.push(`<${tag}${attrs}${r.next() < 0.05 ? "/" : ""}>`);
      if (!["img", "br", "hr", "input"].includes(tag)) open.push(tag);
    } else if (roll < 0.6) {
      out.push(r.pick(TEXT));
    } else if (roll < 0.8 && open.length) {
      out.push(`</${r.next() < 0.9 ? open.pop()! : r.pick(TAGS)}>`);
    } else {
      out.push(r.pick(JUNK));
    }
  }
  // Close most of what's open, but not always: real pages and cut-off downloads end in the middle.
  if (r.next() < 0.8) while (open.length) out.push(`</${open.pop()}>`);
  let html = out.join("");
  if (r.next() < 0.15) html = html.slice(0, r.int(html.length + 1));
  return r.next() < 0.5 ? `<!doctype html><html><head><title>T${seed}</title></head><body>${html}</body></html>` : html;
}

const PAGES = Array.from({ length: 600 }, (_, i) => [i, page(i + 1)] as const);

/** The edit applied, or null when html-scan refuses it as it should (EditError), never another error. */
function tryEdit(html: string, edit: Parameters<typeof applyEdits>[1][number]): string | null {
  try {
    return applyEdits(html, [edit]);
  } catch (e) {
    if (e instanceof EditError) return null;
    throw e;
  }
}

describe("html-scan on random and odd HTML", () => {
  test.each(PAGES)("page %d: scanning never throws, and every element's ranges are in order and in the page", (_i, html) => {
    const els = scanElements(html);
    for (const e of els) {
      expect(0 <= e.start && e.start < e.openEnd && e.openEnd <= html.length).toBe(true);
      expect(e.openEnd <= e.innerStart || e.innerStart === e.innerEnd).toBe(true);
      expect(e.innerStart <= e.innerEnd && e.innerEnd <= e.end && e.end <= html.length).toBe(true);
      if (e.parent !== null) expect(e.parent).toBeLessThan(e.id);
    }
  });

  test.each(PAGES)("page %d: tagging for the editor round-trips byte for byte", (_i, html) => {
    expect(untagForEdit(tagForEdit(html, "h"))).toBe(html);
  });

  test.each(PAGES)("page %d: a text edit changes only its element's content", (_i, html) => {
    for (const e of scanElements(html).filter((x) => x.leaf)) {
      const out = tryEdit(html, { id: e.id, text: "New text & <more>" });
      if (out === null) continue;
      expect(out.slice(0, e.innerStart)).toBe(html.slice(0, e.innerStart));
      expect(out.slice(out.length - (html.length - e.innerEnd))).toBe(html.slice(e.innerEnd));
    }
  });

  test.each(PAGES)("page %d: a move or a resize changes only its element's start tag", (_i, html) => {
    for (const e of scanElements(html)) {
      for (const edit of [{ id: e.id, left: 12, top: 34 }, { id: e.id, width: 56, height: 78 }]) {
        const out = tryEdit(html, edit);
        if (out === null) continue;
        expect(out.slice(0, e.start)).toBe(html.slice(0, e.start));
        expect(out.slice(out.length - (html.length - e.openEnd))).toBe(html.slice(e.openEnd));
      }
    }
  });

  test.each(PAGES)("page %d: a removal takes out only its element", (_i, html) => {
    for (const e of scanElements(html)) {
      const out = tryEdit(html, { id: e.id, remove: true });
      if (out === null) continue;
      // Whitespace right around the element may go with it; nothing before or after that does.
      const before = html.slice(0, e.start).replace(/[ \t\n\r]*$/, "");
      const after = html.slice(e.end).replace(/^[ \t\n\r]*/, "");
      expect(out.startsWith(before)).toBe(true);
      expect(out.endsWith(after)).toBe(true);
    }
  });

  test.each(PAGES)("page %d: the title readTitle finds is the one setTitle writes", (_i, html) => {
    let next: string;
    try {
      next = setTitle(html, "Renamed");
    } catch (e) {
      if (e instanceof EditError) return; // no <head> to put one in: nothing to compare
      throw e;
    }
    expect(readTitle(next)).toBe("Renamed");
  });
});
