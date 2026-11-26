// A named pipe (or another file that isn't a plain file) where the library has a view, a stylesheet or a
// text file: every read the switcher and agents make refuses it at once instead of waiting forever, and
// a view that is a link outside the library is never copied in.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { chmod, mkdir, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addFromTemplate, customize, duplicate } from "./library";
import { readNoFollowSync } from "./library/contain";
import { readGuide } from "./mcp/server";
import { PathError } from "./paths";
import { readText, writeText } from "./library-files";
import { loadedFiles } from "./scene-refs";

const root = mkdtempSync(join(tmpdir(), "vs-pipes-"));
const realRoot = realpathSync(root);
const away = mkdtempSync(join(tmpdir(), "vs-pipes-away-"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(away, { recursive: true, force: true });
});
const fifo = (rel: string) => expect(Bun.spawnSync(["mkfifo", join(root, rel)]).exitCode).toBe(0);
/** `p`, or "hung" when it hasn't settled within 3 s. */
const settled = <T>(p: Promise<T>) => Promise.race([p.then((v) => ({ v }), (e: Error) => ({ e: e.message })), Bun.sleep(3000).then(() => "hung" as const)]);

beforeAll(async () => {
  await mkdir(join(root, "daisy/templates/_shared"), { recursive: true });
  await writeFile(join(root, "daisy/org.json"), JSON.stringify({ name: "Daisy" }));
  await writeFile(join(root, "daisy/templates/brb.html"), `<title>BRB</title><link rel="stylesheet" href="/library/daisy/templates/_shared/theme.css">`);
  fifo("daisy/templates/pipe.html");
  fifo("daisy/templates/_shared/theme.css");
  await writeFile(join(away, "secret.html"), "<title>Outside secret</title>");
  await symlink(join(away, "secret.html"), join(root, "daisy/templates/linked.html"));
});

describe("a named pipe in the library", () => {
  test("read_file refuses it", async () => {
    const r = await settled(readText(root, "daisy/templates/pipe.html", 7420));
    expect(r).not.toBe("hung");
    expect(r).toHaveProperty("e");
  });

  test("write_file over it refuses, saying what it is", async () => {
    const r = await settled(writeText(root, "daisy/templates/pipe.html", "<title>x</title>", "somehash"));
    expect(r).toEqual({ e: "daisy/templates/pipe.html isn't a plain file (a named pipe or a device?)" });
  });

  test("the on-air guard's check at a commit (readNoFollowSync) refuses it at once", async () => {
    const t0 = performance.now();
    expect(() => readNoFollowSync(join(realRoot, "daisy/templates/pipe.html"))).toThrow("isn't a plain file");
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  test("a new scene from a template that is a pipe, and a stream's copy of one, refuse it as a bad path", async () => {
    await mkdir(join(root, "daisy/projects/p/scenes"), { recursive: true });
    await mkdir(join(root, "daisy/projects/p/streams/s"), { recursive: true });
    await writeFile(join(root, "daisy/projects/p/project.json"), JSON.stringify({ name: "P", order: [] }));
    const fromTemplate = await settled(addFromTemplate(join(root, "daisy"), "pipe", "p"));
    expect(fromTemplate).toHaveProperty("e");
    fifo("daisy/projects/p/scenes/piped.html");
    await expect(customize(join(root, "daisy"), "p", "s", "piped")).rejects.toBeInstanceOf(PathError);
  });

  test("the guide (get_guide) skips a library copy that is a pipe and reads the kit's", async () => {
    await mkdir(join(root, ".claude/skills/viewswitcher-scenes"), { recursive: true });
    fifo(".claude/skills/viewswitcher-scenes/SKILL.md");
    const kit = mkdtempSync(join(tmpdir(), "vs-pipes-kit-"));
    await mkdir(join(kit, "skills/viewswitcher-scenes"), { recursive: true });
    await writeFile(join(kit, "skills/viewswitcher-scenes/SKILL.md"), "the kit's guide");
    expect(await settled(readGuide(root, kit))).toEqual({ v: "the kit's guide" });
    rmSync(kit, { recursive: true, force: true });
  });

  test("the on-air guard's loadedFiles skips a linked stylesheet that is a pipe", async () => {
    const r = await settled(loadedFiles(root, ["daisy/templates/brb.html"]));
    expect(r).not.toBe("hung");
    expect((r as { v: { read: Record<string, string> } }).v.read).not.toHaveProperty("daisy/templates/_shared/theme.css");
    // A pipe is what /library/ refuses too, so the page loads nothing from it: not "unreadable", and agents aren't blocked.
    expect((r as { v: { unreadable: string[] } }).v.unreadable).toEqual([]);
  });

  test("references /library/ wouldn't serve either (a dangling link, a folder named like a stylesheet, a file or folder without permission) don't block agents", async () => {
    await writeFile(join(root, "daisy/templates/stale.html"), [...["gone", "folder", "locked"].map((n) => `_shared/${n}.css`), "shut/x.css"].map((n) => `<link rel="stylesheet" href="/library/daisy/templates/${n}">`).join(""));
    await mkdir(join(root, "daisy/templates/shut"), { recursive: true });
    await writeFile(join(root, "daisy/templates/shut/x.css"), "body{}");
    await chmod(join(root, "daisy/templates/shut"), 0o600);
    await symlink(join(root, "daisy/templates/_shared/nowhere.css"), join(root, "daisy/templates/_shared/gone.css"));
    await mkdir(join(root, "daisy/templates/_shared/folder.css"));
    await writeFile(join(root, "daisy/templates/_shared/locked.css"), "body{}");
    await chmod(join(root, "daisy/templates/_shared/locked.css"), 0o000);
    try {
      // /library/ serves none of them, so the page loads nothing from them: they're listed as loaded, not unknown.
      const r = await loadedFiles(root, ["daisy/templates/stale.html"]);
      expect(r.unreadable).toEqual([]);
      expect(r.complete).toBe(true);
      expect(r.files.sort()).toEqual(["daisy/templates/_shared/folder.css", "daisy/templates/_shared/gone.css", "daisy/templates/_shared/locked.css", "daisy/templates/shut/x.css"]);
    } finally {
      await chmod(join(root, "daisy/templates/_shared/locked.css"), 0o644);
      await chmod(join(root, "daisy/templates/shut"), 0o755);
    }
  });


  test("duplicating it refuses", async () => {
    const r = await settled(duplicate(root, "daisy/templates/pipe.html"));
    expect(r).not.toBe("hung");
    expect(r).toHaveProperty("e");
  });
});

test("duplicating a view that is a link outside the library is refused, and nothing is copied in", async () => {
  await expect(duplicate(root, "daisy/templates/linked.html")).rejects.toThrow("outside the library");
  expect((await readdir(join(root, "daisy/templates"))).filter((f) => f.includes("copy"))).toEqual([]);
});

test("a stream's copy of a view keeps the view's permissions", async () => {
  await mkdir(join(root, "daisy/projects/q/scenes"), { recursive: true });
  await mkdir(join(root, "daisy/projects/q/streams/s"), { recursive: true });
  await writeFile(join(root, "daisy/projects/q/scenes/private.html"), "<title>Private</title>");
  await chmod(join(root, "daisy/projects/q/scenes/private.html"), 0o600);
  await customize(join(root, "daisy"), "q", "s", "private");
  expect((await stat(join(root, "daisy/projects/q/streams/s/private.html"))).mode & 0o777).toBe(0o600);
});
