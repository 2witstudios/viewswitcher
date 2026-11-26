// What the view on air loads through links that don't lead to a file yet: where they point is listed, so
// an agent creating it while live is refused like a change to the ref itself (scene-refs.ts loadedFiles).
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveInLibrary } from "./library/contain";
import { PathError } from "./paths";
import { loadedFiles } from "./scene-refs";

const root = mkdtempSync(join(tmpdir(), "vs-refs-links-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const at = (rel: string) => join(root, rel);
mkdirSync(at("daisy/templates"), { recursive: true });
mkdirSync(at("daisy/common"), { recursive: true });
const page = (name: string, html: string) => writeFileSync(at(`daisy/templates/${name}.html`), html);
const loads = async (name: string, limit?: number) => loadedFiles(root, [`daisy/templates/${name}.html`], limit);

test("a picture that is a dangling link: where it points is listed", async () => {
  symlinkSync("nowhere.png", at("daisy/templates/logo.png"));
  page("pic", `<img src="/library/daisy/templates/logo.png">`);
  expect((await loads("pic")).files).toContain("daisy/templates/nowhere.png");
});

test("a link is read from its real folder, as the system reads it, not from the path the scene wrote", async () => {
  symlinkSync("../common", at("daisy/templates/lnk"));
  symlinkSync("../nowhere2.css", at("daisy/common/gone.css"));
  page("real", `<link rel="stylesheet" href="/library/daisy/templates/lnk/gone.css">`);
  const { files } = await loads("real");
  expect(files).toContain("daisy/nowhere2.css");
  expect(files).not.toContain("daisy/templates/nowhere2.css");
});

test("a folder on the way that is a dangling link: the same path under where it points is listed", async () => {
  symlinkSync("y", at("daisy/templates/x"));
  page("parent", `<img src="/library/daisy/templates/x/logo.png">`);
  expect((await loads("parent")).files).toContain("daisy/templates/y/logo.png");
});

test("a link target past the limit marks the list incomplete", async () => {
  page("cut", `<img src="/library/daisy/templates/logo.png">`);
  const l = await loads("cut", 1);
  expect(l.files).toEqual(["daisy/templates/logo.png"]);
  expect(l.complete).toBe(false);
});

test("a folder that is a link loop is refused as leading nowhere (not a raw error), and doesn't block agents", async () => {
  symlinkSync("loop", at("daisy/templates/loop"));
  await expect(resolveInLibrary(root, "daisy/templates/loop/x.css")).rejects.toBeInstanceOf(PathError);
  page("loopy", `<link rel="stylesheet" href="/library/daisy/templates/loop/x.css">`);
  expect((await loads("loopy")).unreadable).toEqual([]);
});
