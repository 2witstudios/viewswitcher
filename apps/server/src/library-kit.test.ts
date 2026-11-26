import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdtemp, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureLibrary, findGit, FIRST_ORG, KIT_FILES } from "./library-kit";

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

  test("a kit file that's there but can't be read (a folder, a named pipe) is the person's: left alone, and the start settles", async () => {
    const root = await tempDir();
    await mkdir(join(root, "CLAUDE.md"));
    expect(Bun.spawnSync(["mkfifo", join(root, "AGENTS.md")]).exitCode).toBe(0);
    const r = await Promise.race([ensureLibrary(root, { kit, starter, gitInit: fakeGit }), Bun.sleep(3000).then(() => null)]);
    expect(r).not.toBeNull();
    expect([...r!.copied, ...r!.updated]).not.toContain("CLAUDE.md");
    expect([...r!.copied, ...r!.updated]).not.toContain("AGENTS.md");
    expect((await lstat(join(root, "CLAUDE.md"))).isDirectory()).toBe(true);
    expect((await lstat(join(root, "AGENTS.md"))).isFIFO()).toBe(true);
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
    for (const { to } of KIT_FILES) {
      await mkdir(join(root, to, ".."), { recursive: true });
      await writeFile(join(root, to), `my own ${to}\n`);
    }
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

  test("a kit file someone made a link stays a link, even when the kit has a newer version", async () => {
    const root = await tempDir();
    const oldKit = await tempDir();
    for (const { from } of KIT_FILES) {
      await mkdir(join(oldKit, from, ".."), { recursive: true });
      await writeFile(join(oldKit, from), `old ${from}`);
    }
    await ensureLibrary(root, { kit: oldKit, starter, gitInit: fakeGit });
    // AGENTS.md → CLAUDE.md, the way some people keep one file for both.
    await rm(join(root, "AGENTS.md"));
    await symlink("CLAUDE.md", join(root, "AGENTS.md"));
    const r = await ensureLibrary(root, { kit, starter, gitInit: fakeGit });
    expect(r.updated).not.toContain("AGENTS.md");
    expect((await lstat(join(root, "AGENTS.md"))).isSymbolicLink()).toBe(true);
    expect(await readFile(join(root, "CLAUDE.md"), "utf8")).toBe(await readFile(join(kit, "library-CLAUDE.md"), "utf8"));
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
    expect(r.updated).toEqual(KIT_FILES.map((f) => f.to).filter((to) => to !== "CLAUDE.md"));
    expect(await readFile(join(root, "CLAUDE.md"), "utf8")).toBe("old library-CLAUDE.md\nplus my notes");
    expect(await readFile(join(root, ".claude/skills/viewswitcher-scenes/SKILL.md"), "utf8")).toBe(
      await readFile(join(kit, "skills/viewswitcher-scenes/SKILL.md"), "utf8"),
    );
    // and once up to date, the next start is a no-op
    const before = await snapshot(root);
    expect(await ensureLibrary(root, { kit, starter, gitInit: fakeGit })).toEqual({ copied: [], updated: [], git: false, org: null });
    expect(await snapshot(root)).toEqual(before);
  });

  test("a fresh library gets the agent files: AGENTS.md and MCP configs for Claude Code and Cursor", async () => {
    const root = await tempDir();
    await ensureLibrary(root, { kit, starter, gitInit: fakeGit });
    expect((await stat(join(root, ".cursor"))).isDirectory()).toBe(true);
    expect(JSON.parse(await readFile(join(root, ".mcp.json"), "utf8"))).toEqual({
      mcpServers: { viewswitcher: { type: "http", url: "http://127.0.0.1:7420/mcp" } },
    });
    expect(JSON.parse(await readFile(join(root, ".cursor/mcp.json"), "utf8"))).toEqual({
      mcpServers: { viewswitcher: { url: "http://127.0.0.1:7420/mcp" } },
    });
    const agents = await readFile(join(root, "AGENTS.md"), "utf8");
    expect(agents).toContain(".claude/skills/viewswitcher-scenes/SKILL.md");
    expect(agents).toContain("get_guide");
    expect(agents).toContain("http://127.0.0.1:7420/mcp");
  });

  test("someone's own MCP config and AGENTS.md are never touched, even under an older kit", async () => {
    const root = await tempDir();
    const oldKit = await tempDir();
    for (const { from } of KIT_FILES) {
      await mkdir(join(oldKit, from, ".."), { recursive: true });
      await writeFile(join(oldKit, from), `old ${from}`);
    }
    await ensureLibrary(root, { kit: oldKit, starter, gitInit: fakeGit });
    const mine = JSON.stringify({ mcpServers: { viewswitcher: { url: "http://127.0.0.1:7433/mcp" }, other: { command: "x" } } });
    await writeFile(join(root, ".cursor/mcp.json"), mine);
    await writeFile(join(root, ".mcp.json"), mine);
    await writeFile(join(root, "AGENTS.md"), "my agents notes");
    const r = await ensureLibrary(root, { kit, starter, gitInit: fakeGit });
    expect(r.updated).not.toContain(".mcp.json");
    expect(r.updated).not.toContain(".cursor/mcp.json");
    expect(r.updated).not.toContain("AGENTS.md");
    expect(await readFile(join(root, ".cursor/mcp.json"), "utf8")).toBe(mine);
    expect(await readFile(join(root, ".mcp.json"), "utf8")).toBe(mine);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe("my agents notes");
  });

  // The agent files belong in the library's repo, so people's agents find them after a clone.
  test.skipIf(!findGit())("the kit's .gitignore ignores none of the kit's files", async () => {
    const root = await tempDir();
    const git = findGit()!;
    await ensureLibrary(root, { kit, starter, gitInit: async (dir) => Bun.spawnSync([git, "init", "--quiet"], { cwd: dir }).exitCode === 0 });
    for (const { to } of KIT_FILES) {
      const p = Bun.spawnSync([git, "-c", "core.excludesFile=/dev/null", "check-ignore", "--no-index", "-q", to], { cwd: root });
      // check-ignore exits 1 when the path is not ignored (0 ignored, 128 error)
      expect({ to, exit: p.exitCode }).toEqual({ to, exit: 1 });
    }
  });

  test("the kit is generic: no one's own orgs, paths or names", async () => {
    for (const { from } of KIT_FILES) {
      const text = await readFile(join(kit, from), "utf8");
      expect({ from, hit: text.match(/daisy|pagespace|bible|jono|Projects\/viewswitcher/i)?.[0] ?? null }).toEqual({ from, hit: null });
    }
  });
});

describe("the scene skill's frontmatter", () => {
  // Claude's skill upload (the site's skills/viewswitcher-scenes.zip) rejects malformed YAML frontmatter.
  test("is a YAML mapping with a name and a one-paragraph description", async () => {
    const text = await Bun.file(join(import.meta.dir, "../library-kit/skills/viewswitcher-scenes/SKILL.md")).text();
    const m = text.match(/^---\n([\s\S]*?)\n---\n/);
    expect(m).not.toBeNull();
    const fm = Bun.YAML.parse(m![1]!) as Record<string, unknown>;
    expect(Object.keys(fm).sort()).toEqual(["description", "name"]);
    expect(fm.name).toBe("viewswitcher-scenes");
    expect(typeof fm.description).toBe("string");
    // Every frontmatter line is a key: a stray unindented line would be a YAML error in strict parsers.
    for (const line of m![1]!.split("\n")) expect(line).toMatch(/^[a-z_]+: /);
  });
});
