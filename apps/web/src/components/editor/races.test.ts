// The editor's races: overlapping loads, a picture that finishes uploading after the scene changed,
// and the frame's ids after an add or delete.
import { describe, expect, test } from "bun:test";
import { applyEdits, idsAfter, scanElements, tagForEdit, toBase } from "@viewswitcher/shared";
import type { SceneBase } from "@viewswitcher/shared";
import { idBaseline, idsMatch } from "./frame-dom";
import { newestOnly } from "./newest";
import { imageNow } from "./usePictureDrop";

const deferred = <T,>() => {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
};

describe("overlapping loads", () => {
  test("the newest wins even when an older one answers last, and both callers get it", async () => {
    const reads = [deferred<string>(), deferred<string>()];
    const shown: string[] = [];
    let n = 0;
    const load = newestOnly(async (isNewest) => {
      const v = await reads[n++]!.promise;
      if (isNewest()) shown.push(v);
      return v;
    });
    const first = load();
    const second = load();
    reads[1]!.resolve("new");
    reads[0]!.resolve("old");
    expect(await first).toBe("new");
    expect(await second).toBe("new");
    expect(shown).toEqual(["new"]);
  });

  test("an older load that fails doesn't fail its caller once a newer one is under way", async () => {
    const reads = [deferred<string>(), deferred<string>()];
    let n = 0;
    const load = newestOnly(async () => reads[n++]!.promise);
    const first = load();
    const second = load();
    reads[0]!.reject(new Error("offline"));
    reads[1]!.resolve("new");
    expect(await first).toBe("new");
    expect(await second).toBe("new");
  });

  test("the newest one's failure is its own", async () => {
    const load = newestOnly(async () => {
      throw new Error("gone");
    });
    await expect(load()).rejects.toThrow("gone");
  });
});

const html = `<head><meta charset="utf-8"></head><main>
  <img src="/library/daisy/assets/logo.png" style="left: 0px; top: 0px">
  <p style="left: 0px; top: 100px">Title</p>
  <img src="/library/daisy/assets/photo.png" style="left: 0px; top: 200px">
</main>`;
const v1 = toBase({ html, hash: "1" });
const imgs = (b: SceneBase) => b.els.filter((e) => e.tag === "img").map((e) => e.id);
const [logo, photo] = imgs(v1) as [number, number];
const NEW = "/library/daisy/assets/new.png";
const made = { gen: 1, layout: 1, base: v1 };

describe("a picture that lands after the scene changed", () => {
  test("goes to the image it was dropped on while no ids have changed", () => {
    expect(imageNow(made, { base: v1, layout: 1 }, photo, NEW)).toEqual({ id: photo, src: NEW });
  });

  test("follows that image when an add or delete renumbered the scene", () => {
    // The logo was deleted meanwhile: the photo's id is one less now.
    const after = applyEdits(html, [{ id: logo, remove: true }]);
    const v2 = { source: after, hash: "2", els: scanElements(after) };
    const moved = idsAfter(html, { id: logo, remove: true }).map(photo)!;
    expect(moved).not.toBe(photo);
    expect(imageNow(made, { base: v2, layout: 2 }, photo, NEW)).toEqual({ id: moved, src: NEW });
    // Its old id now names nothing (or something else): never used as it was.
    expect(imageNow(made, { base: v2, layout: 2 }, photo, NEW)?.id).not.toBe(photo);
  });

  test("is refused when that image is gone from the new version", () => {
    const after = applyEdits(html, [{ id: photo, remove: true }]);
    const v2 = { source: after, hash: "2", els: scanElements(after) };
    expect(imageNow(made, { base: v2, layout: 2 }, photo, NEW)).toBeNull();
  });

  test("is refused when the new version has two images it could be", () => {
    const twin = html.replace("photo.png", "logo.png").replace("top: 200px", "top: 0px");
    const v0 = toBase({ html: twin, hash: "0" });
    const v2 = toBase({ html: twin.replace("Title", "New title"), hash: "2" });
    expect(imageNow({ gen: 1, layout: 1, base: v0 }, { base: v2, layout: 2 }, imgs(v0)[0]!, NEW)).toBeNull();
  });
});

// A stand-in for the frame's document: just what the id check reads.
// ?inert serves <meta> as <link data-vs-meta>, as the server does.
const fakeDoc = (nodes: { id: number; tag: string }[]) =>
  ({ querySelectorAll: () => nodes.map((n) => (n.tag === "meta" ? { dataset: { vs: String(n.id), vsMeta: "" }, tagName: "LINK" } : { dataset: { vs: String(n.id) }, tagName: n.tag.toUpperCase() })) }) as unknown as Document;
const shown = (b: SceneBase, skip: (tag: string) => boolean = () => false) => b.els.filter((e) => !skip(e.tag)).map((e) => ({ id: e.id, tag: e.tag }));

describe("the frame's ids after an add or delete", () => {
  const scene = toBase({ html: tagForEdit(html, "1"), hash: "1" });

  test("match when the frame shows every element of the saved file, each once with its tag", () => {
    const baseline = idBaseline(fakeDoc(shown(scene)), scene);
    // A <meta> served as <link data-vs-meta> is still a meta: the tags are checked.
    expect(baseline.tags).toBe(true);
    const after = applyEdits(scene.source, [{ id: scene.els[0]!.id, insert: "<p>New</p>" }]);
    const saved = { source: after, hash: "2", els: scanElements(after) };
    expect(idsMatch(fakeDoc(shown(saved)), saved, baseline)).toBe(true);
  });

  test("don't match when one is missing, doubled, or names another tag", () => {
    const baseline = idBaseline(fakeDoc(shown(scene)), scene);
    const all = shown(scene);
    expect(idsMatch(fakeDoc(all.slice(1)), scene, baseline)).toBe(false);
    expect(idsMatch(fakeDoc([...all.slice(1), all[1]!]), scene, baseline)).toBe(false);
    expect(idsMatch(fakeDoc(all.map((n) => (n.tag === "p" ? { ...n, tag: "span" } : n))), scene, baseline)).toBe(false);
    expect(idsMatch(fakeDoc([...all, { id: 99, tag: "p" }]), scene, baseline)).toBe(false);
  });

  test("elements the browser never shows (a template's content) don't count against the check", () => {
    const withTemplate = toBase({ html: `<main><template><p>Hidden</p></template><p style="left: 0px; top: 0px">Shown</p></main>`, hash: "t" });
    const visible = shown(withTemplate).filter((n) => !(n.tag === "p" && n.id === 2));
    const baseline = idBaseline(fakeDoc(visible), withTemplate);
    expect(baseline.absent).toBe(1);
    expect(idsMatch(fakeDoc(visible), withTemplate, baseline)).toBe(true);
    expect(idsMatch(fakeDoc(visible.slice(1)), withTemplate, baseline)).toBe(false);
  });
});
