// How an agent on this Mac connects (the switcher's Edit with AI sheet, MCP-10): which agent apps are
// installed, the stdio command, the Claude Code command, and the Claude Desktop extension (.mcpb).
// Everything here can contain absolute paths, so main.ts answers with it only to this Mac (local.ts),
// and /api/agent/clients turns it into booleans.
import { join } from "node:path";
import type { AgentClients } from "@viewswitcher/shared";
import { storedZip } from "./zip";

export type DetectEnv = {
  home: string;
  /** $PATH. */
  path: string;
  exists: (path: string) => boolean;
};

/**
 * Where command-line agents usually live. The Mac app starts the server from launchd, whose PATH is
 * only /usr/bin:/bin:/usr/sbin:/sbin, so $PATH alone misses an installed `claude`.
 */
const binDirs = (home: string) => [join(home, ".local/bin"), join(home, ".claude/local"), "/opt/homebrew/bin", "/usr/local/bin", join(home, ".bun/bin"), join(home, ".npm-global/bin")];

export function detectClients(env: DetectEnv): AgentClients {
  const appDirs = ["/Applications", join(env.home, "Applications")];
  const app = (name: string) => appDirs.some((d) => env.exists(join(d, `${name}.app`)));
  const dirs = [...new Set([...env.path.split(":").filter(Boolean), ...binDirs(env.home)])];
  const bin = (name: string) => dirs.some((d) => env.exists(join(d, name)));
  return {
    claudeCode: bin("claude"),
    claudeDesktop: app("Claude"),
    cursor: app("Cursor"),
    codex: app("Codex") || bin("codex"),
    vscode: app("Visual Studio Code"),
  };
}

/**
 * What an agent runs for the stdio connection: this server's own executable with --mcp-stdio and the
 * port it listens on (never PORT, which the agent's own environment may have for something else). In
 * the Mac app that's the compiled sidecar (`entry` null); from source it's bun with index.ts.
 */
export function stdioLaunch(execPath: string, entry: string | null, port: number): { command: string; args: string[] } {
  return { command: execPath, args: [...(entry ? [entry] : []), "--mcp-stdio", "--port", String(port)] };
}

/** One word for a shell: as it is when that's safe, else in single quotes. */
export function shellWord(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`;
}

/** A folder for `cd`, from the home folder as ~ when it's in there (`~/ViewSwitcher\ Library`). */
export function shellFolder(path: string, home: string): string {
  const escape = (p: string) => p.replace(/[^\w@%+=:,./-]/g, (c) => `\\${c}`);
  if (path === home) return "~";
  if (home && path.startsWith(`${home}/`)) return `~/${escape(path.slice(home.length + 1))}`;
  return escape(path);
}

export function commandLine(launch: { command: string; args: string[] }): string {
  return [launch.command, ...launch.args].map(shellWord).join(" ");
}

/** Claude Code started in the library, where its .mcp.json connects it to the switcher. */
export function claudeCodeCommand(library: string, home: string): string {
  return `cd ${shellFolder(library, home)} && claude`;
}

/** Inside the bundle: MCPB requires an entry point in it, so it carries a launcher for the real command. */
export const MCPB_LAUNCHER = "server/viewswitcher";

/**
 * The Claude Desktop extension's manifest (MCPB 0.3, github.com/modelcontextprotocol/mcpb, MANIFEST.md).
 * A "binary" server whose command is this install's own executable, so the bundle carries no code of
 * ours, only a launcher script for the required entry point. The command carries the port (stdioLaunch).
 */
export function mcpbManifest(o: { launch: { command: string; args: string[] }; version: string }) {
  return {
    manifest_version: "0.3",
    name: "viewswitcher",
    display_name: "ViewSwitcher",
    version: o.version,
    description: "Edit your ViewSwitcher scenes and see them rendered, from Claude.",
    long_description:
      "Connects Claude to ViewSwitcher on this Mac: it reads your scene library, edits scenes under the same rules as the switcher, looks at a rendered picture of its work in OBS, and puts a scene on air only when your on-air setting allows it. ViewSwitcher must be open.",
    author: { name: "ViewSwitcher", url: "https://viewswitcher.com" },
    homepage: "https://viewswitcher.com",
    support: "https://viewswitcher.com/support",
    server: {
      type: "binary",
      entry_point: MCPB_LAUNCHER,
      mcp_config: { command: o.launch.command, args: o.launch.args },
    },
    compatibility: { platforms: ["darwin"] },
  };
}

/** The .mcpb file: a zip with the manifest and the launcher. */
export function mcpbFile(manifest: ReturnType<typeof mcpbManifest>): Uint8Array {
  const { command, args } = manifest.server.mcp_config;
  const launcher = `#!/bin/sh\n# ViewSwitcher's MCP connection on this Mac (the same command as manifest.json).\nexec ${commandLine({ command, args })}\n`;
  return storedZip([
    { name: "manifest.json", data: `${JSON.stringify(manifest, null, 2)}\n` },
    { name: MCPB_LAUNCHER, data: launcher, executable: true },
  ]);
}
