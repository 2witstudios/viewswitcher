import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { nodeModulesDirs } from "./node-modules-dirs";

let repo = "";
function tree(workspaces: unknown, files: string[]) {
  repo = mkdtempSync(join(tmpdir(), "vs-nm-"));
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "root", workspaces }));
  for (const f of files) {
    mkdirSync(dirname(join(repo, f)), { recursive: true });
    writeFileSync(join(repo, f), "{}");
  }
}
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("nodeModulesDirs", () => {
  test("the root's and each workspace's", () => {
    tree(["apps/*", "packages/*"], ["apps/web/package.json", "apps/server/package.json", "packages/shared/package.json", ".pu/worktrees/x/apps/web/package.json", "apps/notes.txt"]);
    expect(nodeModulesDirs(repo)).toEqual(["apps/server/node_modules", "apps/web/node_modules", "node_modules", "packages/shared/node_modules"]);
  });

  test("Bun's object form and ** patterns, skipping packages inside node_modules", () => {
    // packages/.wt is a dot folder (another checkout, say): ** must not reach into it, as Bun doesn't.
    tree({ packages: ["packages/**"], catalog: {} }, ["packages/ui/package.json", "packages/ui/icons/package.json", "packages/ui/node_modules/dep/package.json", "packages/.wt/x/package.json"]);
    expect(nodeModulesDirs(repo)).toEqual(["node_modules", "packages/ui/icons/node_modules", "packages/ui/node_modules"]);
  });

  test("refuses what it can't clean for, instead of a short list", () => {
    tree([], []);
    expect(() => nodeModulesDirs(repo)).toThrow("no workspaces");
    rmSync(repo, { recursive: true, force: true });
    tree(["apps/*", "!apps/legacy"], ["apps/web/package.json"]);
    expect(() => nodeModulesDirs(repo)).toThrow("can't clean");
  });
});
