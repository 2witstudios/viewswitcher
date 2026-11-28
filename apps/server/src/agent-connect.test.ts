import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listZip, readZipEntrySync } from "@viewswitcher/packs";
import { claudeCodeCommand, commandLine, compiled, detectClients, MCPB_LAUNCHER, MCPB_LAUNCHER_WINDOWS, mcpbFile, mcpbManifest, shellFolder, stdioLaunch } from "./agent-connect";
import { posix } from "../../../test-links";

const HOME = "/Users/sam";
const detect = (files: string[], path = "/usr/bin:/bin") => detectClients({ home: HOME, path, exists: (p) => files.includes(p), platform: "darwin" });

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

describe("detectClients on Windows", () => {
  const WHOME = "C:\\Users\\sam";
  const LOCAL = `${WHOME}\\AppData\\Local`;
  const win = (files: string[], path = "C:\\Windows\\System32;C:\\Windows") =>
    detectClients({ home: WHOME, path, exists: (p) => files.includes(p), platform: "win32", localAppData: LOCAL, programFiles: "C:\\Program Files", appData: `${WHOME}\\AppData\\Roaming` });
  test("nothing installed", () => {
    expect(win([])).toEqual({ claudeCode: false, claudeDesktop: false, cursor: false, codex: false, vscode: false });
  });
  test("apps where their Windows installers put them", () => {
    expect(win([`${LOCAL}\\AnthropicClaude\\claude.exe`, `${LOCAL}\\Programs\\cursor\\Cursor.exe`, `${LOCAL}\\Programs\\Microsoft VS Code\\Code.exe`])).toEqual({
      claudeCode: false, claudeDesktop: true, cursor: true, codex: false, vscode: true,
    });
    expect(win(["C:\\Program Files\\Microsoft VS Code\\Code.exe"]).vscode).toBe(true);
  });
  test("claude and codex on %PATH% (;-separated), as .exe or npm's .cmd, or in Claude Code's own folder", () => {
    expect(win(["D:\\tools\\claude.exe"], "C:\\Windows;D:\\tools").claudeCode).toBe(true);
    expect(win([`${WHOME}\\.local\\bin\\claude.exe`]).claudeCode).toBe(true);
    expect(win([`${WHOME}\\AppData\\Roaming\\npm\\codex.cmd`]).codex).toBe(true);
    expect(win(["D:\\tools\\claude.exe"]).claudeCode).toBe(false);
    expect(win(["D:\\tools\\claude"], "D:\\tools").claudeCode).toBe(false); // no extension: not something Windows runs
  });
});

describe("commands", () => {
  test("stdio: the compiled sidecar, or bun with index.ts from source, with the server's port", () => {
    const app = "/Applications/ViewSwitcher.app/Contents/Helpers/viewswitcher-server";
    expect(stdioLaunch(app, null, 7420)).toEqual({ command: app, args: ["--mcp-stdio", "--port", "7420"] });
    expect(stdioLaunch("/opt/homebrew/bin/bun", "/src/vs/apps/server/src/index.ts", 7433)).toEqual({ command: "/opt/homebrew/bin/bun", args: ["/src/vs/apps/server/src/index.ts", "--mcp-stdio", "--port", "7433"] });
    expect(commandLine(stdioLaunch("/Volumes/My Disk/ViewSwitcher.app/Contents/Helpers/viewswitcher-server", null, 7420), "darwin")).toBe("'/Volumes/My Disk/ViewSwitcher.app/Contents/Helpers/viewswitcher-server' --mcp-stdio --port 7420");
  });
  test("stdio on Windows: double quotes around a path with spaces, backslashes as they are", () => {
    const exe = "C:\\Users\\Sam Lee\\AppData\\Local\\ViewSwitcher\\current\\Helpers\\viewswitcher-server.exe";
    expect(commandLine(stdioLaunch(exe, null, 7420), "win32")).toBe(`"${exe}" --mcp-stdio --port 7420`);
    expect(commandLine(stdioLaunch("C:\\vs\\Helpers\\viewswitcher-server.exe", null, 7420), "win32")).toBe("C:\\vs\\Helpers\\viewswitcher-server.exe --mcp-stdio --port 7420");
  });
  test("compiled: inside the binary on macOS (/$bunfs) and Windows (B:\\~BUN), not from source", () => {
    expect(compiled("/$bunfs/root")).toBe(true);
    expect(compiled("B:\\~BUN\\root")).toBe(true);
    expect(compiled("/src/vs/apps/server/src")).toBe(false);
    expect(compiled("C:\\Users\\sam\\vs\\apps\\server\\src")).toBe(false);
  });
  test("Claude Code in the library folder, from ~ with spaces escaped", () => {
    expect(claudeCodeCommand(`${HOME}/ViewSwitcher Library`, HOME, "darwin")).toBe("cd ~/ViewSwitcher\\ Library && claude");
    expect(claudeCodeCommand(`${HOME}/Shows/Sam's (2026)`, HOME, "darwin")).toBe("cd ~/Shows/Sam\\'s\\ \\(2026\\) && claude");
    expect(claudeCodeCommand("/Volumes/Show Drive/Library", HOME, "darwin")).toBe("cd /Volumes/Show\\ Drive/Library && claude");
    expect(shellFolder("/Users/samuel/x", HOME)).toBe("/Users/samuel/x");
  });
  test("Claude Code on Windows: PowerShell, the folder single-quoted with quotes doubled", () => {
    expect(claudeCodeCommand("C:\\Users\\sam\\ViewSwitcher Library", "C:\\Users\\sam", "win32")).toBe("Set-Location 'C:\\Users\\sam\\ViewSwitcher Library'; claude");
    expect(claudeCodeCommand("D:\\Sam's Shows", "C:\\Users\\sam", "win32")).toBe("Set-Location 'D:\\Sam''s Shows'; claude");
  });
});

