import { describe, expect, test } from "bun:test";
import { fromThisMac, gate, loopbackAddress, rateKey } from "./gate";

const h = (o: Record<string, string>) => new Headers(o);

describe("fromThisMac: the socket is loopback, the Host a loopback name, and no proxy headers", () => {
  test("loopback addresses", () => {
    for (const a of ["127.0.0.1", "127.8.0.1", "::1", "::ffff:127.0.0.1"]) expect(loopbackAddress(a)).toBe(true);
    for (const a of ["192.168.1.20", "10.0.0.1", "::ffff:192.168.1.20", "fe80::1", "", null, undefined, "127.0.0.1.evil", "1127.0.0.1"]) expect(loopbackAddress(a)).toBe(false);
  });
  test("the Mac app, OBS's program page, a browser on the Mac, the USB-C iPad (its tunnel ends on 127.0.0.1), Vite", () => {
    for (const host of ["127.0.0.1:7420", "localhost:7420", "[::1]:7420", "localhost:5173"]) expect(fromThisMac("127.0.0.1", h({ host }))).toBe(true);
    expect(fromThisMac("::1", h({ host: "localhost:7420" }))).toBe(true);
  });
  test("a Wi-Fi device is not, whatever it says", () => {
    expect(fromThisMac("192.168.1.20", h({ host: "127.0.0.1:7420" }))).toBe(false);
    expect(fromThisMac("192.168.1.20", h({ host: "studio.local:7420", "x-forwarded-for": "127.0.0.1" }))).toBe(false);
  });
  test("proxy headers make loopback untrusted (tailscale serve forwards from 127.0.0.1)", () => {
    for (const p of ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port", "x-forwarded-server", "x-real-ip", "forwarded", "via", "x-client-ip", "cf-connecting-ip", "true-client-ip", "x-original-forwarded-for"]) {
      expect(fromThisMac("127.0.0.1", h({ host: "127.0.0.1:7420", [p]: "127.0.0.1" }))).toBe(false);
    }
    expect(fromThisMac("127.0.0.1", h({ host: "mac.tail1234.ts.net" }))).toBe(false);
  });
  test("DNS rebinding to 127.0.0.1 (Host evil.example) is not this Mac", () => {
    expect(fromThisMac("127.0.0.1", h({ host: "evil.example:7420" }))).toBe(false);
    expect(fromThisMac("127.0.0.1", h({}))).toBe(false);
  });
});

describe("gate", () => {
  const g = (local: boolean, paired: boolean, path: string, method = "GET") => gate({ local, paired, method, path }).kind;
  test("this Mac and paired devices pass everywhere", () => {
    for (const p of ["/", "/program", "/api/state", "/library/a/org.json", "/ws", "/assets/index-x.js"]) {
      expect(g(true, false, p)).toBe("pass");
      expect(g(false, true, p)).toBe("pass");
    }
  });
  test("an unpaired device gets the pairing page for pages, and 401 for everything else", () => {
    for (const p of ["/", "/program", "/pair", "/edit/x"]) expect(g(false, false, p)).toBe("pair-page");
    expect(g(false, false, "/", "HEAD")).toBe("pair-page");
    for (const p of ["/api/state", "/api/info", "/api/remote", "/library/a/org.json", "/ws", "/assets/index-x.js", "/favicon.svg"]) expect(g(false, false, p)).toBe("deny");
    expect(g(false, false, "/api/onair", "POST")).toBe("deny");
    expect(g(false, false, "/", "POST")).toBe("deny");
  });
  test("an unpaired device may POST /api/pair, and nothing else", () => {
    expect(g(false, false, "/api/pair", "POST")).toBe("pair");
    expect(g(false, false, "/api/pair", "GET")).toBe("deny");
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
