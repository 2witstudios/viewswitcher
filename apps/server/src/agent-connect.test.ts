import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeCommand, commandLine, detectClients, MCPB_LAUNCHER, mcpbFile, mcpbManifest, shellFolder, stdioLaunch } from "./agent-connect";

const HOME = "/Users/sam";
const detect = (files: string[], path = "/usr/bin:/bin") => detectClients({ home: HOME, path, exists: (p) => files.includes(p) });

describe("detectClients", () => {
  test("nothing installed", () => {
    expect(detect([])).toEqual({ claudeCode: false, claudeDesktop: false, cursor: false, codex: false, vscode: false });
  });
  test("apps in /Applications or ~/Applications", () => {
    expect(detect(["/Applications/Claude.app", `${HOME}/Applications/Cursor.app`, "/Applications/Visual Studio Code.app"])).toEqual({
      claudeCode: false, claudeDesktop: true, cursor: true, codex: false, vscode: true,
    });
    expect(detect(["/Applications/Codex.app"]).codex).toBe(true);
  });
  test("claude and codex on PATH, or where their installers put them when PATH is launchd's", () => {
    expect(detect(["/opt/tools/claude"], "/usr/bin:/opt/tools").claudeCode).toBe(true);
    expect(detect([`${HOME}/.local/bin/claude`]).claudeCode).toBe(true);
    expect(detect([`${HOME}/.claude/local/claude`]).claudeCode).toBe(true);
    expect(detect(["/opt/homebrew/bin/codex"]).codex).toBe(true);
    expect(detect(["/opt/tools/claude"]).claudeCode).toBe(false);
  });
  test("only booleans come out", () => {
    for (const v of Object.values(detect(["/Applications/Claude.app"]))) expect(typeof v).toBe("boolean");
  });
});

describe("commands", () => {
  test("stdio: the compiled sidecar, or bun with index.ts from source", () => {
    const app = "/Applications/ViewSwitcher.app/Contents/Helpers/viewswitcher-server";
    expect(stdioLaunch(app, null)).toEqual({ command: app, args: ["--mcp-stdio"] });
    expect(stdioLaunch("/opt/homebrew/bin/bun", "/src/vs/apps/server/src/index.ts")).toEqual({ command: "/opt/homebrew/bin/bun", args: ["/src/vs/apps/server/src/index.ts", "--mcp-stdio"] });
    expect(commandLine(stdioLaunch("/Volumes/My Disk/ViewSwitcher.app/Contents/Helpers/viewswitcher-server", null))).toBe("'/Volumes/My Disk/ViewSwitcher.app/Contents/Helpers/viewswitcher-server' --mcp-stdio");
  });
  test("Claude Code in the library folder, from ~ with spaces escaped", () => {
    expect(claudeCodeCommand(`${HOME}/ViewSwitcher Library`, HOME)).toBe("cd ~/ViewSwitcher\\ Library && claude");
    expect(claudeCodeCommand(`${HOME}/Shows/Sam's (2026)`, HOME)).toBe("cd ~/Shows/Sam\\'s\\ \\(2026\\) && claude");
    expect(claudeCodeCommand("/Volumes/Show Drive/Library", HOME)).toBe("cd /Volumes/Show\\ Drive/Library && claude");
    expect(shellFolder("/Users/samuel/x", HOME)).toBe("/Users/samuel/x");
  });
});

describe("the Claude Desktop extension (.mcpb)", () => {
  const launch = stdioLaunch("/Applications/ViewSwitcher.app/Contents/Helpers/viewswitcher-server", null);
  const manifest = mcpbManifest({ launch, port: 7421, version: "1.0.0" });

  test("an MCPB 0.3 manifest with the fields the spec requires", () => {
    expect(manifest.manifest_version).toBe("0.3");
    expect(manifest.name).toBe("viewswitcher");
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.description.length).toBeGreaterThan(0);
    expect(manifest.author.name).toBeTruthy();
    expect(manifest.server).toEqual({
      type: "binary",
      entry_point: MCPB_LAUNCHER,
      mcp_config: { command: launch.command, args: ["--mcp-stdio"], env: { PORT: "7421" } },
    });
    expect(manifest.compatibility.platforms).toEqual(["darwin"]);
  });

  test("unzips to the manifest and an executable launcher for the same command", () => {
    const dir = mkdtempSync(join(tmpdir(), "vs-mcpb-"));
    try {
      writeFileSync(join(dir, "viewswitcher.mcpb"), mcpbFile(manifest));
      expect(Bun.spawnSync(["unzip", "-q", join(dir, "viewswitcher.mcpb"), "-d", join(dir, "out")]).exitCode).toBe(0);
      expect(JSON.parse(readFileSync(join(dir, "out/manifest.json"), "utf8"))).toEqual(manifest);
      const launcher = join(dir, "out", MCPB_LAUNCHER);
      expect(statSync(launcher).mode & 0o111).toBe(0o111);
      expect(readFileSync(launcher, "utf8")).toContain("PORT=7421 exec /Applications/ViewSwitcher.app/Contents/Helpers/viewswitcher-server --mcp-stdio");
      expect(Bun.spawnSync(["sh", "-n", launcher]).exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