describe("the Claude Desktop extension (.mcpb)", () => {
  const launch = stdioLaunch("/Applications/ViewSwitcher.app/Contents/Helpers/viewswitcher-server", null, 7421);
  const manifest = mcpbManifest({ launch, version: "1.0.0", platform: "darwin" });

  test("an MCPB 0.3 manifest with the fields the spec requires", () => {
    expect(manifest.manifest_version).toBe("0.3");
    expect(manifest.name).toBe("viewswitcher");
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.description.length).toBeGreaterThan(0);
    expect(manifest.author.name).toBeTruthy();
    expect(manifest.server).toEqual({
      type: "binary",
      entry_point: MCPB_LAUNCHER,
      mcp_config: { command: launch.command, args: ["--mcp-stdio", "--port", "7421"] },
    });
    expect(manifest.compatibility.platforms).toEqual(["darwin"]);
  });

  test.skipIf(!posix)("unzips to the manifest and an executable launcher for the same command", () => {
    const dir = mkdtempSync(join(tmpdir(), "vs-mcpb-"));
    try {
      writeFileSync(join(dir, "viewswitcher.mcpb"), mcpbFile(manifest));
      expect(Bun.spawnSync(["unzip", "-q", join(dir, "viewswitcher.mcpb"), "-d", join(dir, "out")]).exitCode).toBe(0);
      expect(JSON.parse(readFileSync(join(dir, "out/manifest.json"), "utf8"))).toEqual(manifest);
      const launcher = join(dir, "out", MCPB_LAUNCHER);
      expect(statSync(launcher).mode & 0o111).toBe(0o111);
      expect(readFileSync(launcher, "utf8")).toContain("\nexec /Applications/ViewSwitcher.app/Contents/Helpers/viewswitcher-server --mcp-stdio --port 7421\n");
      expect(Bun.spawnSync(["sh", "-n", launcher]).exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("on Windows: made for win32, with a .cmd launcher that runs the same command", () => {
    const exe = "C:\\Users\\Sam Lee\\AppData\\Local\\ViewSwitcher\\current\\Helpers\\viewswitcher-server.exe";
    const m = mcpbManifest({ launch: stdioLaunch(exe, null, 7420), version: "1.0.0", platform: "win32" });
    expect(m.compatibility.platforms).toEqual(["win32"]);
    expect(m.server.entry_point).toBe(MCPB_LAUNCHER_WINDOWS);
    expect(m.server.mcp_config).toEqual({ command: exe, args: ["--mcp-stdio", "--port", "7420"] });
    expect(m.long_description).toContain("this PC");
    const zip = mcpbFile(m);
    const entries = listZip(zip);
    expect(entries.map((e) => e.name).sort()).toEqual(["manifest.json", MCPB_LAUNCHER_WINDOWS]);
    const text = (name: string) => new TextDecoder().decode(readZipEntrySync(zip, entries.find((e) => e.name === name)!));
    expect(JSON.parse(text("manifest.json"))).toEqual(m);
    expect(text(MCPB_LAUNCHER_WINDOWS)).toBe(`@echo off\r\nrem ViewSwitcher's MCP connection on this PC (the same command as manifest.json).\r\n"${exe}" --mcp-stdio --port 7420\r\n`);
  });
});
