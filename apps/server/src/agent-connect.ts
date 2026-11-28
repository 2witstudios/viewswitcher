// How an agent on this computer connects (the switcher's Edit with AI sheet): which agent apps are
// installed, the stdio command, the Claude Code command, and the Claude Desktop extension (.mcpb).
// Everything here can contain absolute paths, so main.ts answers with it only to this computer (a mac route, gate.ts isMac),
// and /api/agent/clients turns it into booleans. macOS and Windows differ in where apps live, in how
// a shell quotes a word, and in the .mcpb's launcher; `platform` picks (process.platform by default).
import { posix, win32 } from "node:path";
import type { AgentClients } from "@viewswitcher/shared";
import { storedZip } from "@viewswitcher/packs";

type Platform = NodeJS.Platform;
const isWin = (p: Platform) => p === "win32";

export type DetectEnv = {
  home: string;
  /** $PATH (%PATH% on Windows). */
  path: string;
  exists: (path: string) => boolean;
  /** %LOCALAPPDATA%, %ProgramFiles% and %APPDATA% on Windows (defaults under the home folder and C:\Program Files). */
  localAppData?: string;
  programFiles?: string;
  appData?: string;
  platform?: Platform;
};

/**
 * Where command-line agents usually live. The Mac app starts the server from launchd, whose PATH is
 * only /usr/bin:/bin:/usr/sbin:/sbin, so $PATH alone misses an installed `claude`.
 */
const binDirs = (home: string) => [posix.join(home, ".local/bin"), posix.join(home, ".claude/local"), "/opt/homebrew/bin", "/usr/local/bin", posix.join(home, ".bun/bin"), posix.join(home, ".npm-global/bin")];

function detectMac(env: DetectEnv): AgentClients {
  const appDirs = ["/Applications", posix.join(env.home, "Applications")];
  const app = (name: string) => appDirs.some((d) => env.exists(posix.join(d, `${name}.app`)));
  const dirs = [...new Set([...env.path.split(":").filter(Boolean), ...binDirs(env.home)])];
  const bin = (name: string) => dirs.some((d) => env.exists(posix.join(d, name)));
  return {
    claudeCode: bin("claude"),
    claudeDesktop: app("Claude"),
    cursor: app("Cursor"),
    codex: app("Codex") || bin("codex"),
    vscode: app("Visual Studio Code"),
  };
}

/**
 * On Windows: command-line agents on %PATH% (or where their installers put them: ~\.local\bin for
 * Claude Code's, npm's global folder for both), as .exe or the .cmd shims npm writes; apps under
 * %LOCALAPPDATA%\Programs (per-user installs), %LOCALAPPDATA%\AnthropicClaude (Claude Desktop) or
 * Program Files.
 */
function detectWindows(env: DetectEnv): AgentClients {
  const j = win32.join;
  const local = env.localAppData || j(env.home, "AppData", "Local");
  const roaming = env.appData || j(env.home, "AppData", "Roaming");
  const programs = env.programFiles || "C:\\Program Files";
  const dirs = [...new Set([...env.path.split(";").filter(Boolean), j(env.home, ".local", "bin"), j(roaming, "npm"), j(env.home, ".bun", "bin")])];
  const bin = (name: string) => dirs.some((d) => [".exe", ".cmd"].some((ext) => env.exists(j(d, name + ext))));
  const anyOf = (...paths: string[]) => paths.some((p) => env.exists(p));
  return {
    claudeCode: bin("claude"),
    claudeDesktop: anyOf(j(local, "AnthropicClaude", "claude.exe"), j(local, "Programs", "Claude", "Claude.exe"), j(programs, "Claude", "Claude.exe")),
    cursor: anyOf(j(local, "Programs", "cursor", "Cursor.exe"), j(programs, "Cursor", "Cursor.exe")),
    codex: bin("codex") || anyOf(j(local, "Programs", "Codex", "Codex.exe")),
    vscode: anyOf(j(local, "Programs", "Microsoft VS Code", "Code.exe"), j(programs, "Microsoft VS Code", "Code.exe")),
  };
}

export function detectClients(env: DetectEnv): AgentClients {
  return isWin(env.platform ?? process.platform) ? detectWindows(env) : detectMac(env);
}

/**
 * What an agent runs for the stdio connection: this server's own executable with --mcp-stdio and the
 * port it listens on (never PORT, which the agent's own environment may have for something else). In
 * the apps that's the compiled server (`entry` null); from source it's bun with index.ts.
 */
export function stdioLaunch(execPath: string, entry: string | null, port: number): { command: string; args: string[] } {
  return { command: execPath, args: [...(entry ? [entry] : []), "--mcp-stdio", "--port", String(port)] };
}

