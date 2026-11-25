// POST /mcp on the real server (from source, OBS offline, no USB, a temp library), and who may use it:
// only this Mac's own agents. Plus handleMcp alone, for a peer that isn't loopback.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Subprocess } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, SERVER_START_MS, startServer } from "../test-server";
import type { AgentStatus } from "@viewswitcher/shared";
import type { Previewer } from "../preview-types";
import { clientName, handleMcp, noteSeen } from "./http";

/** A previewer for a server these tests never ask for pictures. */
const noPreview = (port: number): Previewer => ({
  scene: async (path) => ({ ok: false, reason: "Previews need OBS", url: `http://127.0.0.1:${port}/library/${encodeURI(path)}?preview` }),
  program: async () => ({ ok: false, reason: "Previews need OBS", url: `http://127.0.0.1:${port}/program` }),
});

let port = 0;
let proc: Subprocess;
const library = mkdtempSync(join(tmpdir(), "vs-mcp-http-"));

/** node:http, because it sends the Host header we give it (fetch derives it from the URL). */
function request(path: string, { method = "GET", headers = {} as Record<string, string>, body = "" } = {}) {
  return new Promise<{ status: number; body: string; type: string }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data, type: String(res.headers["content-type"] ?? "") }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

const MCP_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const initialize = (id = 1, name = "test-agent") => ({ jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name, version: "1" } } });
const mcp = (msg: unknown, headers: Record<string, string> = {}) => request("/mcp", { method: "POST", headers: { ...MCP_HEADERS, ...headers }, body: JSON.stringify(msg) });

beforeAll(async () => {
  port = await freePort();
  proc = await startServer({ PORT: String(port), OBS_URL: "ws://127.0.0.1:1", VIEWSWITCHER_USB: "0", VIEWSWITCHER_LIBRARY: library, VIEWSWITCHER_ORIGINS: "" }, () => request("/api/state").then((r) => r.status === 200));
}, SERVER_START_MS);
afterAll(() => {
  proc?.kill();
  rmSync(library, { recursive: true, force: true });
});

describe("POST /mcp from this Mac", () => {
  test("initialize, then tools/list, stateless with JSON responses", async () => {
    const init = await mcp(initialize());
    expect(init.status).toBe(200);
    expect(init.type).toContain("application/json");
    const r = JSON.parse(init.body);
    expect(r.result.serverInfo.name).toBe("viewswitcher");
    expect(r.result.instructions).toContain("get_guide");
    // No session: the next request is answered without one.
    const list = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(list.status).toBe(200);
    expect(JSON.parse(list.body).result.tools.map((t: { name: string }) => t.name)).toContain("write_file");
  });
  test("a tool call reads the real library, with org-prefixed paths and no absolute path", async () => {
    const r = await mcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "scan_library", arguments: { org: "my-channel" } } });
    expect(r.status).toBe(200);
    expect(r.body).toContain("my-channel/templates/brb.html");
    expect(r.body).not.toContain(library);
  });
  test("a notification gets 202 and no body", async () => {
    const r = await mcp({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(r.status).toBe(202);
  });
  test("the switcher's own page may call it (an allowed Origin)", async () => {
    expect((await mcp(initialize(), { origin: `http://127.0.0.1:${port}` })).status).toBe(200);
    expect((await mcp(initialize(), { origin: `http://localhost:${port}`, host: `localhost:${port}` })).status).toBe(200);
  });
  test("bad JSON is a JSON-RPC parse error; GET (no SSE stream when stateless) is 405", async () => {
    const r = await request("/mcp", { method: "POST", headers: MCP_HEADERS, body: "{nope" });
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).error.code).toBe(-32700);
    expect((await request("/mcp", { headers: { accept: "text/event-stream" } })).status).toBe(405);
    expect((await request("/mcp", { method: "DELETE" })).status).toBe(405);
  });
});

describe("POST /mcp refuses, without any MCP processing", () => {
  const refusedWithoutMcp = (r: { body: string }) => {
    const b = JSON.parse(r.body);
    expect(b.error).toBeString();
    expect(b.result).toBeUndefined();
    expect(b.jsonrpc).toBeUndefined();
  };
  test("a host this server isn't known by (DNS rebinding): 421", async () => {
    const r = await mcp(initialize(), { host: `evil.example:${port}` });
    expect(r.status).toBe(421);
  });
  // Refused by the pairing gate first (401 unpaired; 421 a name it isn't on), else by handleMcp (404).
  test("a trusted name that isn't loopback (the tailnet, Bonjour): refused", async () => {
    for (const host of ["mac.tail1234.ts.net", `studio.local:${port}`]) {
      const r = await mcp(initialize(), { host });
      expect([401, 404, 421]).toContain(r.status);
      refusedWithoutMcp(r);
    }
  });
  test("proxied (tailscale serve connects from loopback but adds forwarding headers): refused", async () => {
    for (const h of [{ "x-forwarded-for": "100.64.0.3" }, { "x-forwarded-host": "mac.tail1234.ts.net" }, { forwarded: "for=100.64.0.3" }] as Record<string, string>[]) {
      const r = await mcp(initialize(), h);
      expect([401, 404, 421]).toContain(r.status);
      refusedWithoutMcp(r);
    }
  });
  test("an Origin from another site: 403", async () => {
    for (const origin of ["https://evil.example", `http://evil.example:${port}`, "null", "file://"]) {
      const r = await mcp(initialize(), { origin });
      expect({ origin, status: r.status }).toEqual({ origin, status: 403 });
      refusedWithoutMcp(r);
    }
  });
  test("refused calls change nothing: agent status stays unseen by them", async () => {
    const before = JSON.parse((await request("/api/state")).body).agent.client;
    await mcp(initialize(9, "evil-agent"), { origin: "https://evil.example" });
    await mcp(initialize(9, "proxied-agent"), { "x-forwarded-for": "100.64.0.3" });
    expect(JSON.parse((await request("/api/state")).body).agent.client).toBe(before);
  });
});

