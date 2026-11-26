// The real server (from source, OBS offline, no USB, Wi-Fi off, a temp library) against the attacks in
// origin.ts and http/dispatch.ts: DNS rebinding (Host: evil.example:7420), requests from another site or
// another page on this Mac (Origin, Content-Type), framing, and library paths that lead somewhere else.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Subprocess } from "bun";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { starterPack, zipPack } from "@viewswitcher/packs";
import { freePort, SERVER_START_MS, startServer } from "./test-server";

let port = 0;
let proc: Subprocess;
const library = mkdtempSync(join(tmpdir(), "vs-guard-"));
const outside = mkdtempSync(join(tmpdir(), "vs-guard-out-"));
// A built switcher of its own, so its pages and assets are real files here whatever this checkout has built.
const dist = mkdtempSync(join(tmpdir(), "vs-guard-web-"));
mkdirSync(join(dist, "assets"));
writeFileSync(join(dist, "index.html"), '<!doctype html><script type="module" src="/assets/index-test.js"></script>');
writeFileSync(join(dist, "assets/index-test.js"), "console.log(1)");

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
  port = await freePort();
  proc = await startServer(
    { PORT: String(port), OBS_URL: "ws://127.0.0.1:1", VIEWSWITCHER_USB: "0", VIEWSWITCHER_LIBRARY: library, VIEWSWITCHER_ORIGINS: "", VIEWSWITCHER_LAN: "", VIEWSWITCHER_ADMIN_TOKEN: "", VIEWSWITCHER_WEB_DIST: dist },
    () => request("/api/state").then((r) => r.status === 200),
  );
}, SERVER_START_MS);
afterAll(() => {
  proc?.kill();
  for (const d of [library, outside, dist]) rmSync(d, { recursive: true, force: true });
});

const onAir = (headers: Record<string, string>) =>
  request("/api/onair", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ path: "my-channel/templates/brb.html", label: "BRB" }) });
const WS = { connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" };

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
  test("a known name that isn't this Mac's own (tailscale serve) is let past the host guard, then refused: remote access is off", async () => {
    expect((await request("/api/state", { headers: { host: "mac.tail1234.ts.net" } })).status).toBe(403);
    expect((await request("/api/state", { headers: { "x-forwarded-for": "100.64.0.9" } })).status).toBe(403);
    expect((await request("/", { headers: { host: "mac.tail1234.ts.net" } })).status).toBe(403); // not even the pairing page
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
    expect((await request("/api/info", { headers: { "x-forwarded-for": "1.2.3.4" } })).status).toBe(403); // remote access is off
    expect((await request("/api/remote")).status).toBe(404); // this server was started without one
    expect((await request("/api/remote/code", { method: "POST", headers: { "x-viewswitcher-admin": "", "content-type": "application/json" }, body: "{}" })).status).toBe(404);
  });
});

describe("cross-site POST: Origin from another site", () => {
  test("a sandboxed scene (Origin: null) can't change anything", async () => {
    expect((await onAir({ origin: "null" })).status).toBe(403);
    expect((await request("/api/scene/edit", { method: "POST", headers: { origin: "null", "content-type": "text/plain" }, body: "{}" })).status).toBe(403);
    for (const path of ["/api/sets/install", "/api/packs/install"]) expect((await request(path, { method: "POST", headers: { origin: "null", "content-type": "text/plain" }, body: "{}" })).status).toBe(403);
    expect(JSON.parse((await request("/api/state")).body).onAir).toBeNull();
  });
  test("a scene can't turn the agent on-air setting off either (the MCP preview path)", async () => {
    // preview_scene loads an agent-written scene in OBS from this server's origin; under the CSP
    // sandbox its fetches carry Origin: null, so the settings route (which has no agent guard) refuses them.
    const set = (origin: string) =>
      request("/api/agent/settings", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ onAir: "always" }) });
    expect((await set("null")).status).toBe(403);
    expect(JSON.parse((await request("/api/state")).body).agent.onAir).toBe("not-live");
    // The same request from the switcher's own page works (people are never blocked).
    expect((await set(`http://127.0.0.1:${port}`)).status).toBe(200);
    expect(JSON.parse((await request("/api/state")).body).agent.onAir).toBe("always");
    expect((await request("/api/agent/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ onAir: "not-live" }) })).status).toBe(200);
  });
  test("is refused, and changes nothing", async () => {
    expect((await onAir({ origin: "https://evil.example" })).status).toBe(403);
    expect((await onAir({ origin: "http://evil.example:7420" })).status).toBe(403);
    expect(JSON.parse((await request("/api/state")).body).onAir).toBeNull();
  });
  test("the switcher's own pages are accepted: this Mac, Vite dev", async () => {
    expect((await onAir({ origin: `http://127.0.0.1:${port}` })).status).toBe(200);
    expect((await onAir({ origin: `http://localhost:${port}`, host: `localhost:${port}` })).status).toBe(200);
    // Vite's proxy keeps the page's Host (apps/web/vite.config.ts), so its pages are this server's own origin.
    expect((await onAir({ origin: "http://localhost:5173", host: "localhost:5173" })).status).toBe(200);
    expect((await onAir({})).status).toBe(200); // no Origin: curl, the Mac app
  });
});

