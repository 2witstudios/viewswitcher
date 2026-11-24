// EDIT-3 / EDIT-4: the editor's file endpoints, as functions and over HTTP against a real server.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanElements, textOf } from "@viewswitcher/shared";
import { editScene, readForEdit, sceneHash } from "./scene-edit";

const starter = join(import.meta.dir, "../starter");
const SCENE = "acme/templates/teaching.html";
let root = "";

const titleId = (html: string) => scanElements(html).find((e) => e.leaf && textOf(html, e) === "Today's topic")!.id;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "vs-edit-"));
  await cp(starter, join(root, "acme"), { recursive: true });
});
afterAll(() => rm(root, { recursive: true, force: true }));

describe("readForEdit (EDIT-3)", () => {
  test("tags every element and hashes the file, without touching it", async () => {
    const abs = join(root, SCENE);
    const before = await readFile(abs, "utf8");
    const { mtimeMs } = await stat(abs);
    const { html, hash } = await readForEdit(root, SCENE);
    expect(hash).toBe(sceneHash(before));
    expect(html).toContain(`<html data-vs="0" lang="en">`);
    expect(html.replace(/ data-vs="\d+"/g, "")).toBe(before);
    expect(await readFile(abs, "utf8")).toBe(before);
    expect((await stat(abs)).mtimeMs).toBe(mtimeMs);
  });
  test("refuses anything that isn't a scene inside the library", async () => {
    for (const p of ["../etc/passwd.html", "acme/org.json", "/acme/../../x.html", ".hidden/x.html"]) {
      await expect(readForEdit(root, p)).rejects.toThrow();
    }
  });
});

describe("editScene (EDIT-4)", () => {
  test("with the current hash: patches and saves; with a stale one: changes nothing", async () => {
    const abs = join(root, SCENE);
    const before = await readFile(abs, "utf8");
    const hash = sceneHash(before);
    const r = await editScene(root, SCENE, hash, [{ id: titleId(before), text: "Romans 8" }]);
    expect(r).toMatchObject({ ok: true, changed: true });
    const after = await readFile(abs, "utf8");
    expect(after).toBe(before.replace(">Today's topic<", ">Romans 8<"));
    expect(r.hash).toBe(sceneHash(after));

    const stale = await editScene(root, SCENE, hash, [{ id: titleId(before), text: "Mine" }]);
    expect(stale).toEqual({ ok: false, conflict: true, hash: sceneHash(after) });
    expect(await readFile(abs, "utf8")).toBe(after);
  });
  test("bad edits are refused and write nothing", async () => {
    const before = await readFile(join(root, SCENE), "utf8");
    const hash = sceneHash(before);
    await expect(editScene(root, SCENE, hash, [])).rejects.toThrow();
    await expect(editScene(root, SCENE, hash, [{ id: 0, text: "x" }])).rejects.toThrow(); // <html> isn't text
    await expect(editScene(root, SCENE, hash, [{ id: 1, left: "a", top: 1 }])).rejects.toThrow();
    expect(await readFile(join(root, SCENE), "utf8")).toBe(before);
  });
});

describe("over HTTP", () => {
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  let base = "";
  beforeAll(async () => {
    proc = Bun.spawn(["bun", join(import.meta.dir, "index.ts")], {
      env: { ...process.env, PORT: "0", OBS_URL: "ws://127.0.0.1:1", VIEWSWITCHER_USB: "0", VIEWSWITCHER_LIBRARY: root, VIEWSWITCHER_LOG: "" },
      stdout: "pipe", stderr: "ignore",
    });
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    let out = "";
    while (!/localhost:(\d+)/.test(out)) {
      const { value, done } = await reader.read();
      if (done) throw new Error("server exited");
      out += new TextDecoder().decode(value);
    }
    base = `http://127.0.0.1:${/localhost:(\d+)/.exec(out)![1]}`;
    reader.releaseLock();
  });
  afterAll(() => proc?.kill());

  const post = (path: string, body: unknown) =>
    fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  test("GET ?edit serves the tagged scene and its hash; plain GET is untouched", async () => {
    const file = await readFile(join(root, SCENE), "utf8");
    const res = await fetch(`${base}/library/${SCENE}?edit`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-scene-hash")).toBe(sceneHash(file));
    expect(await res.text()).toContain('data-vs="');
    expect(await (await fetch(`${base}/library/${SCENE}`)).text()).toBe(file);
    expect((await fetch(`${base}/library/acme/templates/nope.html?edit`)).status).toBe(404);
  });

  test("POST /api/scene/edit saves with the current hash and 409s with a stale one", async () => {
    const abs = join(root, SCENE);
    const res = await fetch(`${base}/library/${SCENE}?edit`);
    const hash = res.headers.get("x-scene-hash")!;
    const tagged = await res.text();
    const notes = scanElements(tagged).find((e) => e.tag === "section")!.id;

    const ok = await post("/api/scene/edit", { path: SCENE, hash, edits: [{ id: notes, left: 32, top: 408 }] });
    expect(ok.status).toBe(200);
    const saved = (await ok.json()) as { hash: string };
    const after = await readFile(abs, "utf8");
    expect(after).toContain(`<section class="abs panel" style="left: 32px; top: 408px; width: 360px`);
    expect(saved.hash).toBe(sceneHash(after));

    // Someone else saves; the editor's hash is now stale.
    await writeFile(abs, after.replace("Notes", "Agenda"));
    const stale = await post("/api/scene/edit", { path: SCENE, hash: saved.hash, edits: [{ id: notes, left: 0, top: 0 }] });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { hash: string }).hash).toBe(sceneHash(after.replace("Notes", "Agenda")));
    expect(await readFile(abs, "utf8")).toBe(after.replace("Notes", "Agenda"));

    expect((await post("/api/scene/edit", { path: "../x.html", hash, edits: [{ id: 1, text: "x" }] })).status).toBe(400);
  });

  test("POST /api/scene/preview broadcasts and writes nothing", async () => {
    const before = await readFile(join(root, SCENE), "utf8");
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws`);
    const got = new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data));
        if (m.t === "scene:preview") resolve(m);
      };
    });
    await new Promise((r) => (ws.onopen = r));
    expect((await post("/api/scene/preview", { path: SCENE, edit: { id: 3, left: 10, top: 20 } })).status).toBe(200);
    expect(await got).toEqual({ t: "scene:preview", path: SCENE, edit: { id: 3, left: 10, top: 20 } });
    ws.close();
    expect(await readFile(join(root, SCENE), "utf8")).toBe(before);
    expect((await post("/api/scene/preview", { path: SCENE, edit: { id: 3 } })).status).toBe(400);
  });
});
