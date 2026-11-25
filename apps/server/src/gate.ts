// Who gets in (MAC-25). A request from this Mac itself passes as it always has: the Mac app, a browser
// on the Mac, OBS's program page and the USB-C iPad (its tunnel ends on 127.0.0.1). Anything else, from
// the Wi-Fi or through a proxy such as tailscale serve, needs a paired device token; without one it
// gets the pairing page, and nothing else.
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

/** Whether a request comes from this Mac itself (see above). */
export function fromThisMac(peer: string | null | undefined, headers: Headers): boolean {
  return loopbackAddress(peer) && loopbackHost(headers.get("host")) && !proxied(headers);
}

/**
 * The local ports of the USB-C bridge's connections to this server (usb-bridge.ts marks each one before
 * it sends the iPad's first byte, and forgets it on close). The iPad's tunnel ends on 127.0.0.1 with a
 * loopback Host, so fromThisMac passes it, as the switcher should; these ports tell it apart.
 */
export const bridgePorts = new Set<number>();

/** The other end of a request's connection (Bun's server.requestIP). */
export type Peer = { address: string; port?: number } | null | undefined;

/**
 * This Mac itself and nothing else: fromThisMac, and not the iPad over the USB-C bridge. For what only
 * this Mac may see or use: /mcp (an agent that can change the library), /api/info and the Claude
 * Desktop extension (absolute paths), /api/agent/clients, and the Mac app's pairing admin.
 */
export function fromThisMacOnly(peer: Peer, headers: Headers, bridged: ReadonlySet<number> = bridgePorts): boolean {
  return fromThisMac(peer?.address, headers) && !(peer?.port !== undefined && bridged.has(peer.port));
}

export type Gate =
  /** From this Mac, or a paired device: on to the normal handlers. */
  | { kind: "pass" }
  /** Unpaired and asking to pair: POST /api/pair. */
  | { kind: "pair" }
  /** Unpaired page load: the pairing page. */
  | { kind: "pair-page" }
  /** Unpaired anything else (the API, the library, the socket, assets): 401. */
  | { kind: "deny" };

/** What to do with a request, given whether it is from this Mac and whether it carries a valid device token. */
export function gate({ local, paired, method, path }: { local: boolean; paired: boolean; method: string; path: string }): Gate {
  if (local || paired) return { kind: "pass" };
  if (path === "/api/pair" && method === "POST") return { kind: "pair" };
  const under = (root: string) => path === root || path.startsWith(`${root}/`);
  const page = (method === "GET" || method === "HEAD") && !under("/ws") && !under("/api") && !under("/library") && !under("/assets") && !/\.[a-z0-9]+$/i.test(path);
  return page ? { kind: "pair-page" } : { kind: "deny" };
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
