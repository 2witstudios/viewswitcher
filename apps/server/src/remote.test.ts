// Phones and tablets over the Wi-Fi (MAC-23 … MAC-26), end to end: the real server (from source, OBS
// offline, no USB, a temp library) with its Wi-Fi listener bound to this Mac's LAN address, and requests
// that really arrive from that address, so the server sees a non-loopback peer like a phone's.
// Skipped on a machine with no LAN address.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lanAddresses, pairingOrder, vpnAddresses } from "./lan";

// The address the server puts in the QR code (its own pairingOrder), and the one this test connects to.
const advertised = pairingOrder(lanAddresses(), vpnAddresses())[0];
const ip = process.env.VIEWSWITCHER_TEST_LAN_IP ?? advertised;
const ADMIN = "test-admin-secret-" + "x".repeat(32);
const TTL = 1500;
let port = 0;
let proc: ReturnType<typeof Bun.spawn>;
const library = mkdtempSync(join(tmpdir(), "vs-remote-"));

type Res = { status: number; body: string; headers: http.IncomingHttpHeaders };
/** node:http, so the Host header is the one a phone would send. `via` is where the TCP connection goes. */
function request(via: string, path: string, { method = "GET", headers = {} as Record<string, string>, body = "" } = {}) {
  return new Promise<Res>((resolve, reject) => {
    const req = http.request({ host: via, port, path, method, agent: false, headers: { host: `${via}:${port}`, ...headers } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }));
    });
    req.on("error", reject);
    req.end(body);
  });
}
const lan = (path: string, o?: Parameters<typeof request>[2]) => request(ip!, path, o);
const mac = (path: string, o?: Parameters<typeof request>[2]) => request("127.0.0.1", path, o);
const admin = async (path: string, payload?: unknown) =>
  JSON.parse(
    (await mac(path, payload === undefined ? { headers: { "x-viewswitcher-admin": ADMIN } } : { method: "POST", headers: { "x-viewswitcher-admin": ADMIN, "content-type": "application/json" }, body: JSON.stringify(payload) })).body,
  );
const pairWith = (code: string, extra: Record<string, string> = {}) =>
  lan("/api/pair", { method: "POST", headers: { "content-type": "application/json", origin: `http://${ip}:${port}`, ...extra }, body: JSON.stringify({ code, name: "Test phone" }) });
const cookieOf = (r: Res) => String(r.headers["set-cookie"]?.[0] ?? "").split(";")[0];

/** A WebSocket from the LAN address; resolves with the first message, or the close code. */
function socket(headers: Record<string, string>) {
  const ws = new WebSocket(`ws://${ip}:${port}/ws`, { headers } as any);
  const first = new Promise<{ message?: string; close?: number }>((r) => {
    ws.onmessage = (e) => r({ message: String(e.data) });
    ws.onclose = (e) => r({ close: e.code });
    ws.onerror = () => {};
  });
  const closed = new Promise<number>((r) => ws.addEventListener("close", (e) => r(e.code)));
  return { ws, first, closed };
}

