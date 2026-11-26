import { describe, expect, test } from "bun:test";
import { hostTrusted, originAllowed, pageProto } from "./origin";

const at = (host: string, extra?: string[], proto?: "http" | "https") => ({ host, extra, proto });

describe("originAllowed (state-changing requests): exactly this server's own origin", () => {
  test("refuses other websites, including a no-cors text/plain POST from one", () => {
    expect(originAllowed("https://evil.example", at("127.0.0.1:7420"))).toBe(false);
    expect(originAllowed("http://192.168.1.20:7420", at("127.0.0.1:7420"))).toBe(false);
    expect(originAllowed("https://someone.ts.net", at("127.0.0.1:7420"))).toBe(false);
  });
  test("refuses another page on this Mac: another port, another loopback name, another scheme", () => {
    expect(originAllowed("http://localhost:8000", at("127.0.0.1:7420"))).toBe(false);
    expect(originAllowed("http://127.0.0.1:8000", at("127.0.0.1:7420"))).toBe(false);
    expect(originAllowed("http://localhost:7420", at("127.0.0.1:7420"))).toBe(false);
    expect(originAllowed("http://localhost:5173", at("localhost:7420"))).toBe(false);
    expect(originAllowed("https://127.0.0.1:7420", at("127.0.0.1:7420"))).toBe(false);
  });
  test("refuses opaque and odd origins", () => {
    for (const o of ["null", "file://", "capacitor://localhost", "not a url"]) expect(originAllowed(o, at("127.0.0.1:7420"))).toBe(false);
  });
  test("allows requests without an Origin (curl, the Mac app, scripts)", () => {
    expect(originAllowed(null, at("127.0.0.1:7420"))).toBe(true);
  });
  test("allows this Mac's own pages: the switcher, the OBS browser source, the iPad over USB, Vite (its proxy keeps the Host)", () => {
    expect(originAllowed("http://127.0.0.1:7420", at("127.0.0.1:7420"))).toBe(true);
    expect(originAllowed("http://localhost:7420", at("localhost:7420"))).toBe(true);
    expect(originAllowed("http://localhost:5173", at("localhost:5173"))).toBe(true);
    expect(originAllowed("http://[::1]:7420", at("[::1]:7420"))).toBe(true);
    expect(originAllowed("http://localhost", at("localhost:80"))).toBe(true);
  });
  test("allows the page's own host behind tailscale serve, over https", () => {
    expect(originAllowed("https://mac.tail1234.ts.net", at("mac.tail1234.ts.net", undefined, "https"))).toBe(true);
    expect(originAllowed("https://MAC.tail1234.ts.net", at("mac.tail1234.ts.net", undefined, "https"))).toBe(true);
    expect(originAllowed("https://mac.tail1234.ts.net", at("mac.tail1234.ts.net"))).toBe(false);
  });
  test("allows origins listed in VIEWSWITCHER_ORIGINS", () => {
    expect(originAllowed("https://switcher.example.com", at("127.0.0.1:7420", ["https://switcher.example.com/"]))).toBe(true);
  });
});

describe("pageProto: the scheme a page came over", () => {
  test("tailscale serve's X-Forwarded-Proto, else the request's own", () => {
    expect(pageProto(new URL("http://x/"), new Headers({ "x-forwarded-proto": "https" }))).toBe("https");
    expect(pageProto(new URL("http://x/"), new Headers({ "x-forwarded-proto": "gopher" }))).toBe("http");
    expect(pageProto(new URL("http://x/"), new Headers())).toBe("http");
  });
});

describe("DNS rebinding (evil.example → 127.0.0.1)", () => {
  test("a rebound page's same-host Origin is refused", () => {
    expect(originAllowed("http://evil.example:7420", at("evil.example:7420"))).toBe(false);
  });
  test("hostTrusted refuses evil.example:7420 and allows the names this server is known by", () => {
    expect(hostTrusted("evil.example:7420")).toBe(false);
    expect(hostTrusted("evil.example")).toBe(false);
    expect(hostTrusted("127.0.0.1.evil.example:7420")).toBe(false);
    expect(hostTrusted("localhost.evil.example")).toBe(false);
    expect(hostTrusted(null)).toBe(false);
    expect(hostTrusted("")).toBe(false);
    for (const h of ["127.0.0.1:7420", "localhost:5173", "[::1]:7420", "LOCALHOST", "mac.tail1234.ts.net"]) expect(hostTrusted(h)).toBe(true);
  });
  test("VIEWSWITCHER_ORIGINS hosts are trusted", () => {
    expect(hostTrusted("switcher.example.com", ["https://switcher.example.com"])).toBe(true);
    expect(hostTrusted("192.168.1.20:7420", ["http://192.168.1.20:7420"])).toBe(true);
    expect(hostTrusted("192.168.1.20:7420")).toBe(false);
  });
});

describe("Wi-Fi (MAC-25): this Mac's .local name and LAN addresses", () => {
  const lan = { localName: "studio-mac.local", addresses: ["192.168.1.68", "10.0.0.4"] };
  test("are trusted only while the Wi-Fi listener is on", () => {
    for (const h of ["studio-mac.local:7420", "STUDIO-MAC.local", "192.168.1.68:7420", "10.0.0.4"]) {
      expect(hostTrusted(h, [], lan)).toBe(true);
      expect(hostTrusted(h)).toBe(false);
    }
  });
  test("other .local names and addresses are not: a device on the LAN can answer mDNS for any name", () => {
    for (const h of ["evil.local", "studio-mac.local.evil.example", "192.168.1.69:7420", "192.168.1.6"]) expect(hostTrusted(h, [], lan)).toBe(false);
  });
  test("a paired phone's same-host POST is allowed; a page elsewhere on the LAN is not", () => {
    expect(originAllowed("http://192.168.1.68:7420", { host: "192.168.1.68:7420", lan })).toBe(true);
    expect(originAllowed("http://studio-mac.local:7420", { host: "studio-mac.local:7420", lan })).toBe(true);
    expect(originAllowed("http://192.168.1.68:7420", { host: "192.168.1.68:7420" })).toBe(false); // Wi-Fi off
    expect(originAllowed("http://192.168.1.20:7420", { host: "192.168.1.68:7420", lan })).toBe(false);
    expect(originAllowed("http://evil.local:7420", { host: "evil.local:7420", lan })).toBe(false);
  });
});
