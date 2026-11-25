// The node_modules folders a release build empties before it installs bun.lock (build.sh): the root's
// and each workspace's, found the way Bun finds workspaces (package.json's "workspaces", either form).
//   bun apps/apple/scripts/node-modules-dirs.ts <repo>   prints one path per line, relative to <repo>
// It exits non-zero rather than print a short list, so build.sh never skips a folder in silence.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function nodeModulesDirs(repo: string): string[] {
  const { workspaces } = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  const patterns: unknown = Array.isArray(workspaces) ? workspaces : workspaces?.packages;
  if (!Array.isArray(patterns) || patterns.length === 0) throw new Error("package.json lists no workspaces");
  const dirs = new Set(["node_modules"]);
  for (const pattern of patterns) {
    if (typeof pattern !== "string" || pattern.startsWith("!") || pattern.includes("..")) {
      throw new Error(`can't clean for workspace pattern ${JSON.stringify(pattern)}`);
    }
    // A workspace is a folder with a package.json; Bun.Glob skips dot folders (.git, .pu/worktrees).
    for (const file of new Bun.Glob(`${pattern.replace(/\/+$/, "")}/package.json`).scanSync({ cwd: repo })) {
      if (file.split("/").includes("node_modules")) continue;
      dirs.add(join(file, "..", "node_modules"));
    }
  }
  return [...dirs].sort();
}

if (import.meta.main) {
  const repo = process.argv[2];
  if (!repo) throw new Error("usage: bun node-modules-dirs.ts <repo>");
  console.log(nodeModulesDirs(repo).join("\n"));
}
