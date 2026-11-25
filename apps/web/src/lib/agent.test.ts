import { describe, expect, test } from "bun:test";
import type { AgentClients, AgentStatus } from "@viewswitcher/shared";
import { agentStatusText, codexToml, cursorDeeplink, defaultStdio, mcpUrl, ON_AIR_CHOICES, otherPortNote, sheetParts, waysIn, wantsAgentSheet, withoutAgentSheet } from "./agent";

const NOW = 1_800_000_000_000;
const agent = (lastSeen: number | null, client: string | null = "claude-code"): AgentStatus => ({ onAir: "not-live", lastSeen, client });
const none: AgentClients = { claudeCode: false, claudeDesktop: false, cursor: false, codex: false, vscode: false };

describe("status line", () => {
  test("connected within 10 minutes, with the client and minutes", () => {
    expect(agentStatusText(agent(NOW - 3 * 60_000 - 5000), NOW)).toBe("Connected: Claude Code, 3 min ago");
    expect(agentStatusText(agent(NOW - 10 * 60_000, "cursor-vscode"), NOW)).toBe("Connected: Cursor, 10 min ago");
    expect(agentStatusText(agent(NOW - 20_000, "my-agent"), NOW)).toBe("Connected: my-agent, just now");
    expect(agentStatusText(agent(NOW - 60_000, null), NOW)).toBe("Connected: an agent, 1 min ago");
  });
  test("otherwise no agent yet", () => {
    expect(agentStatusText(agent(null, null), NOW)).toBe("No agent connected yet");
    expect(agentStatusText(agent(NOW - 10 * 60_000 - 1), NOW)).toBe("No agent connected yet");
    expect(agentStatusText(undefined, NOW)).toBe("No agent connected yet");
  });
});

describe("ways in", () => {
  test("Cursor's deeplink carries the server config as base64 JSON", () => {
    const link = cursorDeeplink(mcpUrl(7420));
    expect(link.startsWith("cursor://anysphere.cursor-deeplink/mcp/install?name=viewswitcher&config=")).toBe(true);
    const config = new URL(link).searchParams.get("config")!;
    expect(JSON.parse(atob(config))).toEqual({ url: "http://127.0.0.1:7420/mcp" });
  });
  test("Codex's TOML", () => {
    expect(codexToml(mcpUrl(7421))).toBe('[mcp_servers.viewswitcher]\nurl = "http://127.0.0.1:7421/mcp"');
  });
  test("installed apps first, otherwise the usual order; Others last unless Codex or VS Code is here", () => {
    expect(waysIn(null).map((w) => w.way)).toEqual(["claude-code", "claude-desktop", "cursor", "others"]);
    expect(waysIn({ ...none, cursor: true }).map((w) => w.way)).toEqual(["cursor", "claude-code", "claude-desktop", "others"]);
    expect(waysIn({ ...none, claudeDesktop: true, codex: true })).toEqual([
      { way: "claude-desktop", installed: true }, { way: "others", installed: true },
      { way: "claude-code", installed: false }, { way: "cursor", installed: false },
    ]);
  });
});

describe("ports (the kit's configs name 7420)", () => {
  test("no note on 7420; on another port, the address to add instead", () => {
    expect(otherPortNote(7420)).toBeNull();
    expect(otherPortNote("7420")).toBeNull();
    const note = otherPortNote(7433)!;
    expect(note).toContain("point at 7420");
    expect(note).toContain("claude mcp add --transport http viewswitcher http://127.0.0.1:7433/mcp");
  });
  test("the stdio command carries the port", () => {
    expect(defaultStdio(7433)).toBe("/Applications/ViewSwitcher.app/Contents/Helpers/viewswitcher-server --mcp-stdio --port 7433");
  });
});

describe("per client", () => {
  test("the iPad gets status and a pointer to the Mac only: no installs, no on-air setting, no built-in row", () => {
    expect(sheetParts("ipad")).toEqual({ waysIn: false, connectOnMac: true, onAirSetting: false, builtIn: false });
  });
  test("the Mac app and browsers get the ways in and the built-in row", () => {
    expect(sheetParts("mac")).toEqual({ waysIn: true, connectOnMac: false, onAirSetting: true, builtIn: true });
    expect(sheetParts("browser")).toEqual({ waysIn: true, connectOnMac: false, onAirSetting: true, builtIn: true });
  });
  test("three on-air choices, each with one line", () => {
    expect(ON_AIR_CHOICES.map((c) => [c.value, c.label])).toEqual([["never", "Never"], ["not-live", "When not live"], ["always", "Always"]]);
    for (const c of ON_AIR_CHOICES) expect(c.hint).not.toContain("\n");
  });
});

describe("opening from the Mac menu", () => {
  test("/?ai or #ai", () => {
    expect(wantsAgentSheet("?ai", "")).toBe(true);
    expect(wantsAgentSheet("?x=1&ai=", "")).toBe(true);
    expect(wantsAgentSheet("", "#ai")).toBe(true);
    expect(wantsAgentSheet("?aid=1", "#aim")).toBe(false);
  });
  test("and the URL loses it", () => {
    expect(withoutAgentSheet("?ai", "")).toEqual({ search: "", hash: "" });
    expect(withoutAgentSheet("?path=a%2Fb.html&ai", "#ai")).toEqual({ search: "?path=a%2Fb.html", hash: "" });
    expect(withoutAgentSheet("", "#top")).toEqual({ search: "", hash: "#top" });
  });
});
