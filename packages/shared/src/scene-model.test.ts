import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  attrIn, describeEdit, isSlot, markFor, movableAround, movableIn, nameOf, posIn, replaceableImage, scanElements, sizeIn, slotsIn, tagForEdit, textOf, titleIn, toBase, valueIn,
} from "./index";

const teaching = readFileSync(join(import.meta.dir, "../../../apps/server/starter/templates/teaching.html"), "utf8")
  .replaceAll("{{ORG_ID}}", "daisy")
  .replaceAll("{{ORG_NAME}}", "Daisy");
const b = toBase({ html: tagForEdit(teaching, "h1"), hash: "h1" });
const byText = (text: string) => b.els.find((e) => e.leaf && textOf(b.source, e) === text)!.id;
const byAttr = (name: string, value: string) => b.els.find((e) => attrIn(b, e.id, name) === value)!.id;
const tag = (t: string) => b.els.find((e) => e.tag === t)!.id;

describe("toBase", () => {
  test("reads the file as it is on disk: the editor's ids and version stamp are gone", () => {
    expect(b.source).toBe(teaching);
    expect(b.hash).toBe("h1");
    expect(b.els.length).toBe(scanElements(teaching).length);
  });
});

describe("reading elements", () => {
  test("position, size and attributes come from the file", () => {
    const camera = byAttr("data-slot", "Camera");
    expect(posIn(b, camera)).toMatchObject({ left: 1528, top: 32 });
    expect(sizeIn(b, camera)).toMatchObject({ width: 360, height: 450 });
    expect(attrIn(b, camera, "class")).toBe("slot");
    expect(attrIn(b, camera, "missing")).toBeNull();
    expect(posIn(b, 9999)).toBeNull();
    expect(sizeIn(b, byText("Notes"))).toBeNull();
  });

  test("boxes with a position move; the page and unpositioned text don't", () => {
    expect(movableIn(b, byAttr("data-slot", "Screen"))).toBe(true);
    expect(movableIn(b, tag("footer"))).toBe(true);
    expect(movableIn(b, tag("body"))).toBe(false);
    expect(movableIn(b, byText("Notes"))).toBe(false);
    expect(movableAround(b, byText("Today's topic"))).toBe(tag("footer"));
    expect(movableAround(b, tag("body"))).toBeNull();
  });

  test("camera boxes, slots and the title", () => {
    expect(isSlot(b, byAttr("data-slot", "Camera"))).toBe(true);
    expect(isSlot(b, tag("footer"))).toBe(false);
    expect(slotsIn(b)).toEqual(["Screen", "Camera"]);
    expect(titleIn(b)).toBe("Teaching");
    expect(titleIn(toBase({ html: "<div>no title</div>", hash: "x" }))).toBeNull();
  });

  test("only a library picture without a srcset can be replaced", () => {
    expect(replaceableImage(b, tag("img"))).toBe(true);
    expect(replaceableImage(b, tag("footer"))).toBe(false);
    const other = toBase({ html: `<img src="https://example.com/a.png"><img src="/library/daisy/assets/a.png" srcset="/library/daisy/assets/a@2x.png 2x">`, hash: "x" });
    expect(replaceableImage(other, 0)).toBe(false);
    expect(replaceableImage(other, 1)).toBe(false);
  });
});

describe("valueIn: what an edit would put back", () => {
  test("text, position, size and picture", () => {
    const topic = byText("Today's topic");
    const camera = byAttr("data-slot", "Camera");
    const img = tag("img");
    expect(valueIn(b, { id: topic, text: "New" })).toEqual({ id: topic, text: "Today's topic" });
    expect(valueIn(b, { id: camera, left: 0, top: 0 })).toEqual({ id: camera, left: 1528, top: 32 });
    expect(valueIn(b, { id: camera, width: 10, height: 10 })).toEqual({ id: camera, width: 360, height: 450 });
    expect(valueIn(b, { id: camera, width: 10, height: 10, left: 5 })).toEqual({ id: camera, width: 360, height: 450, left: 1528 });
    expect(valueIn(b, { id: img, src: "/library/daisy/assets/b.png" })).toEqual({ id: img, src: "/library/daisy/templates/_shared/brand/mark.svg" });
  });

  test("nothing for an edit that doesn't fit the element, or an add or delete", () => {
    expect(valueIn(b, { id: tag("footer"), text: "x" })).toBeNull();
    expect(valueIn(b, { id: tag("footer"), src: "x" })).toBeNull();
    expect(valueIn(b, { id: byText("Notes"), left: 1, top: 1 })).toBeNull();
    expect(valueIn(b, { id: tag("footer"), remove: true })).toBeNull();
    expect(valueIn(b, { id: 9999, left: 1, top: 1 })).toBeNull();
  });
});

describe("names, for menus and the conflict card", () => {
  test("each element by what it is and where it sits", () => {
    expect(nameOf(b, byAttr("data-slot", "Camera"))).toBe("Camera box");
    expect(nameOf(b, tag("footer"))).toBe("Footer");
    expect(nameOf(b, tag("section"))).toBe("Notes panel");
    expect(nameOf(b, byText("Today's topic"))).toBe("Footer title");
    expect(nameOf(b, byText("Key point, link or question for chat."))).toBe("Notes panel text");
    expect(nameOf(b, tag("img"))).toBe("Image");
    expect(nameOf(b, 9999)).toBe("Element");
  });

  test("each change in words", () => {
    const camera = byAttr("data-slot", "Camera");
    expect(describeEdit(b, { id: byText("Today's topic"), text: "Q&A" })).toEqual({ what: "Footer title", value: "Q&A" });
    expect(describeEdit(b, { id: camera, left: 8, top: 16 })).toEqual({ what: "Camera box", value: "x 8 · y 16" });
    expect(describeEdit(b, { id: camera, width: 640, height: 360 })).toEqual({ what: "Camera box", value: "640 × 360" });
    expect(describeEdit(b, { id: camera, remove: true })).toEqual({ what: "Camera box", value: "deleted" });
    expect(describeEdit(b, { id: tag("main"), insert: "<p>x</p>" })).toEqual({ what: "Scene", value: "something you added" });
    expect(describeEdit(b, { id: tag("img"), src: "x" })).toEqual({ what: "Image", value: "a new picture" });
  });

  test("a change is marked on the text or box, not the page around it", () => {
    expect(markFor(b, byText("Notes"))).toBe(byText("Notes"));
    expect(markFor(b, tag("section"))).toBe(tag("section"));
    expect(markFor(b, tag("body"))).toBeNull();
  });
});
