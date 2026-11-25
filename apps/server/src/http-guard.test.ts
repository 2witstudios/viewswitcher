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
  return new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }));
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

describe("the live socket", () => {
  const ws = (origin?: string) =>
    new Promise<string>((resolve) => {
      const w = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: origin ? { origin } : {} } as any);
      w.onmessage = () => (resolve("open"), w.close());
      w.onclose = () => resolve("closed");
      w.onerror = () => {};
    });
  test("a website open in a browser on this Mac can't read it; the switcher's own pages and native clients can", async () => {
    expect(await ws("https://evil.example")).toBe("closed");
    expect(await ws(`http://127.0.0.1:${port}`)).toBe("open");
    expect(await ws()).toBe("open");
  });
});

describe("HOST", () => {
  test("a non-loopback HOST is refused at start (the Wi-Fi setting is the way onto the network)", async () => {
    const p = Bun.spawn([process.execPath, join(import.meta.dir, "index.ts")], {
      env: { ...process.env, PORT: "1", HOST: "0.0.0.0", OBS_URL: "ws://127.0.0.1:1", VIEWSWITCHER_USB: "0", VIEWSWITCHER_LIBRARY: library },
      stdout: "ignore",
      stderr: "pipe",
    });
    expect(await p.exited).toBe(1);
    expect(await new Response(p.stderr).text()).toContain("isn't a loopback address");
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
  test("a sandboxed scene (Origin: null) can't change anything", async () => {
    expect((await onAir({ origin: "null" })).status).toBe(403);
    expect((await request("/api/scene/edit", { method: "POST", headers: { origin: "null", "content-type": "text/plain" }, body: "{}" })).status).toBe(403);
    expect((await request("/api/packs/install", { method: "POST", headers: { origin: "null", "content-type": "text/plain" }, body: "{}" })).status).toBe(403);
    expect(JSON.parse((await request("/api/state")).body).onAir).toBeNull();
  });
  test("a scene can't turn the agent on-air setting off either (the MCP preview path)", async () => {
    // preview_scene loads an agent-written scene in OBS from this server's origin; under the CSP
    // sandbox its fetches carry Origin: null, so the settings route (which has no agent guard) refuses them.
    const set = (origin: string) =>
      request("/api/agent/settings", { method: "POST", headers: { origin, "content-type": "text/plain" }, body: JSON.stringify({ onAir: "always" }) });
    expect((await set("null")).status).toBe(403);
    expect(JSON.parse((await request("/api/state")).body).agent.onAir).toBe("not-live");
    // The same request from the switcher's own page works (people are never blocked).
    expect((await set(`http://127.0.0.1:${port}`)).status).toBe(200);
    expect(JSON.parse((await request("/api/state")).body).agent.onAir).toBe("always");
    expect((await request("/api/agent/settings", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ onAir: "not-live" }) })).status).toBe(200);
  });
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

describe("scenes are served sandboxed (EDIT-26)", () => {
  const ws = { connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" };
  test("every library page has an opaque origin, its scripts kept off plain http and ws", async () => {
    for (const q of ["", "?preview", "?edit", "?edit&bridge"]) {
      const r = await request(`/library/my-channel/templates/brb.html${q}`);
      expect(r.status).toBe(200);
      expect(r.headers["content-security-policy"]).toBe("sandbox allow-scripts; connect-src https: wss:; object-src 'none'; base-uri 'none'; form-action 'none'");
      expect(r.headers["x-content-type-options"]).toBe("nosniff");
    }
    expect((await request("/library/my-channel/templates/_shared/brand/mark.svg")).headers["content-security-policy"]).toStartWith("sandbox allow-scripts;");
  });
  test("preview_scene's URL (top-level in OBS) is sandboxed and still renders: scene.js, the theme and assets load, ?preview applies", async () => {
    // The exact shape preview.ts loads: ?preview plus a cache-busting load= parameter.
    const r = await request("/library/my-channel/templates/brb.html?preview&load=1-1");
    expect(r.status).toBe(200);
    expect(r.headers["content-security-policy"]).toStartWith("sandbox allow-scripts;");
    expect(r.headers["content-security-policy"]).not.toContain("allow-same-origin");
    expect(r.headers["content-security-policy"]).not.toContain("allow-top-navigation");
    // Classic <script src> and <link rel=stylesheet>: allowed by the CSP (no script-src / style-src) and no CORS needed.
    const refs = [...r.body.matchAll(/(?:src|href)="(\/library\/[^"]+)"/g)].map((m) => m[1]!);
    expect(refs).toContain("/library/my-channel/templates/_shared/scene.js");
    expect(refs).toContain("/library/my-channel/templates/_shared/theme.css");
    for (const ref of refs) expect({ ref, status: (await request(ref)).status }).toEqual({ ref, status: 200 });
    const js = await request("/library/my-channel/templates/_shared/scene.js");
    expect(js.headers["content-type"]).toContain("javascript");
    // scene.js reads location.search, which a sandboxed document keeps: the preview class applies.
    expect(js.body).toContain('new URLSearchParams(location.search).has("preview")');
    expect(js.body).toContain('classList.add("preview")');
    expect((await request("/library/my-channel/templates/_shared/theme.css")).headers["content-type"]).toContain("text/css");
  });
  test("every library response is sandboxed, whatever it's called; a trailing slash finds nothing", async () => {
    const r = await request("/library/my-channel/templates/brb.html/");
    expect(r.status).toBe(404);
    for (const p of ["/library/my-channel/org.json", "/library/my-channel/templates/_shared/theme.css", "/library/my-channel/BRAND.md"]) {
      expect((await request(p)).headers["content-security-policy"]).toStartWith("sandbox allow-scripts;");
    }
    // Stylesheets and scripts load in CORS mode from an opaque origin; JSON and pages never get CORS.
    expect((await request("/library/my-channel/templates/_shared/scene.js")).headers["access-control-allow-origin"]).toBe("*");
    expect((await request("/library/my-channel/org.json")).headers["access-control-allow-origin"]).toBeUndefined();
    expect((await request("/library/my-channel/templates/brb.html")).headers["access-control-allow-origin"]).toBeUndefined();
    // An org's pictures aren't readable by other websites open on this Mac.
    expect((await request("/library/my-channel/templates/_shared/brand/mark.svg")).headers["access-control-allow-origin"]).toBeUndefined();
  });
  test("?bridge adds the bridge; ?edit tags; neither touches the file", async () => {
    const r = await request("/library/my-channel/templates/brb.html?edit&bridge");
    expect(r.body).toContain('data-vs="0"');
    expect(r.body).toContain('viewswitcher: "frame:state"');
    expect(r.headers["x-scene-hash"]).toBeTruthy();
    const plain = await request("/library/my-channel/templates/brb.html");
    expect(plain.body).not.toContain("frame:state");
    expect(plain.body).not.toContain("data-vs");
  });
  test("the editor's frame (?inert) is same-origin but runs none of the scene's code, and gets no bridge", async () => {
    const r = await request("/library/my-channel/templates/brb.html?edit&inert&bridge");
    expect(r.headers["content-security-policy"]).toStartWith("sandbox allow-same-origin allow-scripts; script-src 'none'; object-src 'none'; frame-src 'none'");
    expect(r.body).not.toContain("frame:state");
  });
  test("?inert is same-origin only on the editor's defused copy; every other ?inert request is sandboxed as usual", async () => {
    for (const p of ["templates/brb.html?inert", "templates/brb.HTML?edit&inert", "templates/_shared/brand/mark.svg?inert", "templates/brb.html%2F.?edit&inert", "org.json?inert"]) {
      const r = await request(`/library/my-channel/${p}`);
      if (r.status === 200) expect(r.headers["content-security-policy"]).toStartWith("sandbox allow-scripts;");
      else expect(r.headers["content-security-policy"] ?? "sandbox allow-scripts;").toStartWith("sandbox allow-scripts;");
    }
    expect((await request("/library/my-channel/templates/brb.html?edit&inert")).headers["content-security-policy"]).toStartWith("sandbox allow-same-origin");
  });
  test("the live socket refuses a sandboxed scene and other sites, and takes the switcher's pages", async () => {
    expect((await request("/ws", { headers: { ...ws, origin: "null" } })).status).toBe(403);
    expect((await request("/ws", { headers: { ...ws, origin: "https://evil.example" } })).status).toBe(403);
    const opened = await new Promise<boolean>((resolve) => {
      const sock = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { origin: `http://127.0.0.1:${port}` } } as unknown as string[]);
      sock.onopen = () => (sock.close(), resolve(true));
      sock.onerror = () => resolve(false);
    });
    expect(opened).toBe(true);
  });
});
