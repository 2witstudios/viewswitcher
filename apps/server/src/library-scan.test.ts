// LibraryScanner against a temp library: what it lists, and that a change is always picked up on the
// next scan by the same scanner (titles are kept between scans while a file stays the same).
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { titledCopy } from "./library";
import { LibraryScanner } from "./library/scanner";

/** One scanner per test, as the server has one: its title cache carries from scan to scan. */
let scanner: LibraryScanner;

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const ORG = "show";
let root: string;
const put = async (rel: string, text: string) => {
  await mkdir(join(root, rel, ".."), { recursive: true });
  await writeFile(join(root, rel), text);
};
const view = (title: string) => `<!doctype html><title>${title}</title><body>${title}</body>`;
/** One modification time for a file, before and after a same-size save, as a coarse-time drive can leave it. */
const SAME_TIME = 1_700_000_000;
const keepTime = (rel: string) => utimes(join(root, rel), SAME_TIME, SAME_TIME);
const labels = async () => {
  const l = await scanner.scan(ORG);
  return l.projects.flatMap((p) => [...p.scenes, ...p.streams.flatMap((s) => s.scenes)].map((s) => `${s.path.split("/").slice(2).join("/")}=${s.label}`));
};

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "vs-scan-"));
  roots.push(root);
  scanner = new LibraryScanner(root, { concurrency: 4 });
  await put(`${ORG}/org.json`, JSON.stringify({ name: "Show" }));
  await put(`${ORG}/templates/title.html`, view("Title"));
  await put(`${ORG}/projects/p/project.json`, JSON.stringify({ name: "Weekly", order: ["intro", "brb"] }));
  await put(`${ORG}/projects/p/scenes/brb.html`, view("Be right back"));
  await put(`${ORG}/projects/p/scenes/intro.html`, view("Intro"));
  await put(`${ORG}/projects/p/streams/b/stream.json`, JSON.stringify({ name: "Second", date: "2026-02-01" }));
  await put(`${ORG}/projects/p/streams/a/stream.json`, JSON.stringify({ name: "First", date: "2026-01-01" }));
  await put(`${ORG}/projects/p/streams/a/brb.html`, view("BRB, week one"));
});

describe("LibraryScanner", () => {
  test("lists projects, streams and views in their order", async () => {
    const l = await scanner.scan(ORG);
    expect(l.templates.map((t) => t.label)).toEqual(["Title"]);
    const [p] = l.projects;
    expect(p!.name).toBe("Weekly");
    expect(p!.scenes.map((s) => s.name)).toEqual(["intro", "brb"]);
    expect(p!.streams.map((s) => s.name)).toEqual(["First", "Second"]);
    expect(p!.streams[0]!.scenes).toEqual([{ name: "brb", label: "BRB, week one", path: `${ORG}/projects/p/streams/a/brb.html`, origin: "stream" }]);
  });

  test("a title changed between scans is the new one on the next scan", async () => {
    await scanner.scan(ORG);
    await put(`${ORG}/projects/p/scenes/intro.html`, view("Opening titles"));
    expect(await labels()).toContain("p/scenes/intro.html=Opening titles");
  });

  // The title cache's own tests (scene-titles.test.ts) take each part of the stamp, and the watcher's
  // reports, one at a time; this is the whole of it on a real disk.
  test("a same-size save in the same instant that replaced the file is read again, even if the watcher missed it", async () => {
    await keepTime(`${ORG}/projects/p/scenes/intro.html`);
    await scanner.scan(ORG);
    // An editor's atomic save: a new file renamed over the old one (a new inode), same size and time.
    await writeFile(join(root, ORG, "projects/p/scenes/intro.tmp"), view("Outro"));
    await keepTime(`${ORG}/projects/p/scenes/intro.tmp`);
    await rename(join(root, ORG, "projects/p/scenes/intro.tmp"), join(root, ORG, "projects/p/scenes/intro.html"));
    expect(await labels()).toContain("p/scenes/intro.html=Outro");
  });

  test("an asset that can't be read (gone since the listing, a broken link) leaves the rest listed", async () => {
    await put(`${ORG}/assets/logo.png`, "png");
    await symlink(join(root, "nowhere.png"), join(root, ORG, "assets/broken.png"));
    expect((await scanner.scan(ORG)).assets.map((a) => a.name)).toEqual(["logo.png"]);
  });

  test("files added and deleted between scans come and go", async () => {
    await scanner.scan(ORG);
    await rm(join(root, ORG, "projects/p/scenes/brb.html"));
    await put(`${ORG}/projects/p/streams/b/end.html`, view("The end"));
    const now = await labels();
    expect(now).not.toContain("p/scenes/brb.html=Be right back");
    expect(now).toContain("p/streams/b/end.html=The end");
  });

  test("a library with many more files than are read at once, scanned by several clients together", async () => {
    for (let s = 0; s < 40; s++) {
      await put(`${ORG}/projects/p/streams/s${s}/stream.json`, JSON.stringify({ name: `S${s}`, date: `2026-03-${String(s + 1).padStart(2, "0")}` }));
      for (const v of ["a", "b", "c", "d", "e"]) await put(`${ORG}/projects/p/streams/s${s}/${v}.html`, view(`${v} ${s}`));
    }
    const scans = await Promise.all([1, 2, 3, 4].map(() => scanner.scan(ORG)));
    for (const l of scans) {
      expect(l.projects[0]!.streams).toHaveLength(42);
      expect(l.projects[0]!.streams.find((s) => s.id === "s39")!.scenes.map((v) => v.label)).toEqual(["a 39", "b 39", "c 39", "d 39", "e 39"]);
    }
  });
});

describe("titledCopy (Duplicate)", () => {
  test("adds \" copy\" to the title, decoded and escaped again", () => {
    expect(titledCopy("<head><title>R&amp;B night</title></head>")).toBe("<head><title>R&amp;B night copy</title></head>");
  });
  test("a title near the limit is shortened to fit, never refused", () => {
    const out = titledCopy(`<head><title>${"x".repeat(120)}</title></head>`);
    expect(out).toBe(`<head><title>${"x".repeat(115)} copy</title></head>`);
  });
  test("an emoji at the cut is kept whole", () => {
    expect(titledCopy(`<head><title>${"x".repeat(113)}🎸🎸</title></head>`)).toBe(`<head><title>${"x".repeat(113)}🎸 copy</title></head>`);
    expect(titledCopy(`<head><title>${"x".repeat(114)}🎸</title></head>`)).toBe(`<head><title>${"x".repeat(114)} copy</title></head>`); // the emoji won't fit whole
  });
  test("a page without a title, or with an empty one, is copied as it is", () => {
    expect(titledCopy("<main></main>")).toBe("<main></main>");
    expect(titledCopy("<head><title> </title></head>")).toBe("<head><title> </title></head>");
  });
});
