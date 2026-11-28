// The switcher's own library changes (New project, New stream, New scene from a template, Customize,
// Customize transition, Upload) never write or read through a folder that links outside the library,
// as the agents' tools don't (mcp/server.ts contained()). Links that stay in the library still work.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as lib from "./library";
import { fileLinks } from "../../../test-links";

const library = mkdtempSync(join(tmpdir(), "vs-links-"));
const outside = mkdtempSync(join(tmpdir(), "vs-links-out-"));
afterAll(() => {
  rmSync(library, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});
const org = join(library, "daisy");
const put = (p: string, text = "<title>x</title>") => {
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, text);
};
put(join(org, "org.json"), "{}");
put(join(org, "templates/brb.html"));
put(join(org, "templates/_shared/transition.html"));
const away = (name: string) => {
  const d = join(outside, name);
  mkdirSync(d, { recursive: true });
  return d;
};
const empty = (d: string) => expect(readdirSync(d)).toEqual([]);
const OUTSIDE = "outside the library";

describe("library changes through a folder linked outside", () => {
  test("New project: projects/ linked outside is refused", async () => {
    const o = join(library, "o1");
    put(join(o, "org.json"), "{}");
    const d = away("projects");
    symlinkSync(d, join(o, "projects"));
    await expect(lib.createProject(o, "Show", [])).rejects.toThrow(OUTSIDE);
    empty(d);
  });
  test.skipIf(!fileLinks)("New project from a template that links outside: refused", async () => {
    put(join(outside, "tpl.html"), "<title>Outside</title>");
    symlinkSync(join(outside, "tpl.html"), join(org, "templates/linked.html"));
    await expect(lib.createProject(org, "From linked", ["linked"])).rejects.toThrow(OUTSIDE);
  });
  test("New stream, New scene from a template, Customize, Customize transition", async () => {
    const { projectId } = await lib.createProject(org, "P", ["brb"]);
    const project = join(org, "projects", projectId);
    // streams/ linked outside
    const s = away("streams");
    rmSync(join(project, "streams"), { recursive: true, force: true });
    symlinkSync(s, join(project, "streams"));
    await expect(lib.createStream(org, projectId, "Sunday", "2026-12-06")).rejects.toThrow(OUTSIDE);
    empty(s);
    // scenes/ linked outside
    const sc = away("scenes");
    rmSync(join(project, "scenes"), { recursive: true, force: true });
    symlinkSync(sc, join(project, "scenes"));
    await expect(lib.addFromTemplate(org, "brb", projectId)).rejects.toThrow(OUTSIDE);
    empty(sc);
    // Customize transition into a project folder that links outside
    const { projectId: p2 } = await lib.createProject(org, "P2", []);
    const pd = away("p2");
    rmSync(join(org, "projects", p2), { recursive: true, force: true });
    symlinkSync(pd, join(org, "projects", p2));
    await expect(lib.customizeTransition(org, p2)).rejects.toThrow(OUTSIDE);
    empty(pd);
  });
  test("Customize: a stream folder linked outside is refused", async () => {
    const { projectId } = await lib.createProject(org, "C", ["brb"]);
    const { streamId } = await lib.createStream(org, projectId, "Live", "2026-12-07");
    const st = away("stream");
    rmSync(join(org, "projects", projectId, "streams", streamId), { recursive: true, force: true });
    symlinkSync(st, join(org, "projects", projectId, "streams", streamId));
    await expect(lib.customize(org, projectId, streamId, "brb")).rejects.toThrow(OUTSIDE);
    empty(st);
  });
  test("Upload: assets/ linked outside is refused", async () => {
    const o = join(library, "o2");
    put(join(o, "org.json"), "{}");
    const a = away("assets");
    symlinkSync(a, join(o, "assets"));
    await expect(lib.saveAsset(o, new File(["x"], "logo.svg"))).rejects.toThrow(OUTSIDE);
    empty(a);
  });
});

describe("deletions through a folder linked outside", () => {
  test.skipIf(!fileLinks)("Revert (a stream's own copy) and Revert transition never delete outside the library", async () => {
    const { projectId } = await lib.createProject(org, "Del", ["brb"]);
    const { streamId } = await lib.createStream(org, projectId, "Del", "2026-12-08");
    // The stream's folder links outside, where a file has the copy's name.
    const st = away("del-stream");
    writeFileSync(join(st, "brb.html"), "outside");
    rmSync(join(org, "projects", projectId, "streams", streamId), { recursive: true, force: true });
    symlinkSync(st, join(org, "projects", projectId, "streams", streamId));
    await expect(lib.revert(org, projectId, streamId, "brb")).rejects.toThrow(OUTSIDE);
    expect(readdirSync(st)).toEqual(["brb.html"]);
    // The project's transition is a link to a file outside.
    const t = join(away("del-transition"), "transition.html");
    writeFileSync(t, "outside");
    symlinkSync(t, join(org, "projects", projectId, "transition.html"));
    await expect(lib.revertTransition(org, projectId)).rejects.toThrow(OUTSIDE);
    expect(readdirSync(join(outside, "del-transition"))).toEqual(["transition.html"]);
  });
});

describe("links that stay in the library still work", () => {
  test.skipIf(!fileLinks)("assets/ linked to another org's assets, and a template linked to another template", async () => {
    const o = join(library, "o3");
    put(join(o, "org.json"), "{}");
    put(join(o, "templates/brb.html"));
    mkdirSync(join(org, "assets"), { recursive: true });
    symlinkSync(join(org, "assets"), join(o, "assets"));
    expect((await lib.saveAsset(o, new File(["x"], "shared.svg"))).path).toBe("assets/shared.svg");
    symlinkSync(join(o, "templates/brb.html"), join(o, "templates/alias.html"));
    const { projectId } = await lib.createProject(o, "Linked inside", ["alias"]);
    expect(readdirSync(join(o, "projects", projectId, "scenes"))).toEqual(["alias.html"]);
  });
});