/**
 * Whether this server runs compiled (bun build --compile), where import.meta.dir is inside the binary:
 * /$bunfs/… on macOS, B:\~BUN\… on Windows.
 */
export const compiled = (dir: string) => dir.startsWith("/$bunfs") || /^[A-Za-z]:[\\/]~BUN[\\/]/.test(dir);

/** One word for a shell: as it is when that's safe, else quoted (single quotes for sh; double quotes on Windows, where cmd, PowerShell and agents' configs all read them). */
export function shellWord(s: string, platform: Platform = process.platform): string {
  if (isWin(platform)) return /^[\w@%+=:,.\\/-]+$/.test(s) ? s : `"${s.replaceAll('"', '\\"')}"`;
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`;
}

/** A folder for `cd`, from the home folder as ~ when it's in there (`~/ViewSwitcher\ Library`). */
export function shellFolder(path: string, home: string): string {
  const escape = (p: string) => p.replace(/[^\w@%+=:,./-]/g, (c) => `\\${c}`);
  if (path === home) return "~";
  if (home && path.startsWith(`${home}/`)) return `~/${escape(path.slice(home.length + 1))}`;
  return escape(path);
}

export function commandLine(launch: { command: string; args: string[] }, platform: Platform = process.platform): string {
  return [launch.command, ...launch.args].map((w) => shellWord(w, platform)).join(" ");
}

/**
 * Claude Code started in the library, where its .mcp.json connects it to the switcher. On Windows, for
 * PowerShell (Windows Terminal's shell; both 5.1 and 7 read it): a single-quoted path, quotes doubled.
 */
export function claudeCodeCommand(library: string, home: string, platform: Platform = process.platform): string {
  if (isWin(platform)) return `Set-Location '${library.replaceAll("'", "''")}'; claude`;
  return `cd ${shellFolder(library, home)} && claude`;
}

/** Inside the bundle: MCPB requires an entry point in it, so it carries a launcher for the real command. */
export const MCPB_LAUNCHER = "server/viewswitcher";
/** Windows runs a .cmd launcher, not a shell script. */
export const MCPB_LAUNCHER_WINDOWS = "server/viewswitcher.cmd";

/**
 * The Claude Desktop extension's manifest (MCPB 0.3, github.com/modelcontextprotocol/mcpb, MANIFEST.md).
 * A "binary" server whose command is this install's own executable, so the bundle carries no code of
 * ours, only a launcher script for the required entry point. The command carries the port (stdioLaunch).
 * It's made for the computer it's downloaded on, so it names that one platform.
 */
export function mcpbManifest(o: { launch: { command: string; args: string[] }; version: string; platform?: Platform }) {
  const win = isWin(o.platform ?? process.platform);
  const computer = win ? "this PC" : "this Mac";
  return {
    manifest_version: "0.3",
    name: "viewswitcher",
    display_name: "ViewSwitcher",
    version: o.version,
    description: "Edit your ViewSwitcher views and see them rendered, from Claude.",
    long_description:
      `Connects Claude to ViewSwitcher on ${computer}: it reads your library, edits views under the same rules as the switcher, looks at a rendered picture of its work in OBS, and puts a view on air only when your on-air setting allows it. ViewSwitcher must be open.`,
    author: { name: "ViewSwitcher", url: "https://viewswitcher.com" },
    homepage: "https://viewswitcher.com",
    support: "https://viewswitcher.com/support",
    server: {
      type: "binary",
      entry_point: win ? MCPB_LAUNCHER_WINDOWS : MCPB_LAUNCHER,
      mcp_config: { command: o.launch.command, args: o.launch.args },
    },
    compatibility: { platforms: [win ? "win32" : "darwin"] },
  };
}

/** The .mcpb file: a zip with the manifest and the launcher. */
export function mcpbFile(manifest: ReturnType<typeof mcpbManifest>): Uint8Array {
  const { command, args } = manifest.server.mcp_config;
  const win = manifest.compatibility.platforms[0] === "win32";
  const launcher = win
    ? `@echo off\r\nrem ViewSwitcher's MCP connection on this PC (the same command as manifest.json).\r\n${commandLine({ command, args }, "win32")}\r\n`
    : `#!/bin/sh\n# ViewSwitcher's MCP connection on this Mac (the same command as manifest.json).\nexec ${commandLine({ command, args }, "darwin")}\n`;
  return storedZip([
    { name: "manifest.json", data: `${JSON.stringify(manifest, null, 2)}\n` },
    { name: manifest.server.entry_point, data: launcher, executable: true },
  ]);
}
