// Edit with AI (MCP-10, MCP-11): what the sheet says and offers, apart from React.
import type { AgentClients, AgentOnAir, AgentStatus } from "@viewswitcher/shared";
import type { ClientKind } from "./client-kind";

/** An agent counts as connected for this long after its last MCP call. */
export const CONNECTED_FOR_MS = 10 * 60_000;

/** MCP clients' own names (their initialize clientInfo.name) as people know them. */
const CLIENT_NAMES: Record<string, string> = {
  "claude-code": "Claude Code",
  "claude-ai": "Claude Desktop",
  "cursor-vscode": "Cursor",
  "codex-mcp-client": "Codex",
  "codex_cli_rs": "Codex",
  "Visual Studio Code": "VS Code",
};
export const clientLabel = (name: string) => CLIENT_NAMES[name] ?? name;

export function agentStatusText(agent: AgentStatus | undefined, now: number): string {
  if (!agent?.lastSeen || now - agent.lastSeen > CONNECTED_FOR_MS) return "No agent connected yet";
  const min = Math.floor(Math.max(0, now - agent.lastSeen) / 60_000);
  const who = agent.client ? clientLabel(agent.client) : "an agent";
  return `Connected: ${who}, ${min < 1 ? "just now" : `${min} min ago`}`;
}

export const mcpUrl = (port: number | string) => `http://127.0.0.1:${port}/mcp`;

/** Cursor's install link (cursor.com/docs/mcp/install-links): the server's config, as JSON in base64. */
export function cursorDeeplink(url: string): string {
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=viewswitcher&config=${encodeURIComponent(btoa(JSON.stringify({ url })))}`;
}

/** For ~/.codex/config.toml (the same as the library's AGENTS.md says). */
export const codexToml = (url: string) => `[mcp_servers.viewswitcher]\nurl = "${url}"`;

/** Before /api/info answers, or where it doesn't (another machine): the default library folder. */
export const DEFAULT_CLAUDE_CODE = "cd ~/ViewSwitcher\\ Library && claude";

export type Way = "claude-code" | "claude-desktop" | "cursor" | "others";
const WAYS: Way[] = ["claude-code", "claude-desktop", "cursor", "others"];
const installed = (w: Way, c: AgentClients) =>
  w === "claude-code" ? c.claudeCode : w === "claude-desktop" ? c.claudeDesktop : w === "cursor" ? c.cursor : c.codex || c.vscode;

/** Every way in, the ones whose app this Mac has first (otherwise in the usual order). */
export function waysIn(clients: AgentClients | null): { way: Way; installed: boolean }[] {
  const all = WAYS.map((way) => ({ way, installed: !!clients && installed(way, clients) }));
  return [...all.filter((w) => w.installed), ...all.filter((w) => !w.installed)];
}

/**
 * What the sheet shows in each client. The iPad can't run an agent or install anything: status and
 * the setting, and a pointer to the Mac. The built-in AI row is for the Mac app and desktop browsers.
 */
export function sheetParts(kind: ClientKind) {
  const ipad = kind === "ipad";
  return { waysIn: !ipad, connectOnMac: ipad, builtIn: !ipad };
}

export const BUILT_IN_URL = "https://viewswitcher.com/ai";

// What agents may do to the show (apps/server/src/agent-guard.ts); people in the switcher are never limited.
export const ON_AIR_CHOICES: { value: AgentOnAir; label: string; hint: string }[] = [
  { value: "never", label: "Never", hint: "Agents never put scenes on air, and can't change what's on air while you're live." },
  { value: "not-live", label: "When not live", hint: "Agents put scenes on air only while OBS isn't streaming or recording." },
  { value: "always", label: "Always", hint: "Agents may put scenes on air and change them at any time, even while you're live." },
];

/** The sheet opens on its own for /?ai or #ai: the Mac app's Edit with AI… menu item. */
export const wantsAgentSheet = (search: string, hash: string) => new URLSearchParams(search).has("ai") || hash === "#ai";

/** The same URL without the ?ai or #ai that opened the sheet. */
export function withoutAgentSheet(search: string, hash: string): { search: string; hash: string } {
  const q = new URLSearchParams(search);
  q.delete("ai");
  const s = q.toString();
  return { search: s ? `?${s}` : "", hash: hash === "#ai" ? "" : hash };
}
