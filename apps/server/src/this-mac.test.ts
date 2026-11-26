import { describe, expect, test } from "bun:test";
import { isMac, isMacOrUsb, type Peer } from "./gate";

// This Mac itself (gate.ts isMac, the mac audience): what /mcp, /api/info, /api/agent/clients and the .mcpb answer.
const isLocalRequest = (r: Request, peer: Peer, bridged?: ReadonlySet<number>) => isMac(peer, r.headers, bridged);

const req = (headers: Record<string, string>) => new Request("http://127.0.0.1:7420/mcp", { headers });

describe("isMac", () => {
  test("loopback peer, loopback Host, no proxy headers", () => {
    for (const host of ["127.0.0.1:7420", "localhost:7420", "[::1]:7420", "localhost"]) {
      for (const peer of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) expect({ host, peer, ok: isLocalRequest(req({ host }), { address: peer, port: 50000 }) }).toEqual({ host, peer, ok: true });
    }
  });
  test("refuses another machine", () => {
    expect(isLocalRequest(req({ host: "127.0.0.1:7420" }), { address: "192.168.1.20" })).toBe(false);
    expect(isLocalRequest(req({ host: "127.0.0.1:7420" }), { address: "100.64.0.3" })).toBe(false);
    expect(isLocalRequest(req({ host: "127.0.0.1:7420" }), null)).toBe(false);
  });
  test("refuses a host this Mac is reached by from elsewhere", () => {
    for (const host of ["mac.tail1234.ts.net", "studio.local:7420", "evil.example:7420", ""]) expect(isLocalRequest(req({ host }), { address: "127.0.0.1" })).toBe(false);
  });
  test("refuses proxied requests (tailscale serve connects from loopback)", () => {
    for (const h of [{ "x-forwarded-for": "100.64.0.3" }, { "x-forwarded-host": "mac.tail1234.ts.net" }, { forwarded: "for=100.64.0.3" }] as Record<string, string>[]) {
      expect(isLocalRequest(req({ host: "127.0.0.1:7420", ...h }), { address: "127.0.0.1" })).toBe(false);
    }
  });
  test("the iPad through the USB-C bridge isn't this Mac: its connections' local ports are marked", () => {
    const bridged = new Set([51234]);
    const r = req({ host: "127.0.0.1:7420" });
    expect(isLocalRequest(r, { address: "127.0.0.1", port: 51234 }, bridged)).toBe(false);
    expect(isLocalRequest(r, { address: "127.0.0.1", port: 51235 }, bridged)).toBe(true);
    expect(isLocalRequest(r, { address: "127.0.0.1", port: 51234 }, new Set())).toBe(true);
    // The bridge is still macOrUsb, as the switcher should let it in: it's only the Mac's own routes it can't use.
    expect(isMacOrUsb({ address: "127.0.0.1", port: 51234 }, r.headers)).toBe(true);
  });
});
