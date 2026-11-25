// The real server (from source, OBS offline, no USB, a temp library) against the two attacks in
// origin.ts: DNS rebinding (Host: evil.example:7420) and cross-site POSTs (Origin: another site).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

let port = 0;
let proc: ReturnType<typeof Bun.spawn>;
const library = mkdtempSync(join(tmpdir(), "vs-guard-"));

/** node:http, because it sends the Host header we give it (fetch derives it from the URL). */
function request(path: string, { method = "GET", headers = {} as Record<string, string>, body = "" } = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", reject);
    req.end(body);
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
    env: { ...process.env, PORT: String(port), OBS_URL: "ws://127.0.0.1:1", VIEWSWITCHER_USB: "0", VIEWSWITCHER_LIBRARY: library, VIEWSWITCHER_ORIGINS: "", VIEWSWITCHER_LAN: "", VIEWSWITCHER_ADMIN_TOKEN: "" },
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
});

const onAir = (headers: Record<string, string>) =>
  request("/api/onair", { method: "POST", headers: { "content-type": "text/plain", ...headers }, body: JSON.stringify({ path: "my-channel/templates/brb.html", label: "BRB" }) });

describe("DNS rebinding: Host evil.example:7420", () => {
  test("the API, the library and the live socket refuse it", async () => {
    const evil = { host: "evil.example:7420" };
    expect((await request("/api/state", { headers: evil })).status).toBe(421);
    expect((await request("/library/my-channel/org.json", { headers: evil })).status).toBe(421);
    expect((await request("/ws", { headers: { ...evil, connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" } })).status).toBe(421);
    expect((await onAir({ ...evil, origin: "http://evil.example:7420" })).status).toBe(421);
  });
  test("the names this server is known by still work", async () => {
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, "localhost:5173"]) {
      expect({ host, status: (await request("/api/state", { headers: { host } })).status }).toEqual({ host, status: 200 });
    }
    expect((await request("/library/my-channel/org.json")).status).toBe(200);
  });
  test("a known name that isn't this Mac's own (tailscale serve) is let past the host guard, then needs pairing (MAC-25)", async () => {
    expect((await request("/api/state", { headers: { host: "mac.tail1234.ts.net" } })).status).toBe(401);
    expect((await request("/api/state", { headers: { "x-forwarded-for": "100.64.0.9" } })).status).toBe(401);
  });
  test("a .local name that isn't this Mac's is refused (any device on the LAN can answer mDNS for one)", async () => {
    expect((await request("/api/state", { headers: { host: "studio.local" } })).status).toBe(421);
  });
});

describe("the Mac app's own endpoints", () => {
  test("/api/info and /api/remote are not for anything forwarded; /api/remote needs the app's secret", async () => {
    expect((await request("/api/info")).status).toBe(200);
    expect((await request("/api/info", { headers: { "x-forwarded-for": "1.2.3.4" } })).status).toBe(401);
    expect((await request("/api/remote")).status).toBe(404); // this server was started without one
    expect((await request("/api/remote/code", { method: "POST", headers: { "x-viewswitcher-admin": "" } })).status).toBe(404);
  });
});

describe("cross-site POST: Origin from another site", () => {
  test("is refused, and changes nothing", async () => {
    expect((await onAir({ origin: "https://evil.example" })).status).toBe(403);
    expect((await onAir({ origin: "http://evil.example:7420" })).status).toBe(403);
    expect(JSON.parse((await request("/api/state")).body).onAir).toBeNull();
  });
  test("the switcher's own pages are accepted: this Mac, Vite dev", async () => {
    expect((await onAir({ origin: `http://127.0.0.1:${port}` })).status).toBe(200);
    expect((await onAir({ origin: "http://localhost:5173", host: "localhost:5173" })).status).toBe(200);
    expect((await onAir({})).status).toBe(200); // no Origin: curl, the Mac app
  });
});
