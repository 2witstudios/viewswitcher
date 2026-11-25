import { describe, expect, test } from "bun:test";
import type { AgentClients, AgentStatus } from "@viewswitcher/shared";
import { agentStatusText, codexToml, cursorDeeplink, defaultStdio, mcpUrl, inOrder, ON_AIR_CHOICES, otherPortNote, pendingChoice, type PendingChoice, SETUP_GUIDE_URL, shownChoice, sheetParts, waysIn, wantsAgentSheet, withoutAgentSheet } from "./agent";

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

describe("the on-air setting's requests (CodeRabbit)", () => {
  test("go one at a time, in the order they were made, even when the first is slow or fails", async () => {
    const run = inOrder();
    const sent: string[] = [];
    const server: string[] = [];
    // A stand-in for POST /api/agent/settings: the first answer is slow, so unordered they'd land Never, Always.
    const post = (v: string, ms: number, fail = false) => () => {
      sent.push(v);
      return new Promise<void>((resolve, reject) => setTimeout(() => (server.push(v), fail ? reject(new Error("x")) : resolve()), ms));
    };
    const a = run(post("always", 30));
    const b = run(post("never", 1));
    expect(sent).toEqual([]); // nothing goes out in the same tick: the first waits for the queue too
    await Promise.all([a, b]);
    expect(sent).toEqual(["always", "never"]);
    expect(server).toEqual(["always", "never"]);
    await run(post("not-live", 5, true)).catch(() => {});
    await run(post("never", 1));
    expect(server.slice(-2)).toEqual(["not-live", "never"]);
  });
});

describe("the radios while a change is on its way (CodeRabbit)", () => {
  // The sheet's flow without React: the radios show shownChoice; a click on a radio that isn't shown
  // fires onChange, which picks, sends in order, and reports the answer; the published value arrives
  // separately (the live socket), here after the HTTP answer.
  function sheet() {
    let published: "never" | "not-live" | "always" = "never";
    let pending: PendingChoice = null;
    let id = 0;
    const run = inOrder();
    const server: string[] = [];
    const sent: Promise<void>[] = [];
    const publish = (v: typeof published) => {
      published = v;
      pending = pendingChoice(pending, { t: "published", value: v });
    };
    const click = (v: typeof published, fail = false) => {
      if (shownChoice(pending, published) === v) return; // a radio that's already shown fires no onChange
      const mine = ++id;
      pending = pendingChoice(pending, { t: "pick", value: v, id: mine });
      sent.push(
        run(async () => {
          await Bun.sleep(v === "always" ? 20 : 1);
          if (fail) throw new Error("refused");
          server.push(v);
        }).then(
          () => {
            pending = pendingChoice(pending, { t: "answered", id: mine, ok: true });
            setTimeout(() => publish(v), 5); // the socket's state lands after the HTTP answer
          },
          () => void (pending = pendingChoice(pending, { t: "answered", id: mine, ok: false })),
        ),
      );
    };
    return { click, shown: () => shownChoice(pending, published), done: () => Promise.all(sent).then(() => Bun.sleep(15)), server, pending: () => pending };
  }
  test("Never → click Always → click Never before Always is published: the second click is sent, and Never wins", async () => {
    const s = sheet();
    s.click("always");
    expect(s.shown()).toBe("always");
    s.click("never"); // the radios show Always, so this is a change
    expect(s.shown()).toBe("never");
    await s.done();
    expect(s.server).toEqual(["always", "never"]);
    expect(s.shown()).toBe("never");
    expect(s.pending()).toBeNull();
  });
  test("between the HTTP answer and the published state, the radios keep the new choice (no flick back)", async () => {
    const s = sheet();
    s.click("not-live");
    const seen: string[] = [];
    const watch = setInterval(() => seen.push(String(s.shown())), 1);
    await s.done();
    clearInterval(watch);
    expect(seen.filter((v, i) => v !== seen[i - 1])).toEqual(["not-live"]);
  });
  test("a refused change drops the pending choice: the radios show what's published", async () => {
    const s = sheet();
    s.click("always", true);
    await s.done();
    expect(s.pending()).toBeNull();
    expect(s.shown()).toBe("never");
  });
  test("an earlier answer doesn't clear a later pick; expire gives up waiting", () => {
    let p = pendingChoice(null, { t: "pick", value: "always", id: 1 });
    p = pendingChoice(p, { t: "pick", value: "never", id: 2 });
    p = pendingChoice(p, { t: "answered", id: 1, ok: true });
    expect(shownChoice(p, "always")).toBe("never");
    p = pendingChoice(p, { t: "answered", id: 2, ok: true });
    expect(pendingChoice(p, { t: "published", value: "always" })).toEqual(p); // not what was asked: keep waiting
    expect(pendingChoice(p, { t: "expire", id: 2 })).toBeNull();
    expect(pendingChoice(p, { t: "published", value: "never" })).toBeNull();
  });
});

describe("per client", () => {
  test("the iPad gets status and a pointer to the Mac only: no installs, no on-air setting, no setup guide link", () => {
    expect(sheetParts("ipad")).toEqual({ waysIn: false, connectOnMac: true, onAirSetting: false, setupGuide: false });
    expect(sheetParts("ipad").setupGuide).toBe(false);
  });
  test("the Mac app and browsers get the ways in, the setting and the setup guide link (viewswitcher.com/ai)", () => {
    expect(sheetParts("mac")).toEqual({ waysIn: true, connectOnMac: false, onAirSetting: true, setupGuide: true });
    expect(sheetParts("browser")).toEqual({ waysIn: true, connectOnMac: false, onAirSetting: true, setupGuide: true });
    expect(SETUP_GUIDE_URL).toBe("https://viewswitcher.com/ai");
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
