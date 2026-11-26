// Edit with AI's endpoints on the real server (from source, OBS offline, no USB, a temp library):
// /api/info's commands, /api/agent/clients and the Claude Desktop extension answer only this Mac.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Subprocess } from "bun";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, SERVER_START_MS, startServer } from "./test-server";

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
    expect(info.claudeCode).toEndWith(" && claude");
    expect(info.claudeCode).toContain(library.split("/").pop()!);
    // From source: bun with index.ts.
    expect(info.stdio).toBe(`${process.execPath} ${join(import.meta.dir, "index.ts")} --mcp-stdio --port ${port}`);
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
    expect(Bun.spawnSync(["unzip", "-q", join(scratch, "v.mcpb"), "-d", join(scratch, "out")]).exitCode).toBe(0);
    const manifest = JSON.parse(readFileSync(join(scratch, "out/manifest.json"), "utf8"));
    expect(manifest.server.mcp_config).toEqual({ command: process.execPath, args: [join(import.meta.dir, "index.ts"), "--mcp-stdio", "--port", String(port)] });
  });
});

// Refused before the route by the pairing gate (401: an unpaired device; 421: a name the Wi-Fi listener
// isn't on) or by the route itself (404): never answered.
const REFUSED = [401, 404, 421];
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
