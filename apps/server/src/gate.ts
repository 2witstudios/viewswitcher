// Who is asking, by audience (http/routes.ts declares which audience each route is for):
//
// - mac: this Mac itself. The Mac app, a browser on the Mac, OBS's program page.
// - macOrUsb: that, or the iPad or iPhone on the USB-C bridge (its tunnel ends on 127.0.0.1 too).
// - paired: those, or a paired device on the Wi-Fi (or, for developers, through tailscale serve).
// - public: anyone who passes the host guard: the pairing page and its POST.
//
// Anything not from this Mac or the USB-C bridge is remote, and is served only while remote access
// (the Mac app's Wi-Fi setting) is on; without a paired device token it gets the pairing page, and
// nothing else.
//
// "This Mac" is the socket's own remote address being loopback, addressed to a loopback name, with no
// proxy headers. Proxy headers are never believed (anyone can send X-Forwarded-For), so they only ever
// make a request *less* trusted: a loopback connection carrying them was forwarded from somewhere else.
// The loopback Host keeps DNS rebinding out: a page at some other name that now resolves to 127.0.0.1
// is treated like any other device (and the host guard refuses it first).
import { loopbackHost } from "./origin";

/** Headers a proxy or forwarder adds to say who the real client is. Any x-forwarded-* counts too. */
const PROXY_HEADERS = ["forwarded", "via", "x-real-ip", "x-client-ip", "x-cluster-client-ip", "x-original-forwarded-for", "cf-connecting-ip", "true-client-ip", "fastly-client-ip"];
export const proxied = (headers: Headers) => {
  if (PROXY_HEADERS.some((h) => headers.has(h))) return true;
  for (const k of headers.keys()) if (k.startsWith("x-forwarded-")) return true;
  return false;
};

/** 127.0.0.0/8 and ::1, also as IPv4-mapped IPv6. */
export function loopbackAddress(addr: string | null | undefined): boolean {
  if (!addr) return false;
  const a = addr.toLowerCase().replace(/^::ffff:/, "");
  return a === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}

/** The other end of a request's connection (Bun's server.requestIP). */
export type Peer = { address: string; port?: number } | null | undefined;

/** The macOrUsb audience: from this Mac or the USB-C bridge (see above). */
export function isMacOrUsb(peer: Peer, headers: Headers): boolean {
  return loopbackAddress(peer?.address) && loopbackHost(headers.get("host")) && !proxied(headers);
}

/**
 * The local ports of the USB-C bridge's connections to this server (usb-bridge.ts marks each one before
 * it sends the iPad's first byte, and forgets it on close). The iPad's tunnel ends on 127.0.0.1 with a
 * loopback Host, so isMacOrUsb passes it, as the switcher should; these ports tell it apart.
 */
export const bridgePorts = new Set<number>();

const bridgedPeer = (peer: Peer, bridged: ReadonlySet<number>) => peer?.port !== undefined && bridged.has(peer.port);

/**
 * The mac audience: this Mac itself and nothing else, not the iPad over the USB-C bridge. For what only
 * this Mac may see or use: /mcp (an agent that can change the library), /api/info and the Claude
 * Desktop extension (absolute paths), /api/agent/clients, the Mac app's pairing admin, and a 500's message.
 */
export function isMac(peer: Peer, headers: Headers, bridged: ReadonlySet<number> = bridgePorts): boolean {
  return isMacOrUsb(peer, headers) && !bridgedPeer(peer, bridged);
}

/** Who a route may be for (http/routes.ts). A route that names none is for the Mac only. */
export const Audience = { Mac: "mac", MacOrUsb: "macOrUsb", Paired: "paired", Public: "public" } as const;
export type Audience = (typeof Audience)[keyof typeof Audience];

/** Who is asking. `device`: the paired device's id. */
export type Caller = { kind: "mac" } | { kind: "usb" } | { kind: "device"; device: string } | { kind: "stranger" };

/**
 * Who sent a request. `onLan`: it came in on the Wi-Fi listener, which is never this Mac whatever the
 * peer says. `device` looks up a paired device by the request's cookie, and is only asked for remote ones.
 */
export function callerOf(
  { onLan, peer, headers, device, bridged = bridgePorts }: { onLan: boolean; peer: Peer; headers: Headers; device: () => string | null; bridged?: ReadonlySet<number> },
): Caller {
  if (!onLan && isMacOrUsb(peer, headers)) return bridgedPeer(peer, bridged) ? { kind: "usb" } : { kind: "mac" };
  const id = device();
  return id ? { kind: "device", device: id } : { kind: "stranger" };
}

/** Whether `caller` is in `audience`. */
export function admits(audience: Audience, caller: Caller): boolean {
  switch (audience) {
    case "public":
      return true;
    case "paired":
      return caller.kind !== "stranger";
    case "macOrUsb":
      return caller.kind === "mac" || caller.kind === "usb";
    case "mac":
      return caller.kind === "mac";
  }
}

/**
 * A page load (not the API, the library, the socket or a file): what a stranger gets the pairing page for,
 * where anything else gets a 401.
 */
export function pageLoad(method: string, path: string): boolean {
  const under = (root: string) => path === root || path.startsWith(`${root}/`);
  return (method === "GET" || method === "HEAD") && !under("/ws") && !under("/mcp") && !under("/api") && !under("/library") && !under("/assets") && !/\.[a-z0-9]+$/i.test(path);
}

/** The pairing rate limit's bucket for a request: the socket's address, or for a proxied request from
 *  loopback (tailscale serve), the client the proxy names (the last X-Forwarded-For entry, the one the
 *  proxy itself added), so its devices don't share one bucket. A bucket key only, never used to decide
 *  trust; the per-code cap on wrong guesses bounds guessing whatever the key. */
export function rateKey(peer: string | null | undefined, headers: Headers): string {
  const p = peer ?? "?";
  if (!loopbackAddress(p) || !proxied(headers)) return p;
  const fwd = headers.get("x-forwarded-for")?.split(",").pop()?.trim() || headers.get("x-real-ip") || headers.get("forwarded")?.match(/for="?\[?([^\]";,]+)/i)?.[1];
  return fwd ? `fwd:${fwd.slice(0, 64)}` : p;
}
