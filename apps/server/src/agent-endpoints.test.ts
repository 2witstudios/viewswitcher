// Edit with AI's endpoints on the real server (from source, OBS offline, no USB, a temp library):
// /api/info's commands, /api/agent/clients and the Claude Desktop extension answer only this Mac.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

let port = 0;
let proc: ReturnType<typeof Bun.spawn>;
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
  port = await new Promise<number>((r) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => r(p));
    });
  });
  proc = Bun.spawn([process.execPath, join(import.meta.dir, "index.ts")], {
    env: { ...process.env, PORT: String(port), OBS_URL: "ws://127.0.0.1:1", VIEWSWITCHER_USB: "0", VIEWSWITCHER_LIBRARY: library, VIEWSWITCHER_ORIGINS: "" },
    stdout: "ignore",
    stderr: "ignore",
  });
  for (let i = 0; i < 100; i++) {
    if (await request("/api/state").then((r) => r.status === 200, () => false)) return;
    await Bun.sleep(50);
  }
  throw new Error("server didn't start");
});
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

describe("refused (404) to anything but this Mac", () => {
  test("a name this Mac is reached by from elsewhere", async () => {
    for (const path of PATHS) {
      const r = await request(path, { host: `studio.local:${port}` });
      expect({ path, status: r.status }).toEqual({ path, status: 404 });
      expect(new TextDecoder().decode(r.body)).not.toContain(library);
    }
  });
  test("proxied (tailscale serve)", async () => {
    for (const path of PATHS) {
      for (const h of [{ "x-forwarded-for": "100.64.0.3" }, { forwarded: "for=100.64.0.3" }] as Record<string, string>[]) {
        const r = await request(path, h);
        expect({ path, status: r.status }).toEqual({ path, status: 404 });
      }
    }
  });
});
