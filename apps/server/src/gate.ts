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

const PROXY_HEADERS = ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "forwarded"];

/** 127.0.0.0/8 and ::1, also as IPv4-mapped IPv6. */
export function loopbackAddress(addr: string | null | undefined): boolean {
  if (!addr) return false;
  const a = addr.toLowerCase().replace(/^::ffff:/, "");
  return a === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}

/** Whether a request comes from this Mac itself (see above). */
export function fromThisMac(peer: string | null | undefined, headers: Headers): boolean {
  return loopbackAddress(peer) && loopbackHost(headers.get("host")) && !PROXY_HEADERS.some((h) => headers.has(h));
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
  const page = (method === "GET" || method === "HEAD") && path !== "/ws" && !path.startsWith("/api/") && !path.startsWith("/library/") && !path.startsWith("/assets/") && !/\.[a-z0-9]+$/i.test(path);
  return page ? { kind: "pair-page" } : { kind: "deny" };
}
