// Edit with AI's endpoints on the real server (from source, OBS offline, no USB, a temp library):
// /api/info's commands, /api/agent/clients and the Claude Desktop extension answer only this Mac.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Subprocess } from "bun";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { listZip, readZipEntrySync } from "@viewswitcher/packs";
import { commandLine } from "./agent-connect";
import { freePort, SERVER_START_MS, startServer } from "./test-server";

const WINDOWS = process.platform === "win32";
/** The same text, ignoring case on Windows, whose paths are case-insensitive. */
const same = (a: string, b: string) => (WINDOWS ? a.toLowerCase() === b.toLowerCase() : a === b);

let port = 0;
let proc: Subprocess;
const library = mkdtempSync(join(tmpdir(), "vs-agent-endpoints-"));
const scratch = mkdtempSync(join(tmpdir(), "vs-agent-mcpb-"));

/** node:http, because it sends the Host header we give it (fetch derives it from the URL). */
function request(path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: Uint8Array; type: string; disposition: string }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks: Uint8Array[] = [];
      res.on("data", (c: Uint8Array) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: new Uint8Array(Buffer.concat(chunks)), type: String(res.headers["content-type"] ?? ""), disposition: String(res.headers["content-disposition"] ?? "") }));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  port = await freePort();
  proc = await startServer({ PORT: String(port), OBS_URL: "ws://127.0.0.1:1", VIEWSWITCHER_USB: "0", VIEWSWITCHER_LIBRARY: library, VIEWSWITCHER_ORIGINS: "", VIEWSWITCHER_PARENT_PID: "" }, () => request("/api/state").then((r) => r.status === 200));
}, SERVER_START_MS);
afterAll(() => {
  proc?.kill();
  rmSync(library, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

const PATHS = ["/api/info", "/api/agent/clients", "/api/agent/viewswitcher.mcpb"];

describe("from this Mac", () => {
  test("/api/info has the Claude Code and stdio commands for this install", async () => {
    const info = JSON.parse(new TextDecoder().decode((await request("/api/info")).body));
    expect(info.library).toBe(library);
    expect(info.claudeCode).toEndWith(WINDOWS ? "; claude" : " && claude");
    expect(info.claudeCode).toContain(basename(library));
    // From source: bun with index.ts. (Windows paths match whatever their case: the server may see C:\Users\x\Dev where this test sees dev.)
    expect(same(info.stdio, commandLine({ command: process.execPath, args: [join(import.meta.dir, "index.ts"), "--mcp-stdio", "--port", String(port)] }))).toBe(true);
  });

  test("/api/info says whether the Mac app started this server, and which process it is", async () => {
    const info = JSON.parse(new TextDecoder().decode((await request("/api/info")).body));
    // Started from source by this test, not by the app: not a sidecar, so a relaunched app attaches to it.
    expect(info).toMatchObject({ sidecar: false, parentPid: null, pid: proc.pid });
  });

  test("/api/agent/clients is the five booleans", async () => {
    const r = await request("/api/agent/clients");
    expect(r.status).toBe(200);
    const clients = JSON.parse(new TextDecoder().decode(r.body));
    expect(Object.keys(clients).sort()).toEqual(["claudeCode", "claudeDesktop", "codex", "cursor", "vscode"]);
    for (const v of Object.values(clients)) expect(typeof v).toBe("boolean");
  });

  test("the .mcpb downloads, and its manifest runs this server with --mcp-stdio on this port", async () => {
    const r = await request("/api/agent/viewswitcher.mcpb");
    expect(r.status).toBe(200);
    expect(r.disposition).toContain('filename="ViewSwitcher.mcpb"');
    writeFileSync(join(scratch, "v.mcpb"), r.body);
    const zip = new Uint8Array(r.body);
    const entry = listZip(zip).find((e) => e.name === "manifest.json")!;
    const manifest = JSON.parse(new TextDecoder().decode(readZipEntrySync(zip, entry)));
    expect(same(JSON.stringify(manifest.server.mcp_config), JSON.stringify({ command: process.execPath, args: [join(import.meta.dir, "index.ts"), "--mcp-stdio", "--port", String(port)] }))).toBe(true);
    expect(manifest.compatibility.platforms).toEqual([WINDOWS ? "win32" : "darwin"]);
  });
});

// Refused before the route by the dispatcher (403: remote access is off; 401: an unpaired device; 421:
// a name the Wi-Fi listener isn't on) or because the route is this Mac's only (404): never answered.
const REFUSED = [401, 403, 404, 421];
describe("refused to anything but this Mac", () => {
  test("a name this Mac is reached by from elsewhere", async () => {
    for (const path of PATHS) {
      const r = await request(path, { host: `studio.local:${port}` });
      expect(REFUSED).toContain(r.status);
      expect(new TextDecoder().decode(r.body)).not.toContain(library);
    }
  });
  test("proxied (tailscale serve)", async () => {
    for (const path of PATHS) {
      for (const h of [{ "x-forwarded-for": "100.64.0.3" }, { forwarded: "for=100.64.0.3" }] as Record<string, string>[]) {
        const r = await request(path, h);
        expect(REFUSED).toContain(r.status);
        expect(new TextDecoder().decode(r.body)).not.toContain(library);
      }
    }
  });
});