describe("handleMcp from another machine", () => {
  test("a peer that isn't loopback is refused with 404, even with a loopback Host", async () => {
    let seen = 0;
    const deps = { root: library, kit: library, port, state: () => { throw new Error("not reached"); }, goOnAir: async () => { throw new Error("not reached"); }, renamed: async () => {}, previewer: noPreview(port) };
    const req = () => new Request(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { host: `127.0.0.1:${port}`, ...MCP_HEADERS }, body: JSON.stringify(initialize()) });
    for (const peer of [{ address: "192.168.1.20" }, { address: "100.64.0.3" }, { address: "" }, null]) {
      const r = await handleMcp(req(), peer, { deps, allowedOrigins: [], onSeen: () => seen++ });
      expect({ peer, status: r.status }).toEqual({ peer, status: 404 });
    }
    expect(seen).toBe(0);
  });
});

describe("handleMcp from the iPad on the USB-C bridge", () => {
  test("a bridged socket (loopback peer and Host, its port marked by usb-bridge.ts) is refused with 404", async () => {
    const { bridgePorts } = await import("../gate");
    let seen = 0;
    const deps = { root: library, kit: library, port, state: () => { throw new Error("not reached"); }, goOnAir: async () => { throw new Error("not reached"); }, renamed: async () => {}, previewer: noPreview(port) };
    const req = () => new Request(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { host: `127.0.0.1:${port}`, ...MCP_HEADERS }, body: JSON.stringify(initialize()) });
    bridgePorts.add(52001);
    try {
      expect((await handleMcp(req(), { address: "127.0.0.1", port: 52001 }, { deps, allowedOrigins: [], onSeen: () => seen++ })).status).toBe(404);
    } finally {
      bridgePorts.delete(52001);
    }
    expect(seen).toBe(0);
  });
});

describe("agent status", () => {
  test("initialize's clientInfo.name becomes LiveState.agent.client, with lastSeen", async () => {
    const t = Date.now();
    await mcp(initialize(5, "claude-code"));
    const a = JSON.parse((await request("/api/state")).body).agent;
    expect(a.client).toBe("claude-code");
    expect(a.lastSeen).toBeGreaterThanOrEqual(t - 1000);
  });
  test("noteSeen publishes only when the client changes or the last call was over a minute ago", () => {
    const fresh: AgentStatus = { onAir: "not-live", lastSeen: null, client: null };
    const a = noteSeen(fresh, "claude-code", 1_000_000);
    expect(a).toEqual({ agent: { onAir: "not-live", lastSeen: 1_000_000, client: "claude-code" }, publish: true });
    expect(noteSeen(a.agent, null, 1_030_000)).toEqual({ agent: { ...a.agent, lastSeen: 1_030_000 }, publish: false });
    expect(noteSeen(a.agent, "claude-code", 1_030_000).publish).toBe(false);
    expect(noteSeen(a.agent, "cursor", 1_030_000)).toEqual({ agent: { onAir: "not-live", lastSeen: 1_030_000, client: "cursor" }, publish: true });
    expect(noteSeen(a.agent, null, 1_060_001).publish).toBe(true);
  });
  test("clientName reads initialize, alone or in a batch", () => {
    expect(clientName(initialize(1, "cursor"))).toBe("cursor");
    expect(clientName([{ jsonrpc: "2.0", method: "ping", id: 1 }, initialize(2, "codex")])).toBe("codex");
    expect(clientName({ jsonrpc: "2.0", id: 1, method: "tools/list" })).toBeNull();
    expect(clientName(null)).toBeNull();
  });
});

describe("POST /api/agent/settings", () => {
  const set = (body: unknown, headers: Record<string, string> = {}) => request("/api/agent/settings", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  test("defaults to not-live, changes the setting, saves it in settings.json", async () => {
    expect(JSON.parse((await request("/api/state")).body).agent.onAir).toBe("not-live");
    const r = await set({ onAir: "never" });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).onAir).toBe("never");
    expect(JSON.parse((await request("/api/state")).body).agent.onAir).toBe("never");
    expect(JSON.parse(await readFile(join(library, ".viewswitcher/settings.json"), "utf8"))).toEqual({ agentOnAir: "never" });
    // The MCP side sees it straight away.
    const s = await mcp({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "get_state", arguments: {} } });
    expect(JSON.parse(JSON.parse(s.body).result.content[0].text).agent.onAir).toBe("never");
    await set({ onAir: "not-live" });
  });
  test("refuses a value that isn't one of the three, and other sites", async () => {
    expect((await set({ onAir: "sometimes" })).status).toBe(400);
    expect((await set({})).status).toBe(400);
    expect((await set({ onAir: "always" }, { origin: "https://evil.example" })).status).toBe(403);
    expect(JSON.parse((await request("/api/state")).body).agent.onAir).toBe("not-live");
  });
});
