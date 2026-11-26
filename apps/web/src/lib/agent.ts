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

/** The port the Mac app always uses, and the one the library's .mcp.json and .cursor/mcp.json name. */
export const KIT_PORT = 7420;

/**
 * When the switcher runs on another port (a second copy, a test), the library's MCP configs, which
 * name 7420, don't reach it: what to tell people instead. Null on 7420.
 */
export function otherPortNote(port: number | string): string | null {
  if (Number(port) === KIT_PORT) return null;
  return `ViewSwitcher is on port ${port} here, but your library's .mcp.json and .cursor/mcp.json point at ${KIT_PORT}. Add the server by its address instead: in the library folder, claude mcp add --transport http viewswitcher ${mcpUrl(port)}`;
}

/** The stdio command where /api/info doesn't answer: the Mac app's sidecar on this port. */
export const defaultStdio = (port: number | string) => `/Applications/ViewSwitcher.app/Contents/Helpers/viewswitcher-server --mcp-stdio --port ${port}`;

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
 * What the sheet shows in each client. The iPad can't run an agent or install anything: status and a
 * pointer to the Mac only (the on-air setting is set on the Mac too). The setup guide link is for the
 * Mac app and desktop browsers.
 */
export function sheetParts(kind: ClientKind) {
  const ipad = kind === "ipad";
  return { waysIn: !ipad, connectOnMac: ipad, onAirSetting: !ipad, setupGuide: !ipad };
}

/** The setup guide on the site (MCP-11): how to connect each agent, step by step. */
export const SETUP_GUIDE_URL = "https://viewswitcher.com/ai";

// What agents may do to the show (apps/server/src/agent-guard.ts); people in the switcher are never limited.
/**
 * Runs tasks one after another, in the order they were asked for: the on-air setting's requests, so
 * Always then Never, clicked quickly, reach the server (whose writes are in order too) as Always, Never.
 */
export function inOrder() {
  let last: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = last.then(task, task);
    last = run.catch(() => {});
    return run;
  };
}

/** A choice the person made that the switcher hasn't published yet; `id` tells requests apart. */
export type PendingChoice = { value: AgentOnAir; id: number; answered: boolean } | null;

export type PendingEvent =
  | { t: "pick"; value: AgentOnAir; id: number }
  /** The request came back: `ok` false (refused, or no answer) drops the choice. */
  | { t: "answered"; id: number; ok: boolean }
  /** The switcher's state said this (it comes over the live socket, maybe after the HTTP answer). */
  | { t: "published"; value: AgentOnAir | undefined }
  /** A while after its answer: give up waiting (another device may have changed it meanwhile). */
  | { t: "expire"; id: number };

/**
 * The on-air radios' pending choice. From the click until the switcher publishes that value, the
 * radios show what was clicked, not the last published value: clicking back to the old choice is then
 * a real change, and is sent; and the radios never flick back to the old value between the HTTP answer
 * and the state arriving over the socket.
 */
export function pendingChoice(p: PendingChoice, e: PendingEvent): PendingChoice {
  switch (e.t) {
    case "pick":
      return { value: e.value, id: e.id, answered: false };
    case "answered":
      if (!p || p.id !== e.id) return p;
      return e.ok ? { ...p, answered: true } : null;
    case "published":
      return p && p.answered && e.value === p.value ? null : p;
    case "expire":
      return p && p.id === e.id ? null : p;
  }
}

/** What the radios show. */
export const shownChoice = (p: PendingChoice, published: AgentOnAir | undefined) => p?.value ?? published;

/** What the setting covers (Decisions: it steers agents through the tools; it isn't a lock on the files). */
export const ON_AIR_SCOPE = "This applies to agents working through ViewSwitcher's tools. An agent that edits the library's files directly isn't held to it.";

export const ON_AIR_CHOICES: { value: AgentOnAir; label: string; hint: string }[] = [
  { value: "never", label: "Never", hint: "Agents never put views on air, and can't change what's on air while you're live." },
  { value: "not-live", label: "When not live", hint: "Agents put views on air only while OBS isn't streaming or recording." },
  { value: "always", label: "Always", hint: "Agents may put views on air and change them at any time, even while you're live." },
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
