// scanLibrary against a temp library: what it lists, and that a change is always picked up on the
// next scan (titles are kept between scans while a file stays the same).
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forgetScanned, scanLibrary } from "./library";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const ORG = "show";
let root: string;
const put = async (rel: string, text: string) => {
  await mkdir(join(root, rel, ".."), { recursive: true });
  await writeFile(join(root, rel), text);
};
const view = (title: string) => `<!doctype html><title>${title}</title><body>${title}</body>`;
/** One modification time for a file, before and after a same-size save, as a fast save can leave it. */
const SAME_TIME = 1_700_000_000;
const keepTime = (rel: string) => utimes(join(root, rel), SAME_TIME, SAME_TIME);
const putKeepingTime = async (rel: string, text: string) => {
  await writeFile(join(root, rel), text);
  await keepTime(rel);
};
const labels = async () => {
  const l = await scanLibrary(root, ORG);
  return l.projects.flatMap((p) => [...p.scenes, ...p.streams.flatMap((s) => s.scenes)].map((s) => `${s.path.split("/").slice(2).join("/")}=${s.label}`));
};

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "vs-scan-"));
  roots.push(root);
  await put(`${ORG}/org.json`, JSON.stringify({ name: "Show" }));
  await put(`${ORG}/templates/title.html`, view("Title"));
  await put(`${ORG}/projects/p/project.json`, JSON.stringify({ name: "Weekly", order: ["intro", "brb"] }));
  await put(`${ORG}/projects/p/scenes/brb.html`, view("Be right back"));
  await put(`${ORG}/projects/p/scenes/intro.html`, view("Intro"));
  await put(`${ORG}/projects/p/streams/b/stream.json`, JSON.stringify({ name: "Second", date: "2026-02-01" }));
  await put(`${ORG}/projects/p/streams/a/stream.json`, JSON.stringify({ name: "First", date: "2026-01-01" }));
  await put(`${ORG}/projects/p/streams/a/brb.html`, view("BRB, week one"));
});

describe("scanLibrary", () => {
  test("lists projects, streams and views in their order", async () => {
    const l = await scanLibrary(root, ORG);
    expect(l.templates.map((t) => t.label)).toEqual(["Title"]);
    const [p] = l.projects;
    expect(p!.name).toBe("Weekly");
    expect(p!.scenes.map((s) => s.name)).toEqual(["intro", "brb"]);
    expect(p!.streams.map((s) => s.name)).toEqual(["First", "Second"]);
    expect(p!.streams[0]!.scenes).toEqual([{ name: "brb", label: "BRB, week one", path: `${ORG}/projects/p/streams/a/brb.html`, origin: "stream" }]);
  });

  test("a title changed between scans is the new one on the next scan", async () => {
    await scanLibrary(root, ORG);
    await put(`${ORG}/projects/p/scenes/intro.html`, view("Opening titles"));
    expect(await labels()).toContain("p/scenes/intro.html=Opening titles");
  });

  test("a change that kept the file's size and time is picked up once the watcher reports its path", async () => {
    await keepTime(`${ORG}/projects/p/scenes/intro.html`);
    await scanLibrary(root, ORG);
    await putKeepingTime(`${ORG}/projects/p/scenes/intro.html`, view("Outro"));
    forgetScanned(root, [`${ORG}/projects/p/scenes/intro.html`]);
    expect(await labels()).toContain("p/scenes/intro.html=Outro");
  });

  test("a folder the watcher reports drops every title inside it", async () => {
    await keepTime(`${ORG}/projects/p/streams/a/brb.html`);
    await scanLibrary(root, ORG);
    await putKeepingTime(`${ORG}/projects/p/streams/a/brb.html`, view("BRB, week 1ne"));
    forgetScanned(root, [`${ORG}/projects/p/streams`]);
    expect(await labels()).toContain("p/streams/a/brb.html=BRB, week 1ne");
  });

  test("files added and deleted between scans come and go", async () => {
    await scanLibrary(root, ORG);
    await rm(join(root, ORG, "projects/p/scenes/brb.html"));
    await put(`${ORG}/projects/p/streams/b/end.html`, view("The end"));
    const now = await labels();
    expect(now).not.toContain("p/scenes/brb.html=Be right back");
    expect(now).toContain("p/streams/b/end.html=The end");
  });

  test("forgetting a change to thousands of files at once (a git pull, a sync) is quick", async () => {
    for (let s = 0; s < 400; s++) for (const v of ["a", "b", "c", "d", "e"]) await put(`${ORG}/projects/p/streams/s${s}/${v}.html`, view(`${v} ${s}`));
    await scanLibrary(root, ORG); // about 2,000 titles kept: a pass over all of them per path took 200 ms here
    const paths = Array.from({ length: 20_000 }, (_, i) => `${ORG}/projects/p/streams/s${i % 400}/new-${i}.html`);
    paths.push(`${ORG}/projects/p/streams/s7/a.html`, `${ORG}/projects/p/streams/s8`);
    const t = performance.now();
    forgetScanned(root, paths);
    expect(performance.now() - t).toBeLessThan(100);
  });

  test("a library with many more files than are read at once, scanned by several clients together", async () => {
    for (let s = 0; s < 40; s++) {
      await put(`${ORG}/projects/p/streams/s${s}/stream.json`, JSON.stringify({ name: `S${s}`, date: `2026-03-${String(s + 1).padStart(2, "0")}` }));
      for (const v of ["a", "b", "c", "d", "e"]) await put(`${ORG}/projects/p/streams/s${s}/${v}.html`, view(`${v} ${s}`));
    }
    const scans = await Promise.all([1, 2, 3, 4].map(() => scanLibrary(root, ORG)));
    for (const l of scans) {
      expect(l.projects[0]!.streams).toHaveLength(42);
      expect(l.projects[0]!.streams.find((s) => s.id === "s39")!.scenes.map((v) => v.label)).toEqual(["a 39", "b 39", "c 39", "d 39", "e 39"]);
    }
  });
});
