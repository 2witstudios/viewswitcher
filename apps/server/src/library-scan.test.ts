// LibraryScanner against a temp library: what it lists, and that a change is always picked up on the
// next scan by the same scanner (titles are kept between scans while a file stays the same).
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, realpath, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { titledCopy } from "./library";
import { LibraryScanner, readNoFollow } from "./library/scanner";

/**
 * One scanner per test, as the server has one: its title cache carries from scan to scan. It keeps
 * no finished scans (keepMs 0), so each scan reads the disk; "a finished scan, kept" tests those.
 */
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
  const l = await scanner.scanOrg(ORG);
  return l.projects.flatMap((p) => [...p.scenes, ...p.streams.flatMap((s) => s.scenes)].map((s) => `${s.path.split("/").slice(2).join("/")}=${s.label}`));
};

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "vs-scan-"));
  roots.push(root);
  scanner = new LibraryScanner(root, { concurrency: 4, keepMs: 0 });
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
    const l = await scanner.scanOrg(ORG);
    expect(l.templates.map((t) => t.label)).toEqual(["Title"]);
    const [p] = l.projects;
    expect(p!.name).toBe("Weekly");
    expect(p!.scenes.map((s) => s.name)).toEqual(["intro", "brb"]);
    expect(p!.streams.map((s) => s.name)).toEqual(["First", "Second"]);
    expect(p!.streams[0]!.scenes).toEqual([{ name: "brb", label: "BRB, week one", path: `${ORG}/projects/p/streams/a/brb.html`, origin: "stream" }]);
  });

  test("a title changed between scans is the new one on the next scan", async () => {
    await scanner.scanOrg(ORG);
    await put(`${ORG}/projects/p/scenes/intro.html`, view("Opening titles"));
    expect(await labels()).toContain("p/scenes/intro.html=Opening titles");
  });

  // The title cache's own tests (scene-titles.test.ts) take each part of the stamp, and the watcher's
  // reports, one at a time; this is the whole of it on a real disk.
  test("a same-size save in the same instant that replaced the file is read again, even if the watcher missed it", async () => {
    await keepTime(`${ORG}/projects/p/scenes/intro.html`);
    await scanner.scanOrg(ORG);
    // An editor's atomic save: a new file renamed over the old one (a new inode), same size and time.
    await writeFile(join(root, ORG, "projects/p/scenes/intro.tmp"), view("Outro"));
    await keepTime(`${ORG}/projects/p/scenes/intro.tmp`);
    await rename(join(root, ORG, "projects/p/scenes/intro.tmp"), join(root, ORG, "projects/p/scenes/intro.html"));
    expect(await labels()).toContain("p/scenes/intro.html=Outro");
  });

  test("an asset that can't be read (gone since the listing, a broken link) leaves the rest listed", async () => {
    await put(`${ORG}/assets/logo.png`, "png");
    await symlink(join(root, "nowhere.png"), join(root, ORG, "assets/broken.png"));
    expect((await scanner.scanOrg(ORG)).assets.map((a) => a.name)).toEqual(["logo.png"]);
  });

  test("files added and deleted between scans come and go", async () => {
    await scanner.scanOrg(ORG);
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
    const scans = await Promise.all([1, 2, 3, 4].map(() => scanner.scanOrg(ORG)));
    for (const l of scans) {
      expect(l.projects[0]!.streams).toHaveLength(42);
      expect(l.projects[0]!.streams.find((s) => s.id === "s39")!.scenes.map((v) => v.label)).toEqual(["a 39", "b 39", "c 39", "d 39", "e 39"]);
    }
  });
});

