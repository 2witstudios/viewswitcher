import { describe, expect, test } from "bun:test";
import { admits, type Audience, type Caller, callerOf, isMacOrUsb, loopbackAddress, pageLoad, rateKey } from "./gate";

const h = (o: Record<string, string>) => new Headers(o);

describe("isMacOrUsb: the socket is loopback, the Host a loopback name, and no proxy headers", () => {
  test("loopback addresses", () => {
    for (const a of ["127.0.0.1", "127.8.0.1", "::1", "::ffff:127.0.0.1"]) expect(loopbackAddress(a)).toBe(true);
    for (const a of ["192.168.1.20", "10.0.0.1", "::ffff:192.168.1.20", "fe80::1", "", null, undefined, "127.0.0.1.evil", "1127.0.0.1"]) expect(loopbackAddress(a)).toBe(false);
  });
  test("the Mac app, OBS's program page, a browser on the Mac, the USB-C iPad (its tunnel ends on 127.0.0.1), Vite", () => {
    for (const host of ["127.0.0.1:7420", "localhost:7420", "[::1]:7420", "localhost:5173"]) expect(isMacOrUsb({ address: "127.0.0.1" }, h({ host }))).toBe(true);
    expect(isMacOrUsb({ address: "::1" }, h({ host: "localhost:7420" }))).toBe(true);
  });
  test("a Wi-Fi device is not, whatever it says", () => {
    expect(isMacOrUsb({ address: "192.168.1.20" }, h({ host: "127.0.0.1:7420" }))).toBe(false);
    expect(isMacOrUsb({ address: "192.168.1.20" }, h({ host: "studio.local:7420", "x-forwarded-for": "127.0.0.1" }))).toBe(false);
  });
  test("proxy headers make loopback untrusted (tailscale serve forwards from 127.0.0.1)", () => {
    for (const p of ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port", "x-forwarded-server", "x-real-ip", "forwarded", "via", "x-client-ip", "cf-connecting-ip", "true-client-ip", "x-original-forwarded-for"]) {
      expect(isMacOrUsb({ address: "127.0.0.1" }, h({ host: "127.0.0.1:7420", [p]: "127.0.0.1" }))).toBe(false);
    }
    expect(isMacOrUsb({ address: "127.0.0.1" }, h({ host: "mac.tail1234.ts.net" }))).toBe(false);
  });
  test("DNS rebinding to 127.0.0.1 (Host evil.example) is not this Mac", () => {
    expect(isMacOrUsb({ address: "127.0.0.1" }, h({ host: "evil.example:7420" }))).toBe(false);
    expect(isMacOrUsb({ address: "127.0.0.1" }, h({}))).toBe(false);
  });
});

describe("callerOf: who is asking", () => {
  const who = (o: { onLan?: boolean; address: string; port?: number; host?: string; device?: string | null; headers?: Record<string, string> }) =>
    callerOf({ onLan: !!o.onLan, peer: { address: o.address, port: o.port }, headers: h({ host: o.host ?? "127.0.0.1:7420", ...o.headers }), device: () => o.device ?? null, bridged: new Set([51234]) });
  test("this Mac, and the USB-C bridge by its marked connection", () => {
    expect(who({ address: "127.0.0.1", port: 50000 })).toEqual({ kind: "mac" });
    expect(who({ address: "127.0.0.1", port: 51234 })).toEqual({ kind: "usb" });
  });
  test("anything else is a paired device by its token, or a stranger", () => {
    expect(who({ address: "192.168.1.20", host: "192.168.1.68:7420", device: "d1" })).toEqual({ kind: "device", device: "d1" });
    expect(who({ address: "192.168.1.20", host: "192.168.1.68:7420" })).toEqual({ kind: "stranger" });
    // tailscale serve forwards from 127.0.0.1 with proxy headers: never this Mac.
    expect(who({ address: "127.0.0.1", headers: { "x-forwarded-for": "100.64.0.9" } })).toEqual({ kind: "stranger" });
  });
  test("the Wi-Fi listener is never this Mac, whatever the peer says", () => {
    expect(who({ onLan: true, address: "127.0.0.1" })).toEqual({ kind: "stranger" });
  });
  test("a device token is only looked at for remote callers", () => {
    let asked = 0;
    callerOf({ onLan: false, peer: { address: "127.0.0.1" }, headers: h({ host: "localhost:7420" }), device: () => (asked++, "d1") });
    expect(asked).toBe(0);
  });
});

describe("admits: who each audience is for", () => {
  const callers: Caller[] = [{ kind: "mac" }, { kind: "usb" }, { kind: "device", device: "d1" }, { kind: "stranger" }];
  const table = (a: Audience) => callers.map((c) => admits(a, c));
  test("mac, macOrUsb, paired, public", () => {
    expect(table("mac")).toEqual([true, false, false, false]);
    expect(table("macOrUsb")).toEqual([true, true, false, false]);
    expect(table("paired")).toEqual([true, true, true, false]);
    expect(table("public")).toEqual([true, true, true, true]);
  });
});

describe("pageLoad: what a stranger gets the pairing page for", () => {
  test("page loads only; the API, the library, the socket, the agents' endpoint and files get a 401", () => {
    for (const p of ["/", "/program", "/pair", "/edit/x", "/libraryish"]) expect(pageLoad("GET", p)).toBe(true);
    expect(pageLoad("HEAD", "/")).toBe(true);
    for (const p of ["/api/state", "/api/info", "/library/a/org.json", "/ws", "/mcp", "/assets/index-x.js", "/favicon.svg", "/api", "/library", "/assets", "/ws/"]) expect(pageLoad("GET", p)).toBe(false);
    expect(pageLoad("POST", "/")).toBe(false);
  });
});

describe("rateKey: the pairing rate limit's bucket", () => {
  test("a device's own address, whatever headers it sends", () => {
    expect(rateKey("192.168.1.20", new Headers({ "x-forwarded-for": "1.2.3.4" }))).toBe("192.168.1.20");
    expect(rateKey("127.0.0.1", new Headers({ host: "127.0.0.1" }))).toBe("127.0.0.1");
  });
  test("behind a local proxy, the client the proxy added (the last X-Forwarded-For entry), so tailnet devices don't share one bucket", () => {
    expect(rateKey("127.0.0.1", new Headers({ "x-forwarded-for": "6.6.6.6, 100.64.0.9" }))).toBe("fwd:100.64.0.9");
    expect(rateKey("127.0.0.1", new Headers({ "x-forwarded-for": "100.64.0.10" }))).toBe("fwd:100.64.0.10");
    expect(rateKey("::1", new Headers({ via: "1.1 proxy" }))).toBe("::1");
  });
});
