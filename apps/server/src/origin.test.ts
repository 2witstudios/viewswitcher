import { describe, expect, test } from "bun:test";
import { hostTrusted, originAllowed } from "./origin";

const at = (host: string, extra?: string[], forwardedHost?: string) => ({ host, extra, forwardedHost });

describe("originAllowed (state-changing POSTs)", () => {
  test("refuses other websites, including a no-cors text/plain POST from one", () => {
    expect(originAllowed("https://evil.example", at("127.0.0.1:7420"))).toBe(false);
    expect(originAllowed("http://192.168.1.20:7420", at("127.0.0.1:7420"))).toBe(false);
    expect(originAllowed("https://someone.ts.net", at("127.0.0.1:7420"))).toBe(false);
  });
  test("refuses opaque and odd origins", () => {
    for (const o of ["null", "file://", "capacitor://localhost", "not a url"]) expect(originAllowed(o, at("127.0.0.1:7420"))).toBe(false);
  });
  test("allows requests without an Origin (curl, the Mac app, scripts)", () => {
    expect(originAllowed(null, at("127.0.0.1:7420"))).toBe(true);
  });
  test("allows this Mac: the switcher, the OBS browser source, the iPad over USB, Vite on :5173", () => {
    expect(originAllowed("http://127.0.0.1:7420", at("127.0.0.1:7420"))).toBe(true);
    expect(originAllowed("http://localhost:7420", at("localhost:7420"))).toBe(true);
    expect(originAllowed("http://localhost:5173", at("localhost:5173"))).toBe(true); // Vite's proxy keeps its own Host
    expect(originAllowed("http://[::1]:7420", at("[::1]:7420"))).toBe(true);
  });
  test("allows the page's own host behind a proxy (tailscale serve), by Host or X-Forwarded-Host", () => {
    expect(originAllowed("https://mac.tail1234.ts.net", at("mac.tail1234.ts.net"))).toBe(true);
    expect(originAllowed("https://mac.tail1234.ts.net", at("127.0.0.1:7420", undefined, "mac.tail1234.ts.net"))).toBe(true);
    expect(originAllowed("https://MAC.tail1234.ts.net", at("mac.tail1234.ts.net"))).toBe(true);
  });
  test("allows origins listed in VIEWSWITCHER_ORIGINS", () => {
    expect(originAllowed("https://switcher.example.com", at("127.0.0.1:7420", ["https://switcher.example.com/"]))).toBe(true);
  });
});

describe("DNS rebinding (evil.example → 127.0.0.1)", () => {
  test("a rebound page's same-host Origin is refused", () => {
    expect(originAllowed("http://evil.example:7420", at("evil.example:7420"))).toBe(false);
    expect(originAllowed("http://evil.example:7420", at("127.0.0.1:7420", undefined, "evil.example:7420"))).toBe(false);
  });
  test("hostTrusted refuses evil.example:7420 and allows the names this server is known by", () => {
    expect(hostTrusted("evil.example:7420")).toBe(false);
    expect(hostTrusted("evil.example")).toBe(false);
    expect(hostTrusted("127.0.0.1.evil.example:7420")).toBe(false);
    expect(hostTrusted("localhost.evil.example")).toBe(false);
    expect(hostTrusted(null)).toBe(false);
    expect(hostTrusted("")).toBe(false);
    for (const h of ["127.0.0.1:7420", "localhost:5173", "[::1]:7420", "LOCALHOST", "mac.tail1234.ts.net", "studio-mac.local:7420"]) expect(hostTrusted(h)).toBe(true);
  });
  test("VIEWSWITCHER_ORIGINS hosts are trusted", () => {
    expect(hostTrusted("switcher.example.com", ["https://switcher.example.com"])).toBe(true);
    expect(hostTrusted("192.168.1.20:7420", ["http://192.168.1.20:7420"])).toBe(true);
    expect(hostTrusted("192.168.1.20:7420")).toBe(false);
  });
});
