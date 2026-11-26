// EDIT-3 / EDIT-4: the editor's file endpoints, as functions and over HTTP against a real server.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, cp, lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanElements, textOf, untagForEdit } from "@viewswitcher/shared";
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
    expect(html).toContain(`<html data-vs="0" data-vs-hash="${hash}" lang="en">`);
    expect(untagForEdit(html)).toBe(before);
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
    await expect(editScene(root, SCENE, hash, [{ id: null, text: "x" }])).rejects.toThrow(); // not element 0
    await expect(editScene(root, SCENE, hash, [{ id: "3", text: "x" }])).rejects.toThrow();
    await expect(editScene(root, SCENE, hash, Array.from({ length: 101 }, () => ({ id: 1, text: "x" })))).rejects.toThrow("Too many edits at once");
    expect(await readFile(join(root, SCENE), "utf8")).toBe(before);
  });
});

describe("saving keeps the file what it was (PR #1 review)", () => {
  test("permissions survive a save", async () => {
    const abs = join(root, "acme/templates/brb.html");
    await chmod(abs, 0o664);
    const text = await readFile(abs, "utf8");
    const id = scanElements(text).find((e) => e.leaf && e.tag !== "title")!.id;
    expect((await editScene(root, "acme/templates/brb.html", sceneHash(text), [{ id, text: "Back soon" }])).ok).toBe(true);
    expect((await stat(abs)).mode & 0o777).toBe(0o664);
  });
  test("a linked scene stays a link and its target changes", async () => {
    const target = join(root, "acme/templates/ending.html");
    const link = join(root, "acme/templates/ending-link.html");
    await symlink(target, link);
    const text = await readFile(target, "utf8");
    const id = scanElements(text).find((e) => e.leaf && e.tag !== "title")!.id;
    expect((await editScene(root, "acme/templates/ending-link.html", sceneHash(text), [{ id, text: "Thanks!" }])).ok).toBe(true);
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readFile(target, "utf8")).toContain(">Thanks!<");
  });
  test("a link to a file outside the library is refused", async () => {
    const outside = join(root, "..", `vs-outside-${process.pid}.html`);
    await writeFile(outside, "<p>outside</p>");
    await symlink(outside, join(root, "acme/templates/out.html"));
    await expect(editScene(root, "acme/templates/out.html", sceneHash("<p>outside</p>"), [{ id: 0, text: "x" }])).rejects.toThrow();
    // Round 3: nor is it read for editing, and a stale save doesn't reveal its hash.
    await expect(readForEdit(root, "acme/templates/out.html")).rejects.toThrow();
    await expect(editScene(root, "acme/templates/out.html", "stale", [{ id: 0, text: "x" }])).rejects.toThrow();
    expect(await readFile(outside, "utf8")).toBe("<p>outside</p>");
    await rm(outside);
  });
});

describe("a write that lands while saving (PR #1 architecture #5)", () => {
  test("someone else's save between read and replace wins; this one is a 409", async () => {
    const SC = "acme/templates/starting-soon.html";
    const abs = join(root, SC);
    const before = await readFile(abs, "utf8");
    const id = scanElements(before).find((e) => e.leaf && e.tag !== "title")!.id;
    const theirs = before.replace("</body>", "<!-- agent -->\n</body>");
    const r = await editScene(root, SC, sceneHash(before), [{ id, text: "Mine" }], {
      beforeReplace: () => writeFile(abs, theirs),
    });
    expect(r).toEqual({ ok: false, conflict: true, hash: sceneHash(theirs) });
    expect(await readFile(abs, "utf8")).toBe(theirs);
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(join(root, "acme/templates"))).filter((f) => f.includes(".vs-"))).toEqual([]);
  });
});

describe("no staged copy is left behind (PR #1 round 5)", () => {
  test("a failure between staging and replacing removes the temp file", async () => {
    const SC = "acme/templates/ending.html";
    const before = await readFile(join(root, SC), "utf8");
    const id = scanElements(before).find((e) => e.leaf && e.tag !== "title")!.id;
    await expect(editScene(root, SC, sceneHash(before), [{ id, text: "Bye" }], {
      beforeReplace: async () => { throw new Error("disk full"); },
    })).rejects.toThrow("disk full");
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(join(root, "acme/templates"))).filter((f) => f.includes(".vs-"))).toEqual([]);
    expect(await readFile(join(root, SC), "utf8")).toBe(before);
  });
});

describe("over HTTP", () => {
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  let base = "";
  beforeAll(async () => {
    proc = Bun.spawn(["bun", join(import.meta.dir, "index.ts")], {
      env: { ...process.env, HOST: "127.0.0.1", PORT: "0", OBS_URL: "ws://127.0.0.1:1", VIEWSWITCHER_USB: "0", VIEWSWITCHER_LIBRARY: root, VIEWSWITCHER_LOG: "" },
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

  test("?edit falls back to the plain file when the scene can't be tagged (PR #1 architecture #4)", async () => {
    // An org folder name the editor refuses (plainName) must still show on the program page.
    await cp(join(root, "acme"), join(root, "_odd"), { recursive: true });
    const plain = await readFile(join(root, "_odd/templates/brb.html"), "utf8");
    const res = await fetch(`${base}/library/_odd/templates/brb.html?edit`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-scene-hash")).toBeNull();
    expect(await res.text()).toBe(plain);
  });

  test("POST /api/scene/live-edit broadcasts and writes nothing; the old /api/scene/preview still does", async () => {
    const before = await readFile(join(root, SCENE), "utf8");
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws`);
    const got = new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data));
        if (m.t === "scene:liveEdit") resolve(m);
      };
    });
    await new Promise((r) => (ws.onopen = r));
    expect((await post("/api/scene/live-edit", { path: SCENE, hash: "h1", session: "s1", seq: 7, edit: { id: 3, left: 10, top: 20 } })).status).toBe(200);
    expect(await got).toEqual({ t: "scene:liveEdit", path: SCENE, hash: "h1", session: "s1", seq: 7, edit: { id: 3, left: 10, top: 20 } });
    const again = new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data));
        if (m.t === "scene:liveEdit" && m.seq === 8) resolve(m);
      };
    });
    expect((await post("/api/scene/preview", { path: SCENE, hash: "h1", session: "s1", seq: 8, edit: { id: 3, left: 11, top: 20 } })).status).toBe(200);
    expect((await again).edit).toEqual({ id: 3, left: 11, top: 20 });
    ws.close();
    expect(await readFile(join(root, SCENE), "utf8")).toBe(before);
    expect((await post("/api/scene/live-edit", { path: SCENE, edit: { id: 3 } })).status).toBe(400);
  });
});
