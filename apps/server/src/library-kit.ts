// First run and upkeep of the library folder: the library kit (agent skill, CLAUDE.md, AGENTS.md,
// MCP configs, .gitignore), a git repo for a brand-new library, and a first org. Safe on every start:
// a library that already has everything is left exactly as it is. See library-kit/README.md.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomic } from "./atomic";
import { readPlainText } from "./library/contain";
import { createOrg, listOrgs } from "./library";

/** Kit file (in the repo's library-kit/) → where it goes in the library. */
export const KIT_FILES: { from: string; to: string }[] = [
  { from: "library-CLAUDE.md", to: "CLAUDE.md" },
  { from: "library-gitignore", to: ".gitignore" },
  { from: "skills/viewswitcher-scenes/SKILL.md", to: ".claude/skills/viewswitcher-scenes/SKILL.md" },
  // Agents other than Claude Code read AGENTS.md; the MCP configs connect Claude Code and Cursor
  // to the switcher when they're opened in the library.
  { from: "library-AGENTS.md", to: "AGENTS.md" },
  { from: "library-mcp.json", to: ".mcp.json" },
  { from: "library-cursor-mcp.json", to: ".cursor/mcp.json" },
];

export const FIRST_ORG = "My channel";

export type EnsureOptions = {
  kit: string;
  starter: string;
  firstOrg?: string;
  /** Makes `dir` a git repo; resolves false when git isn't available. Defaults to the system git. */
  gitInit?: (dir: string) => Promise<boolean>;
};

export type EnsureResult = {
  /** Library paths written from the kit because they were missing. */
  copied: string[];
  /** Kit files the library had unchanged from an older kit, brought up to date. */
  updated: string[];
  git: boolean;
  /** The org created because the library had none. */
  org: string | null;
};

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const KIT_STATE = ".viewswitcher/kit.json";

export async function ensureLibrary(root: string, { kit, starter, firstOrg = FIRST_ORG, gitInit = systemGitInit }: EnsureOptions): Promise<EnsureResult> {
  await mkdir(root, { recursive: true });
  const fresh = (await readdir(root)).filter((n) => n !== ".DS_Store").length === 0;
  const result: EnsureResult = { copied: [], updated: [], git: false, org: null };

  // Kit files: add what's missing; update only what the kit wrote and nobody changed since.
  const statePath = join(root, KIT_STATE);
  const state: { files?: Record<string, string> } = await readPlainText(statePath).then((t) => JSON.parse(t), () => ({}));
  const written: Record<string, string> = { ...(state.files ?? {}) };
  for (const { from, to } of KIT_FILES) {
    const text = await readPlainText(join(kit, from));
    const dest = join(root, to);
    // A kit file someone made a link (AGENTS.md → CLAUDE.md) is their arrangement: never replaced.
    if (await lstat(dest).then((s) => s.isSymbolicLink(), () => false)) continue;
    const current = await readPlainText(dest).catch(() => null);
    if (current === null) {
      await writeAtomic(dest, text);
      result.copied.push(to);
    } else if (current !== text && written[to] === sha(current)) {
      await writeAtomic(dest, text);
      result.updated.push(to);
    } else if (current !== text) {
      continue; // someone's own file, or one they've edited: never touched
    }
    written[to] = sha(text);
  }
  if (JSON.stringify(written) !== JSON.stringify(state.files ?? {})) {
    await writeAtomic(statePath, JSON.stringify({ files: written }, null, 2) + "\n");
  }

  if (fresh && !existsSync(join(root, ".git"))) result.git = await gitInit(root).catch(() => false);
  if ((await listOrgs(root)).length === 0) result.org = (await createOrg(root, starter, firstOrg)).orgId;
  return result;
}

/**
 * The git to use, or null. On macOS /usr/bin/git is a stub until the Command Line Tools are
 * installed, and running it pops an install dialog, so it only counts when xcode-select has a path.
 * Apps opened from Finder get a short PATH, so Homebrew's locations are checked too.
 */
export function findGit(): string | null {
  for (const git of ["/opt/homebrew/bin/git", "/usr/local/bin/git"]) if (existsSync(git)) return git;
  const git = Bun.which("git");
  if (!git) return null;
  if (process.platform === "darwin" && git === "/usr/bin/git") {
    return Bun.spawnSync(["/usr/bin/xcode-select", "-p"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0 ? git : null;
  }
  return git;
}

async function systemGitInit(dir: string) {
  const git = findGit();
  if (!git) return false;
  const p = Bun.spawn([git, "init", "--quiet"], { cwd: dir, stdout: "ignore", stderr: "ignore" });
  return (await p.exited) === 0;
}
