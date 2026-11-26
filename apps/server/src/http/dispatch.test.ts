// The dispatcher's order and defaults with a route table of its own (http-guard.test.ts and
// remote.test.ts check the real server's routes over real sockets).
import { describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { type DispatchOptions, dispatcher, HttpError, type Route, type SocketData } from "./dispatch";

const LIBRARY = "/Users/someone/ViewSwitcher Library";
const MAC = { address: "127.0.0.1", port: 50000 };
const PHONE = { address: "192.168.1.20", port: 50001 };
const USB = { address: "127.0.0.1", port: 51234 };

/** A server that says who is on the other end, and whether it's the Wi-Fi listener. */
const srv = (peer: { address: string; port: number }) => ({ requestIP: () => peer }) as unknown as Server<SocketData>;

const ok = () => Response.json({ ok: true });
const ROUTES: Route[] = [
  { method: "GET", path: "/undeclared", handler: ok },
  { method: "GET", path: "/usb", audience: "macOrUsb", handler: ok },
  { method: "GET", path: "/paired", audience: "paired", handler: ok },
  { method: "POST", path: "/paired", audience: "paired", handler: async (c) => Response.json(await c.json()) },
  { method: "GET", path: "/public", audience: "public", handler: ok },
  { method: "GET", path: "/boom", audience: "paired", handler: () => Promise.reject(new Error(`EACCES: permission denied, open '${LIBRARY}/daisy/x.html'`)) },
  { method: "GET", path: "/teapot", audience: "paired", handler: () => Promise.reject(new HttpError(418, `No tea in ${LIBRARY}`)) },
];

function make(o: Partial<DispatchOptions> = {}) {
  return dispatcher({
    routes: ROUTES,
    allowedOrigins: [],
    lan: () => ({ localName: "studio.local", addresses: ["192.168.1.68"] }),
    remoteAccess: () => true,
    onLan: (s) => (s.requestIP({} as Request) as { address: string }).address !== "127.0.0.1",
    remote: (req) => (req.headers.get("cookie") === "vs_device=good" ? "phone-1" : null),
    renew: () => null,
    pairPage: () => new Response("pair", { status: 401 }),
    scrub: (m) => m.split(`${LIBRARY}/`).join("").split(LIBRARY).join("the library"),
    bridged: new Set([USB.port]),
    ...o,
  });
}

const local = (path: string, init: RequestInit = {}) => new Request(`http://127.0.0.1:7420${path}`, { ...init, headers: { host: "127.0.0.1:7420", ...(init.headers as Record<string, string>) } });
const fromPhone = (path: string, init: RequestInit = {}, cookie = "vs_device=good") =>
  new Request(`http://192.168.1.68:7420${path}`, { ...init, headers: { host: "192.168.1.68:7420", cookie, ...(init.headers as Record<string, string>) } });

describe("audiences", () => {
  test("a route that names no audience is this Mac's only: a paired phone and the USB-C device get 404, a stranger 401", async () => {
    const d = make();
    expect((await d(local("/undeclared"), srv(MAC)))!.status).toBe(200);
    expect((await d(local("/undeclared"), srv(USB)))!.status).toBe(404);
    expect((await d(fromPhone("/undeclared"), srv(PHONE)))!.status).toBe(404);
    expect((await d(fromPhone("/undeclared", {}, ""), srv(PHONE)))!.status).toBe(401);
  });
  test("an unknown path is the same as an undeclared route", async () => {
    const d = make();
    expect((await d(local("/nowhere"), srv(MAC)))!.status).toBe(404);
    expect((await d(fromPhone("/api/nowhere"), srv(PHONE)))!.status).toBe(404);
    expect((await d(fromPhone("/api/nowhere", {}, ""), srv(PHONE)))!.status).toBe(401);
    // A page load from a stranger gets the pairing page instead.
    expect(await (await d(fromPhone("/nowhere", {}, ""), srv(PHONE)))!.text()).toBe("pair");
  });
  test("macOrUsb, paired and public", async () => {
    const d = make();
    const status = async (path: string) => [
      (await d(local(path), srv(MAC)))!.status,
      (await d(local(path), srv(USB)))!.status,
      (await d(fromPhone(path), srv(PHONE)))!.status,
      (await d(fromPhone(path, {}, ""), srv(PHONE)))!.status,
    ];
    expect(await status("/usb")).toEqual([200, 200, 404, 401]);
    expect(await status("/paired")).toEqual([200, 200, 200, 401]);
    expect(await status("/public")).toEqual([200, 200, 200, 200]);
  });
  test("remote access off: nothing from elsewhere, not even the public routes or a paired token", async () => {
    const d = make({ remoteAccess: () => false });
    expect((await d(fromPhone("/public"), srv(PHONE)))!.status).toBe(403);
    expect((await d(fromPhone("/paired"), srv(PHONE)))!.status).toBe(403);
    const proxied = local("/paired", { headers: { "x-forwarded-for": "100.64.0.9" } });
    expect((await d(proxied, srv(MAC)))!.status).toBe(403);
    expect((await d(local("/paired"), srv(USB)))!.status).toBe(200);
  });
});

describe("order: host, audience, Origin, Content-Type, handler", () => {
  test("an unknown host is refused before anything else", async () => {
    const r = await make()(new Request("http://127.0.0.1:7420/paired", { headers: { host: "evil.example" } }), srv(MAC));
    expect(r!.status).toBe(421);
  });
  test("a stranger's POST is a 401 whatever its Origin; a paired one needs the server's own Origin, then JSON", async () => {
    const d = make();
    const post = (headers: Record<string, string>, cookie?: string) => d(fromPhone("/paired", { method: "POST", headers, body: '{"a":1}' }, cookie), srv(PHONE));
    expect((await post({ origin: "https://evil.example", "content-type": "text/plain" }, ""))!.status).toBe(401);
    expect((await post({ origin: "https://evil.example", "content-type": "text/plain" }))!.status).toBe(403);
    expect((await post({ origin: "http://192.168.1.68:7420", "content-type": "text/plain" }))!.status).toBe(415);
    const r = await post({ origin: "http://192.168.1.68:7420", "content-type": "application/json" });
    expect(r!.status).toBe(200);
    expect(await r!.json()).toEqual({ a: 1 });
  });
  test("a WebSocket upgrade's Origin is checked like a POST's", async () => {
    const d = make();
    const r = await d(local("/paired", { headers: { upgrade: "websocket", origin: "http://localhost:8000" } }), srv(MAC));
    expect(r!.status).toBe(403);
  });
});

describe("the response wrapper", () => {
  test("frame-ancestors and nosniff on everything outside /library/, refusals included", async () => {
    const d = make();
    for (const [req, peer] of [[local("/paired"), MAC], [local("/nowhere"), MAC], [fromPhone("/undeclared"), PHONE], [local("/paired", { method: "POST", body: "x" }), MAC]] as const) {
      const r = (await d(req, srv(peer)))!;
      expect([r.headers.get("content-security-policy"), r.headers.get("x-content-type-options")]).toEqual(["frame-ancestors 'self'", "nosniff"]);
    }
  });
  test("a page's own CSP keeps its own frame-ancestors, and gets one if it has none", async () => {
    const withCsp = (csp: string): Route => ({ method: "GET", path: "/csp", audience: "public", handler: () => new Response("x", { headers: { "content-security-policy": csp } }) });
    expect((await make({ routes: [withCsp("default-src 'none'; frame-ancestors 'none'")] })(local("/csp"), srv(MAC)))!.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    expect((await make({ routes: [withCsp("default-src 'none'")] })(local("/csp"), srv(MAC)))!.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'self'");
  });
  test("/library/ keeps its own headers", async () => {
    const lib: Route = { method: "GET", path: (p) => p.startsWith("/library/"), audience: "paired", handler: () => new Response("x", { headers: { "content-security-policy": "sandbox allow-scripts" } }) };
    const r = (await make({ routes: [lib] })(local("/library/a/b.html"), srv(MAC)))!;
    expect(r.headers.get("content-security-policy")).toBe("sandbox allow-scripts");
  });
  test("a 500's message, scrubbed, only for this Mac; the USB-C device and phones get a plain one", async () => {
    const d = make();
    const mac = (await (await d(local("/boom"), srv(MAC)))!.json()) as { error: string };
    expect(mac.error).toBe("EACCES: permission denied, open 'daisy/x.html'");
    for (const [req, peer] of [[local("/boom"), USB], [fromPhone("/boom"), PHONE]] as const) {
      const r = (await d(req, srv(peer)))!;
      expect(r.status).toBe(500);
      expect(((await r.json()) as { error: string }).error).toBe("Something went wrong on the Mac. Its server log has the details.");
    }
  });
  test("a refusal from a handler keeps its status, scrubbed, for anyone", async () => {
    const r = (await make()(fromPhone("/teapot"), srv(PHONE)))!;
    expect(r.status).toBe(418);
    expect(((await r.json()) as { error: string }).error).toBe("No tea in the library");
  });
});