describe("another page on this Mac (another localhost port)", () => {
  test("can't change anything: its Origin isn't this server's own", async () => {
    for (const origin of ["http://localhost:8000", "http://127.0.0.1:8000", `http://localhost:${port}`, `https://127.0.0.1:${port}`]) {
      expect({ origin, status: (await onAir({ origin })).status }).toEqual({ origin, status: 403 });
    }
    // A proxy that rewrites the Host (Vite's changeOrigin) leaves the page's port in Origin: refused too.
    expect((await onAir({ origin: "http://localhost:5173", host: `localhost:${port}` })).status).toBe(403);
  });
  test("can't read the live socket", async () => {
    for (const origin of ["http://localhost:8000", "http://127.0.0.1:8000"]) {
      expect({ origin, status: (await request("/ws", { headers: { ...WS, origin } })).status }).toEqual({ origin, status: 403 });
    }
  });
});

describe("Content-Type: a page can't send JSON to another origin without a preflight", () => {
  test("a text/plain POST gets a 415, even from the switcher's own origin, and changes nothing", async () => {
    await request("/api/onair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "my-channel/templates/brb.html", label: "Before" }) });
    for (const headers of [{ "content-type": "text/plain" }, { "content-type": "text/plain", origin: `http://127.0.0.1:${port}` }, {}, { "content-type": "application/x-www-form-urlencoded" }, { "content-type": "multipart/form-data; boundary=x" }] as Record<string, string>[]) {
      const r = await request("/api/onair", { method: "POST", headers, body: JSON.stringify({ path: "my-channel/templates/brb.html", label: "After" }) });
      expect({ headers, status: r.status }).toEqual({ headers, status: 415 });
    }
    expect(JSON.parse((await request("/api/state")).body).onAir.label).toBe("Before");
    expect((await request("/api/obs/setup", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" })).status).toBe(415);
  });
  test("JSON with a charset is JSON; the upload routes take multipart and nothing else", async () => {
    expect((await request("/api/onair", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ path: "my-channel/templates/brb.html" }) })).status).toBe(200);
    for (const path of ["/api/assets", "/api/packs/stage"]) {
      expect((await request(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(415);
      expect((await request(path, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" })).status).toBe(415);
    }
  });
  test("a body that isn't a JSON object is a 400", async () => {
    for (const body of ["{nope", "[1]", "3"]) expect((await request("/api/onair", { method: "POST", headers: { "content-type": "application/json" }, body })).status).toBe(400);
  });
});

describe("framing: nobody but the switcher's own pages can frame it", () => {
  const framed = (r: { headers: http.IncomingHttpHeaders }) => [String(r.headers["content-security-policy"]), r.headers["x-content-type-options"]];
  test("frame-ancestors 'self' and nosniff on the switcher, its assets, its API and its 404s", async () => {
    for (const p of ["/", "/program", "/daisy/edit/x", "/assets/index-test.js", "/api/state", "/api/nope", "/assets/missing.js", "/api/info", "/pair"]) {
      const r = await request(p);
      expect({ p, h: framed(r) }).toEqual({ p, h: ["frame-ancestors 'self'", "nosniff"] });
    }
    expect((await request("/assets/index-test.js")).status).toBe(200);
    expect((await request("/api/nope")).status).toBe(404);
    // Refusals too.
    expect(framed(await onAir({ origin: "https://evil.example" }))).toEqual(["frame-ancestors 'self'", "nosniff"]);
    expect(framed(await request("/api/onair", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" }))).toEqual(["frame-ancestors 'self'", "nosniff"]);
  });
  test("/library/ keeps its own sandbox CSP and no frame-ancestors: the switcher frames scenes, and OBS loads them top level", async () => {
    for (const p of ["/library/my-channel/templates/brb.html", "/library/my-channel/templates/brb.html?edit&bridge", "/library/my-channel/nope.html"]) {
      const csp = String((await request(p)).headers["content-security-policy"]);
      expect(csp).toStartWith("sandbox allow-scripts;");
      expect(csp).not.toContain("frame-ancestors");
    }
  });
});

describe("library paths obey the real-path rule, for reads as for writes", () => {
  test("a link out of the library, plain or ?edit or ?bridge, is a 404; a link inside it works", async () => {
    writeFileSync(join(outside, "secret.html"), "<title>Outside</title>secret");
    symlinkSync(join(outside, "secret.html"), join(library, "my-channel/templates/away.html"));
    symlinkSync(outside, join(library, "my-channel/assets-away"));
    for (const p of ["templates/away.html", "templates/away.html?edit", "templates/away.html?bridge", "templates/away.html?edit&inert", "assets-away/secret.html"]) {
      const r = await request(`/library/my-channel/${p}`);
      expect({ p, status: r.status }).toEqual({ p, status: 404 });
      expect(r.body).not.toContain("secret");
    }
    symlinkSync(join(library, "my-channel/templates/brb.html"), join(library, "my-channel/templates/alias.html"));
    expect((await request("/library/my-channel/templates/alias.html")).status).toBe(200);
    expect((await request("/library/my-channel/templates/alias.html?edit")).status).toBe(200);
  });
  test("dot-folders and dot-files are a 404: .git, .viewswitcher, and a link into them", async () => {
    mkdirSync(join(library, ".git"), { recursive: true });
    writeFileSync(join(library, ".git/config"), "[core]");
    mkdirSync(join(library, "my-channel/.git"), { recursive: true });
    writeFileSync(join(library, "my-channel/.git/config"), "[core]");
    writeFileSync(join(library, "my-channel/.env"), "SECRET=1");
    symlinkSync(join(library, ".viewswitcher/settings.json"), join(library, "my-channel/settings.json"));
    await request("/api/agent/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ onAir: "not-live" }) });
    for (const p of [".git/config", "my-channel/.git/config", ".viewswitcher/settings.json", ".viewswitcher/state.json", "my-channel/.env", "my-channel/settings.json", "my-channel/.viewswitcher/staging/x", "my-channel/%2egit/config"]) {
      const r = await request(`/library/${p}`);
      expect({ p, status: r.status }).toEqual({ p, status: 404 });
    }
  });
  test("a staged pack's covers still load, and nothing else in staging does", async () => {
    const token = "0a1b2c3d4e5f60718293a4b5";
    await Bun.write(join(library, `my-channel/.viewswitcher/staging/${token}/covers/view.html`), "<title>Cover</title>");
    await Bun.write(join(library, `my-channel/.viewswitcher/staging/${token}/meta.json`), "{}");
    await Bun.write(join(library, `my-channel/.viewswitcher/staging/${token}/covers/.hidden`), "x");
    expect((await request(`/library/my-channel/.viewswitcher/staging/${token}/covers/view.html`)).status).toBe(200);
    for (const p of [`${token}/meta.json`, `${token}/covers/.hidden`, `${token}/raw/view.html`, "not-a-token/covers/view.html"]) {
      expect({ p, status: (await request(`/library/my-channel/.viewswitcher/staging/${p}`)).status }).toEqual({ p, status: 404 });
    }
  });
  test("going on air through a link out of the library is refused, so the program never loads a 404", async () => {
    const r = await onAir({});
    expect(r.status).toBe(200);
    const away = await request("/api/onair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "my-channel/templates/away.html" }) });
    expect(away.status).toBe(400);
  });
});

describe("errors", () => {
  test("a 500's message reaches this Mac, without absolute paths", async () => {
    const r = await request("/api/scenes/duplicate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "my-channel/templates/gone.html" }) });
    expect(r.status).toBe(500);
    const error = JSON.parse(r.body).error as string;
    expect(error).toContain("ENOENT");
    expect(error).toContain("my-channel/templates/gone.html");
    expect(error).not.toContain(library);
    expect(error).not.toContain(tmpdir());
  });
});

describe("unpacking a template pack never blocks the server", () => {
  test("/api/state keeps answering while a 96 MB pack unpacks", async () => {
    // Text-like data, 3:1, written straight into bytes (millions of little strings would leave this
    // process collecting garbage mid-test): inflating it takes long enough to see, in four entries of 24 MB.
    const words = Array.from({ length: 4096 }, (_, i) => new TextEncoder().encode(`${Math.random().toString(36).slice(2, 4 + (i % 9))} `));
    const big = () => {
      const out = new Uint8Array(24 * 1024 * 1024);
      for (let n = 0; n < out.length; ) {
        const w = words[(Math.random() * words.length) | 0]!;
        out.set(w.subarray(0, Math.min(w.length, out.length - n)), n);
        n += w.length;
      }
      return out;
    };
    const zip = zipPack("big", [...(await starterPack(resolve(import.meta.dir, "../starter"))), ...[1, 2, 3, 4].map((i) => ({ path: `assets/big-${i}.mp4`, data: big() }))]);
    // The poller is a process of its own, so only the server's delays count, not this one's upload.
    const poller = Bun.spawn(
      [process.execPath, "-e", `
        let stop = false, worst = 0, n = 0;
        (async () => { for await (const _ of Bun.stdin.stream()) {} stop = true; })();
        while (!stop) {
          const t = performance.now();
          await fetch("http://127.0.0.1:${port}/api/state");
          if (n++ === 0) console.log("ready");
          worst = Math.max(worst, performance.now() - t);
          await Bun.sleep(2);
        }
        console.log(JSON.stringify({ worst, n }));`],
      { stdin: "pipe", stdout: "pipe" },
    );
    const lines = poller.stdout.pipeThrough(new TextDecoderStream()).getReader();
    expect((await lines.read()).value?.trim()).toBe("ready");
    const form = new FormData();
    form.set("org", "my-channel");
    form.set("zip", new File([zip], "big.zip"));
    const started = performance.now();
    const r = await fetch(`http://127.0.0.1:${port}/api/packs/stage`, { method: "POST", body: form, headers: { origin: `http://127.0.0.1:${port}` } });
    const stageMs = performance.now() - started;
    poller.stdin.end();
    let rest = "";
    for (let c = await lines.read(); !c.done; c = await lines.read()) rest += c.value;
    const { worst, n } = JSON.parse(rest.trim()) as { worst: number; n: number };
    expect(r.status).toBe(200);
    expect(((await r.json()) as { set: string }).set).toBe("starter");
    // It answered all along, never held for a large part of the stage. That each entry inflates off
    // the event loop is zip.test.ts's job: a shared CI runner's scheduling stalls are as long as one
    // entry's inflate, so a bound that tight here would measure the runner, not the server.
    expect(n).toBeGreaterThan(5);
    expect(worst).toBeLessThan(stageMs / 2);
  }, 60_000);
});

describe("scenes are served sandboxed", () => {
  const ws = WS;
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
    // A staged pack's preview: its token is 24 hex characters (packs.ts).
    const r = await request("/library/my-channel/templates/brb.html/");
    expect(r.status).toBe(404);
    for (const p of ["/library/my-channel/org.json", "/library/my-channel/templates/_shared/theme.css", "/library/my-channel/BRAND.md"]) {
      expect((await request(p)).headers["content-security-policy"]).toStartWith("sandbox allow-scripts;");
    }
    // Stylesheets and scripts load in CORS mode from an opaque origin; JSON and pages never get CORS.
    expect((await request("/library/my-channel/templates/_shared/scene.js")).headers["access-control-allow-origin"]).toBe("*");
    expect((await request("/library/my-channel/org.json")).headers["access-control-allow-origin"]).toBeUndefined();
    expect((await request("/library/my-channel/templates/brb.html")).headers["access-control-allow-origin"]).toBeUndefined();
    // Templates' pictures are design files a CSS mask fetches in CORS mode; an org's own media isn't.
    expect((await request("/library/my-channel/templates/_shared/brand/mark.svg")).headers["access-control-allow-origin"]).toBe("*");
    await Bun.write(join(library, "my-channel/assets/photo.jpg"), "x");
    expect((await request("/library/my-channel/assets/photo.jpg")).status).toBe(200);
    expect((await request("/library/my-channel/assets/photo.jpg")).headers["access-control-allow-origin"]).toBeUndefined();
    // A staged pack's preview copy is a template pack's design files too (covers before installing).
    await Bun.write(join(library, "my-channel/.viewswitcher/staging/0a1b2c3d4e5f60718293a4b5/covers/_shared/brand/m.svg"), "<svg/>");
    expect((await request("/library/my-channel/.viewswitcher/staging/0a1b2c3d4e5f60718293a4b5/covers/_shared/brand/m.svg")).headers["access-control-allow-origin"]).toBe("*");
    const sneaky = await request("/library/my-channel/templates/%2e%2e/assets/photo.jpg");
    expect(sneaky.headers["access-control-allow-origin"]).toBeUndefined();
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
