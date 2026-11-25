// EDIT-16…19 on the server: insert, remove, resize and image edits under the hash/409 rule, and renaming.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { idsAfter, markupFor, restoreFor, scanElements, sceneRoot } from "@viewswitcher/shared";
import { editScene, parseEdit, renameScene, sceneHash } from "./scene-edit";

const starter = join(import.meta.dir, "../starter");
let root = "";
const STREAM = "acme/projects/show/streams/11-24-day-1";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "vs-structure-"));
  await cp(starter, join(root, "acme"), { recursive: true });
  await mkdir(join(root, "acme/projects/show/scenes"), { recursive: true });
  await mkdir(join(root, STREAM), { recursive: true });
  const teaching = await readFile(join(root, "acme/templates/teaching.html"), "utf8");
  await writeFile(join(root, "acme/projects/show/scenes/teaching.html"), teaching);
  await writeFile(join(root, STREAM, "teaching.html"), teaching); // an override
  await writeFile(join(root, STREAM, "teaching-copy.html"), teaching.replace("<title>Teaching</title>", "<title>Teaching copy</title>"));
});
afterAll(() => rm(root, { recursive: true, force: true }));

const read = (p: string) => readFile(join(root, p), "utf8");

describe("structural edits (EDIT-16 · EDIT-17 · EDIT-18)", () => {
  const P = `${STREAM}/teaching-copy.html`;
  test("insert, resize, swap and remove each save as one patch, and 409 on a stale hash", async () => {
    const before = await read(P);
    const into = sceneRoot(before)!;
    const markup = markupFor("camera", { slots: ["Screen", "Camera"] });
    const r = await editScene(root, P, sceneHash(before), [{ id: into, insert: markup }]);
    expect(r.ok).toBe(true);
    const added = await read(P);
    expect(added).toBe(before.replace("\n</main>", `\n  ${markup}\n</main>`));
    // A stale hash changes nothing.
    expect(await editScene(root, P, sceneHash(before), [{ id: into, insert: markup }])).toMatchObject({ ok: false, conflict: true });
    expect(await read(P)).toBe(added);

    const id = idsAfter(before, { id: into, insert: markup }).added!;
    expect((await editScene(root, P, sceneHash(added), [{ id, width: 480, height: 270, left: 700 }])).ok).toBe(true);
    const resized = await read(P);
    expect(resized).toContain(`data-slot="Camera 2" style="left: 700px; top: 360px; width: 480px; height: 270px"`);

    const img = scanElements(resized).find((e) => e.tag === "img")!.id;
    expect((await editScene(root, P, sceneHash(resized), [{ id: img, src: "/library/acme/assets/logo%201.png" }])).ok).toBe(true);
    const swapped = await read(P);
    expect(swapped).toContain(`<img src="/library/acme/assets/logo%201.png"`);

    const back = restoreFor(swapped, id);
    expect((await editScene(root, P, sceneHash(swapped), [{ id, remove: true }])).ok).toBe(true);
    const removed = await read(P);
    expect(removed).not.toContain("Camera 2");
    // Undo of a delete puts back the same bytes.
    expect((await editScene(root, P, sceneHash(removed), [back])).ok).toBe(true);
    expect(await read(P)).toBe(swapped);
  });

  test("refuses unsafe inserts and images from outside the library", async () => {
    const text = await read(P);
    const into = sceneRoot(text)!;
    for (const edit of [
      { id: into, insert: "<script>alert(1)</script>" },
      { id: into, insert: `<img src="x" onerror="alert(1)">` },
      { id: 1, src: "https://evil.example/x.png" },
      { id: 1, src: "/library/../etc/passwd" },
      { id: 1, src: "/library/acme/../../x.png" },
      { id: into, width: 0, height: 10 },
      { id: into, insert: "<p>x</p>", lead: "<b>" },
    ]) await expect(editScene(root, P, sceneHash(text), [edit])).rejects.toThrow();
    expect(await read(P)).toBe(text);
    expect(parseEdit({ id: 2, remove: true })).toEqual({ id: 2, remove: true });
    expect(parseEdit({ id: 2, width: "10", height: 20 })).toEqual({ id: 2, width: 10, height: 20 });
  });
});

describe("renameScene (EDIT-19)", () => {
  /** A stream scene of its own for each test, so each runs alone too. */
  const seed = async (file: string, title = "Teaching copy") => {
    const text = (await read("acme/templates/teaching.html")).replace("<title>Teaching</title>", `<title>${title}</title>`);
    await writeFile(join(root, STREAM, file), text);
    return { P: `${STREAM}/${file}`, text };
  };
  test("a stream's own scene gets a new title and file name", async () => {
    const { P, text } = await seed("rename-a.html");
    const r = await renameScene(root, P, sceneHash(text), "Opening hook");
    expect(r).toMatchObject({ ok: true, path: `${STREAM}/opening-hook.html`, was: "Teaching copy" });
    const renamed = await read(`${STREAM}/opening-hook.html`);
    expect(renamed).toBe(text.replace(/<title>[^<]*<\/title>/, "<title>Opening hook</title>"));
    expect(await readdir(join(root, STREAM))).not.toContain("rename-a.html");
  });
  test("a stream's copy of a project scene keeps its file name (it's what ties it to the project's)", async () => {
    const P = `${STREAM}/teaching.html`;
    const text = await read(P);
    expect(await renameScene(root, P, sceneHash(text), "My teaching")).toMatchObject({ ok: true, path: P });
    expect(await read(P)).toContain("<title>My teaching</title>");
  });
  test("never takes another scene's name, nor a project scene's", async () => {
    const { P, text } = await seed("rename-b.html");
    expect(await renameScene(root, P, sceneHash(text), "Teaching")).toMatchObject({ ok: true, path: `${STREAM}/teaching-2.html` });
  });
  test("a name that comes back to its own file name keeps the file (review nit)", async () => {
    const { P, text } = await seed("teaching-3.html");
    await writeFile(join(root, STREAM, "teaching-2.html"), text);
    expect(await renameScene(root, P, sceneHash(text), "Teaching")).toMatchObject({ ok: true, path: P });
  });
  test("a stale hash renames nothing", async () => {
    const { P } = await seed("rename-c.html");
    expect(await renameScene(root, P, "stale", "Other")).toMatchObject({ ok: false, conflict: true });
    expect(await read(P)).toContain("<title>Teaching copy</title>");
  });
  test("a scene with no <head> can't be renamed, and nothing moves", async () => {
    await writeFile(join(root, STREAM, "bare.html"), `<main class="scene"><p>x</p></main>`);
    await expect(renameScene(root, `${STREAM}/bare.html`, sceneHash(`<main class="scene"><p>x</p></main>`), "Bare")).rejects.toThrow();
    expect(await readdir(join(root, STREAM))).toContain("bare.html");
  });
});

describe("the server keeps a delete undoable (CodeRabbit on PR #5)", () => {
  test("refuses to delete what Undo couldn't put back", async () => {
    const html = `<main class="scene">\n  <div class="abs"><script>x()</script></div>\n</main>`;
    await writeFile(join(root, STREAM, "script.html"), html);
    await expect(editScene(root, `${STREAM}/script.html`, sceneHash(html), [{ id: 1, remove: true }])).rejects.toThrow();
    expect(await read(`${STREAM}/script.html`)).toBe(html);
  });
});
