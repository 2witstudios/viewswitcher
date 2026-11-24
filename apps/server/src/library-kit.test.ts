import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureLibrary, FIRST_ORG, KIT_FILES } from "./library-kit";

const kit = join(import.meta.dir, "../library-kit");
const starter = join(import.meta.dir, "../starter");
const temps: string[] = [];
const tempDir = async () => {
  const d = await mkdtemp(join(tmpdir(), "vs-kit-"));
  temps.push(d);
  return d;
};
afterEach(async () => {
  for (const d of temps.splice(0)) await rm(d, { recursive: true, force: true });
});

/** Every file under `dir` with its bytes and mtime, to prove a run changed nothing. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const rel of await readdir(dir, { recursive: true })) {
    const p = join(dir, rel);
    const s = await stat(p);
    out[rel] = s.isFile() ? `${s.mtimeMs}:${await readFile(p, "utf8")}` : "dir";
  }
  return out;
}

const gitCalls: string[] = [];
const fakeGit = async (dir: string) => {
  gitCalls.push(dir);
  await mkdir(join(dir, ".git"));
  return true;
};

describe("ensureLibrary", () => {
  test("an empty folder gets the kit, a git repo and a first org", async () => {
    const root = await tempDir();
    gitCalls.length = 0;
    const r = await ensureLibrary(root, { kit, starter, gitInit: fakeGit });
    expect(r.copied).toEqual(KIT_FILES.map((f) => f.to));
    expect(r.git).toBe(true);
    expect(gitCalls).toEqual([root]);
    expect(r.org).toBe("my-channel");
    for (const { from, to } of KIT_FILES) expect(await readFile(join(root, to), "utf8")).toBe(await readFile(join(kit, from), "utf8"));
    const org = JSON.parse(await readFile(join(root, "my-channel/org.json"), "utf8"));
    expect(org.name).toBe(FIRST_ORG);
    expect(await readFile(join(root, ".gitignore"), "utf8")).toContain(".viewswitcher/");
  });

  test("a second start changes nothing", async () => {
    const root = await tempDir();
    await ensureLibrary(root, { kit, starter, gitInit: fakeGit });
    const before = await snapshot(root);
    gitCalls.length = 0;
    const r = await ensureLibrary(root, { kit, starter, gitInit: fakeGit });
    expect(r).toEqual({ copied: [], updated: [], git: false, org: null });
    expect(gitCalls).toEqual([]);
    expect(await snapshot(root)).toEqual(before);
  });

  test("works without git", async () => {
    const root = await tempDir();
    const r = await ensureLibrary(root, { kit, starter, gitInit: async () => false });
    expect(r.git).toBe(false);
    expect(r.org).toBe("my-channel");
  });

  test("an existing library keeps its own files, orgs and history", async () => {
    const root = await tempDir();
    await mkdir(join(root, ".claude/skills/viewswitcher-scenes"), { recursive: true });
    await writeFile(join(root, ".claude/skills/viewswitcher-scenes/SKILL.md"), "my own skill");
    await writeFile(join(root, "CLAUDE.md"), "my own notes");
    await writeFile(join(root, ".gitignore"), "mine\n");
    await mkdir(join(root, "acme"));
    await writeFile(join(root, "acme/org.json"), JSON.stringify({ name: "Acme" }));
    const before = await snapshot(root);
    gitCalls.length = 0;
    const r = await ensureLibrary(root, { kit, starter, gitInit: fakeGit });
    expect(r).toEqual({ copied: [], updated: [], git: false, org: null });
    expect(gitCalls).toEqual([]);
    expect(await snapshot(root)).toEqual(before);
  });

  test("an existing library missing the skill gets it, and no new org", async () => {
    const root = await tempDir();
    await mkdir(join(root, "acme"));
    await writeFile(join(root, "acme/org.json"), JSON.stringify({ name: "Acme" }));
    const r = await ensureLibrary(root, { kit, starter, gitInit: fakeGit });
    expect(r.copied).toEqual(KIT_FILES.map((f) => f.to));
    expect(r.org).toBeNull();
    expect(r.git).toBe(false);
  });

  test("a newer kit updates the files it wrote, never ones someone edited", async () => {
    const root = await tempDir();
    const oldKit = await tempDir();
    for (const { from } of KIT_FILES) {
      await mkdir(join(oldKit, from, ".."), { recursive: true });
      await writeFile(join(oldKit, from), `old ${from}`);
    }
    await ensureLibrary(root, { kit: oldKit, starter, gitInit: fakeGit });
    await writeFile(join(root, "CLAUDE.md"), "old library-CLAUDE.md\nplus my notes");
    const r = await ensureLibrary(root, { kit, starter, gitInit: fakeGit });
    expect(r.updated).toEqual([".gitignore", ".claude/skills/viewswitcher-scenes/SKILL.md"]);
    expect(await readFile(join(root, "CLAUDE.md"), "utf8")).toBe("old library-CLAUDE.md\nplus my notes");
    expect(await readFile(join(root, ".claude/skills/viewswitcher-scenes/SKILL.md"), "utf8")).toBe(
      await readFile(join(kit, "skills/viewswitcher-scenes/SKILL.md"), "utf8"),
    );
    // and once up to date, the next start is a no-op
    const before = await snapshot(root);
    expect(await ensureLibrary(root, { kit, starter, gitInit: fakeGit })).toEqual({ copied: [], updated: [], git: false, org: null });
    expect(await snapshot(root)).toEqual(before);
  });

  test("the kit is generic: no one's own orgs, paths or names", async () => {
    for (const { from } of KIT_FILES) {
      const text = await readFile(join(kit, from), "utf8");
      expect({ from, hit: text.match(/daisy|pagespace|bible|jono|Projects\/viewswitcher/i)?.[0] ?? null }).toEqual({ from, hit: null });
    }
  });
});
