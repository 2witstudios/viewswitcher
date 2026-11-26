// A named pipe (or another file that isn't a plain file) where the library has a view, a stylesheet or a
// text file: every read the switcher and agents make refuses it at once instead of waiting forever, and
// a view that is a link outside the library is never copied in.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { duplicate } from "./library";
import { readText, writeText } from "./library-files";
import { loadedFiles } from "./scene-refs";

const root = mkdtempSync(join(tmpdir(), "vs-pipes-"));
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

  test("write_file over it refuses", async () => {
    const r = await settled(writeText(root, "daisy/templates/pipe.html", "<title>x</title>", "somehash"));
    expect(r).not.toBe("hung");
  });

  test("the on-air guard's loadedFiles skips a linked stylesheet that is a pipe", async () => {
    const r = await settled(loadedFiles(root, ["daisy/templates/brb.html"]));
    expect(r).not.toBe("hung");
    expect((r as { v: { read: Record<string, string> } }).v.read).not.toHaveProperty("daisy/templates/_shared/theme.css");
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