describe("a finished scan, kept", () => {
  let clock = 0;
  let kept: LibraryScanner;
  beforeEach(() => {
    clock = 1_000;
    kept = new LibraryScanner(root, { keepMs: 2_000, now: () => clock });
  });
  const intro = async () => (await kept.scanOrg(ORG)).projects[0]!.scenes.find((s) => s.name === "intro")!.label;

  test("requests together share one scan, and one soon after gets it too", async () => {
    const [a, b] = await Promise.all([kept.scanOrg(ORG), kept.scanOrg(ORG)]);
    expect(a).toBe(b);
    clock += 1_999;
    expect(await kept.scanOrg(ORG)).toBe(a);
  });

  test("a change the watcher reports is read on the next request, for that org only", async () => {
    await put(`other/org.json`, JSON.stringify({ name: "Other" }));
    const other = await kept.scanOrg("other");
    expect(await intro()).toBe("Intro");
    await put(`${ORG}/projects/p/scenes/intro.html`, view("Opening titles"));
    expect(await intro()).toBe("Intro"); // nothing reported it yet
    kept.forget([`${ORG}/projects/p/scenes/intro.html`]);
    expect(await intro()).toBe("Opening titles");
    expect(await kept.scanOrg("other")).toBe(other);
  });

  test("a change the watcher has only seen (touched, before its report) is read on the next request", async () => {
    expect(await intro()).toBe("Intro");
    await put(`${ORG}/projects/p/scenes/intro.tmp`, view("Opening titles"));
    await rename(join(root, ORG, "projects/p/scenes/intro.tmp"), join(root, ORG, "projects/p/scenes/intro.html"));
    kept.touched(`${ORG}/projects/p/scenes/intro.html`);
    expect(await intro()).toBe("Opening titles");
  });

  test("a change by the switcher or an agent (changed) is read on the next request, before the watcher says anything", async () => {
    expect(await intro()).toBe("Intro");
    await put(`${ORG}/projects/p/scenes/intro.html`, view("Opening titles"));
    kept.changed();
    expect(await intro()).toBe("Opening titles");
  });

  test("a scan in flight when a change comes isn't kept for the requests after it", async () => {
    const before = kept.scanOrg(ORG);
    await put(`${ORG}/projects/p/scenes/intro.html`, view("Opening titles"));
    kept.changed();
    const after = kept.scanOrg(ORG);
    expect(after).not.toBe(before);
    await before;
    expect((await after).projects[0]!.scenes.find((s) => s.name === "intro")!.label).toBe("Opening titles");
    expect(await kept.scanOrg(ORG)).toBe(await after);
  });

  test("a change the watcher missed shows once the kept scan is older than keepMs", async () => {
    expect(await intro()).toBe("Intro");
    await put(`${ORG}/projects/p/scenes/intro.html`, view("Opening titles"));
    clock += 2_000;
    expect(await intro()).toBe("Opening titles");
  });

  test("what every request shares can't be changed by one of them", async () => {
    const l = await kept.scanOrg(ORG);
    expect(() => (l.projects as unknown[]).push(1)).toThrow();
    expect(() => ((l.projects[0] as { name: string }).name = "x")).toThrow();
    expect((await kept.scanOrg(ORG)).projects[0]!.name).toBe("Weekly");
  });
});