async function start() {
  proc = Bun.spawn([process.execPath, join(import.meta.dir, "index.ts")], {
    env: {
      ...process.env, PORT: String(port), OBS_URL: "ws://127.0.0.1:1", VIEWSWITCHER_USB: "0", VIEWSWITCHER_LIBRARY: library, VIEWSWITCHER_ORIGINS: "",
      VIEWSWITCHER_LAN: "1", VIEWSWITCHER_LAN_HOST: ip!, VIEWSWITCHER_ADMIN_TOKEN: ADMIN, VIEWSWITCHER_PAIR_TTL_MS: String(TTL), VIEWSWITCHER_LOCAL_NAME: "test-mac",
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  for (let i = 0; i < 100; i++) {
    if (await lan("/").then((r) => r.status === 401, () => false)) return;
    await Bun.sleep(50);
  }
  throw new Error("server didn't start");
}

describe.skipIf(!ip)(`over the Wi-Fi (${ip})`, () => {
  beforeAll(async () => {
    port = await new Promise<number>((r) => {
      const s = createServer().listen(0, "127.0.0.1", () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => r(p));
      });
    });
    await start();
  });
  afterAll(() => {
    proc?.kill();
    rmSync(library, { recursive: true, force: true });
  });

  test("the Mac app's endpoints need the secret, from this Mac", async () => {
    expect((await mac("/api/remote")).status).toBe(404);
    expect((await mac("/api/remote", { headers: { "x-viewswitcher-admin": ADMIN.slice(0, -1) } })).status).toBe(404);
    expect((await mac("/api/remote", { headers: { "x-viewswitcher-admin": ADMIN, "x-forwarded-for": "1.2.3.4" } })).status).toBe(401);
    const s = await admin("/api/remote");
    expect(s).toMatchObject({ enabled: true, port, localName: "test-mac.local", devices: [], code: null });
    expect(s.urls).toContain(`http://${ip}:${port}/`);
    expect(s.urls).toContain(`http://test-mac.local:${port}/`);
  });

  test("unpaired: the pairing page, and 401 for the API, the library, the socket and assets", async () => {
    const page = await lan("/");
    expect(page.status).toBe(401);
    expect(page.body).toContain("Pair with ViewSwitcher");
    expect(page.headers["content-security-policy"]).toContain("default-src 'none'");
    expect((await lan("/program")).body).toContain("Pair with ViewSwitcher");
    for (const p of ["/api/state", "/api/orgs", "/library/my-channel/org.json", "/assets/index.js", "/api/info"]) {
      expect({ p, status: (await lan(p)).status }).toEqual({ p, status: 401 });
    }
    expect((await lan("/api/remote", { headers: { "x-viewswitcher-admin": ADMIN } })).status).toBe(401);
    expect((await lan("/api/onair", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ path: "my-channel/templates/brb.html" }) })).status).toBe(401);
    expect((await lan("/ws", { headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" } })).status).toBe(401);
    expect((await lan("/api/state", { headers: { cookie: "vs_device=made-up" } })).status).toBe(401);
    // Host guard: a LAN request must name this Mac.
    expect((await lan("/", { headers: { host: "evil.example" } })).status).toBe(421);
    // The Mac itself is unchanged.
    expect((await mac("/api/state")).status).toBe(200);
  });

  let cookie = "";
  let deviceId = "";
  test("a code pairs once; the cookie is HttpOnly and SameSite=Strict", async () => {
    const { code, pairUrl } = (await admin("/api/remote/code", {})) as { code: { code: string }; pairUrl: string };
    expect(pairUrl).toBe(`http://${advertised}:${port}/pair?code=${code.code}&mac=test-mac.local`);
    expect((await pairWith("WRONGCOD")).status).toBe(403);
    // The one POST an unpaired device may make is small.
    expect((await lan("/api/pair", { method: "POST", headers: { "content-type": "application/json", origin: `http://${ip}:${port}` }, body: JSON.stringify({ code: code.code, name: "x".repeat(4000) }) })).status).toBe(413);
    expect((await pairWith(code.code, { origin: "http://evil.example" })).status).toBe(403); // another site can't pair for you
    const ok = await pairWith(code.code.toLowerCase());
    expect(ok.status).toBe(200);
    const set = String(ok.headers["set-cookie"]?.[0]);
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Strict");
    cookie = cookieOf(ok);
    expect((await pairWith(code.code)).status).toBe(403); // single use
    const s = await admin("/api/remote");
    expect(s.devices).toHaveLength(1);
    expect(s.devices[0].name).toBe("Test phone");
    expect(JSON.stringify(s)).not.toContain(cookie.split("=")[1]);
    deviceId = s.devices[0].id;
  });

  test("an expired code fails", async () => {
    const { code } = (await admin("/api/remote/code", {})) as { code: { code: string } };
    await Bun.sleep(TTL + 100);
    const r = await pairWith(code.code);
    expect(r.status).toBe(403);
    expect(r.body).toContain("expired");
  });

  test("paired: the switcher, the library and the socket; switching scenes works", async () => {
    const home = await lan("/", { headers: { cookie } });
    expect([200, 503]).toContain(home.status); // the switcher (503: not built in this checkout)
    expect(home.body).not.toContain("Pair with ViewSwitcher");
    expect((await lan("/pair?code=X", { headers: { cookie } })).status).toBe(303);
    expect((await lan("/library/my-channel/org.json", { headers: { cookie } })).status).toBe(200);
    const on = await lan("/api/onair", {
      method: "POST",
      headers: { cookie, "content-type": "application/json", origin: `http://${ip}:${port}` },
      body: JSON.stringify({ path: "my-channel/templates/brb.html", label: "BRB" }),
    });
    expect(on.status).toBe(200);
    expect(JSON.parse((await mac("/api/state")).body).onAir.label).toBe("BRB");
    // A page elsewhere can't use the phone's pairing.
    expect((await lan("/api/onair", { method: "POST", headers: { cookie, "content-type": "text/plain", origin: "http://192.168.99.99:7420" }, body: "{}" })).status).toBe(403);
    const s = socket({ cookie });
    expect(JSON.parse((await s.first).message ?? "{}").t).toBe("state");
    s.ws.close();
  });

  test("removed: blocked at once, and its socket is closed", async () => {
    const s = socket({ cookie });
    await s.first;
    await admin("/api/remote/remove", { id: deviceId });
    expect(await Promise.race([s.closed, Bun.sleep(2000).then(() => -1)])).toBe(4401);
    expect((await lan("/api/state", { headers: { cookie } })).status).toBe(401);
    expect((await lan("/", { headers: { cookie } })).body).toContain("Pair with ViewSwitcher");
  });

  test("turned off: the Wi-Fi port closes and its sockets drop; this Mac carries on", async () => {
    const { code } = (await admin("/api/remote/code", {})) as { code: { code: string } };
    const again = cookieOf(await pairWith(code.code));
    const s = socket({ cookie: again });
    await s.first;
    const off = await admin("/api/remote", { enabled: false });
    expect(off.enabled).toBe(false);
    expect(await Promise.race([s.closed, Bun.sleep(2000).then(() => -1)])).not.toBe(-1);
    expect(await lan("/").then(() => "open", (e) => e.code)).toBe("ECONNREFUSED");
    expect((await mac("/api/state")).status).toBe(200);
    expect((await admin("/api/remote", { enabled: true })).enabled).toBe(true);
    expect((await lan("/api/state", { headers: { cookie: again } })).status).toBe(200); // still paired when it comes back
  });

  test("a removal survives quitting right after it (SIGTERM, as the Mac app quits)", async () => {
    const { code } = (await admin("/api/remote/code", {})) as { code: { code: string } };
    const lost = cookieOf(await pairWith(code.code));
    const { devices } = await admin("/api/remote");
    const id = devices.find((d: { name: string; lastSeen: number }) => d.name === "Test phone" && d.lastSeen === Math.max(...devices.map((x: { lastSeen: number }) => x.lastSeen))).id;
    await admin("/api/remote/remove", { id });
    proc.kill("SIGTERM");
    await proc.exited;
    await start();
    expect((await lan("/api/state", { headers: { cookie: lost } })).status).toBe(401);
  });

  test("a website open on a paired phone can't read the live socket", async () => {
    const { code } = (await admin("/api/remote/code", {})) as { code: { code: string } };
    const cookie = cookieOf(await pairWith(code.code));
    const evil = socket({ cookie, origin: "https://evil.example" });
    expect((await evil.first).close).toBeDefined();
    const own = socket({ cookie, origin: `http://${ip}:${port}` });
    expect((await own.first).message).toBeDefined();
    own.ws.close();
  });

  test("a scene on a paired phone stays sandboxed: no socket, and /library pages carry the sandbox CSP", async () => {
    const { code } = (await admin("/api/remote/code", {})) as { code: { code: string } };
    const cookie = cookieOf(await pairWith(code.code));
    // A sandboxed scene frame sends Origin "null"; the phone's cookie rides along, and it still gets no socket.
    const scene = socket({ cookie, origin: "null" });
    expect((await scene.first).close).toBeDefined();
    for (const q of ["", "?bridge", "?edit"]) {
      const r = await lan(`/library/my-channel/templates/brb.html${q}`, { headers: { cookie } });
      expect(r.status).toBe(200);
      expect(String(r.headers["content-security-policy"])).toContain("sandbox");
    }
  });

  test("a paired phone still can't reach the agents' /mcp, /api/info, /api/agent/clients or the .mcpb (MCP-2)", async () => {
    const { code } = (await admin("/api/remote/code", {})) as { code: { code: string } };
    const cookie = cookieOf(await pairWith(code.code));
    expect((await lan("/api/state", { headers: { cookie } })).status).toBe(200); // paired: the switcher works
    const init = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "phone", version: "1" } } });
    const r = await lan("/mcp", { method: "POST", headers: { cookie, "content-type": "application/json", accept: "application/json, text/event-stream", origin: `http://${ip}:${port}` }, body: init });
    expect(r.status).toBe(404);
    expect(r.body).not.toContain("serverInfo");
    for (const path of ["/api/info", "/api/agent/clients", "/api/agent/viewswitcher.mcpb"]) {
      const res = await lan(path, { headers: { cookie } });
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
      expect(res.body).not.toContain(library);
    }
  });
});