describe("links out of the library are never read", () => {
  let away: string;
  beforeEach(async () => {
    away = mkdtempSync(join(tmpdir(), "vs-scan-away-"));
    roots.push(away);
    await writeFile(join(away, "secret.html"), view("Outside secret"));
    await writeFile(join(away, "secret.json"), JSON.stringify({ name: "Outside name", date: "2026-09-09", order: ["z"] }));
    await writeFile(join(away, "secret.png"), "outside picture");
    await mkdir(join(away, "folder"), { recursive: true });
    await writeFile(join(away, "folder/inside.html"), view("Outside folder view"));
  });
  const everything = async () => JSON.stringify(await scanner.scanOrg(ORG));

  test("a view that is a link to a file outside is left out, and its title isn't read", async () => {
    await symlink(join(away, "secret.html"), join(root, ORG, "projects/p/scenes/leak.html"));
    await symlink(join(away, "secret.html"), join(root, ORG, "templates/leak.html"));
    const l = await scanner.scanOrg(ORG);
    expect(l.templates.map((t) => t.name)).toEqual(["title"]);
    expect(l.projects[0]!.scenes.map((s) => s.name)).toEqual(["intro", "brb"]);
    expect(await everything()).not.toContain("Outside");
  });

  test("a view that is a link to another view in the library is listed with its title", async () => {
    await symlink(join(root, ORG, "templates/title.html"), join(root, ORG, "projects/p/scenes/again.html"));
    expect(await labels()).toContain("p/scenes/again.html=Title");
  });

  test("folders, JSON files and pictures linked outside are left out too", async () => {
    await symlink(join(away, "folder"), join(root, ORG, "projects/p/streams/a-linked"));
    await rm(join(root, ORG, "projects/p/scenes"), { recursive: true });
    await symlink(join(away, "folder"), join(root, ORG, "projects/p/scenes"));
    await rm(join(root, ORG, "projects/p/streams/b/stream.json"));
    await symlink(join(away, "secret.json"), join(root, ORG, "projects/p/streams/b/stream.json"));
    await put(`${ORG}/assets/logo.png`, "png");
    await symlink(join(away, "secret.png"), join(root, ORG, "assets/leak.png"));
    await mkdir(join(root, ORG, "templates/neon"), { recursive: true });
    await symlink(join(away, "secret.json"), join(root, ORG, "templates/neon/pack.json"));
    await rm(join(root, ORG, "org.json"));
    await symlink(join(away, "secret.json"), join(root, ORG, "org.json"));
    const l = await scanner.scanOrg(ORG);
    expect(l.projects[0]!.scenes).toEqual([]);
    expect(l.projects[0]!.streams.map((s) => `${s.id}=${s.name}`)).toEqual(["a=First", "b=b"]);
    expect(l.assets.map((a) => a.name)).toEqual(["logo.png"]);
    expect(l.sets).toEqual([]);
    expect(l.org.name).toBe(ORG);
    expect(await everything()).not.toContain("Outside");
  });

  test("a title is read only through a path with no link in it: a folder swapped for a link after the check reads as no title", async () => {
    await mkdir(join(away, "real"), { recursive: true });
    await writeFile(join(away, "real/x.html"), view("Outside"));
    await symlink(join(away, "real"), join(away, "swapped"));
    const real = await realpath(join(away, "real/x.html"));
    expect(await readNoFollow(real)).toContain("Outside");
    // A link in a folder of the path is refused on macOS (O_NOFOLLOW_ANY), the product's platform and CI's.
    if (process.platform === "darwin") await expect(readNoFollow(join(await realpath(away), "swapped/x.html"))).rejects.toThrow();
    await symlink(real, join(away, "file-link.html"));
    await expect(readNoFollow(join(await realpath(away), "file-link.html"))).rejects.toThrow();
  });

  test("an org folder that is a link outside the library lists nothing from there", async () => {
    await mkdir(join(away, "org/projects/p/scenes"), { recursive: true });
    await writeFile(join(away, "org/org.json"), JSON.stringify({ name: "Outside org" }));
    await writeFile(join(away, "org/projects/p/scenes/x.html"), view("Outside view"));
    await symlink(join(away, "org"), join(root, "linked"));
    const l = await scanner.scanOrg("linked");
    expect(l.projects).toEqual([]);
    expect(JSON.stringify(l)).not.toContain("Outside");
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
    expect(titledCopy(`<head><title>${"x".repeat(112)}🇺🇸</title></head>`)).toBe(`<head><title>${"x".repeat(112)} copy</title></head>`); // nor a flag (two code points), never half of one
  });
  test("a page without a title, or with an empty one, is copied as it is", () => {
    expect(titledCopy("<main></main>")).toBe("<main></main>");
    expect(titledCopy("<head><title> </title></head>")).toBe("<head><title> </title></head>");
  });
});
