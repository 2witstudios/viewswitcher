// Who may talk to this server. It listens on 127.0.0.1, but a browser on this Mac can be at any
// website, and that website can reach it two ways:
//
// - Cross-site requests. A "simple" POST (text/plain, no preflight) to 127.0.0.1:7420 could go on
//   air, start the stream or rearrange OBS. Browsers say where a request comes from in Origin, so a
//   state-changing request whose Origin is some other site is refused (originAllowed).
// - DNS rebinding. evil.example first resolves to the attacker, then to 127.0.0.1: the page is now
//   "same-origin" with this server, and reads and writes it with Host: evil.example:7420. So every
//   request to /api, /library and /ws must be addressed to a host this server is really known by
//   (hostTrusted), and the Origin check only trusts "same host" for those hosts.
//
// Trusted hosts: this Mac's loopback names, *.ts.net (tailscale serve, which forwards the Host
// header), the hosts in VIEWSWITCHER_ORIGINS, and, while phones and tablets may connect over Wi-Fi
// (MAC-23), this Mac's own Bonjour name (<name>.local) and its current LAN addresses. Rebinding
// needs a domain the attacker controls; none of these are. (Any *.local was trusted before MAC-25; a
// device on the LAN can answer mDNS for a name of its choosing, so now only this Mac's name is.)
//
// Passing the host guard isn't being let in: anything that isn't from this Mac itself also needs a
// paired device token (gate.ts).

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** While Wi-Fi devices may connect: this Mac's .local name and LAN addresses (lan.ts). */
export type Lan = { localName?: string | null; addresses?: string[] } | null;

/** "mac.tail1.ts.net:443" → "mac.tail1.ts.net", "[::1]:7420" → "[::1]". */
const hostname = (host: string) => host.replace(/:\d+$/, "").toLowerCase();

const originHosts = (extra: string[]) =>
  extra.flatMap((o) => {
    try {
      return [new URL(o).hostname.toLowerCase()];
    } catch {
      return [];
    }
  });

/** Whether a Host header is one of this Mac's loopback names. */
export const loopbackHost = (host: string | null) => !!host && LOOPBACK.has(hostname(host));

/** Whether a Host header names this server (see above). */
export function hostTrusted(host: string | null, extra: string[] = [], lan: Lan = null): boolean {
  if (!host) return false;
  const name = hostname(host);
  if (!name || /[^a-z0-9.\-\[\]:]/.test(name)) return false;
  if (lan && ((lan.localName && name === lan.localName.toLowerCase()) || lan.addresses?.includes(name))) return true;
  return LOOPBACK.has(name) || name.endsWith(".ts.net") || originHosts(extra).includes(name);
}

export function originAllowed(
  origin: string | null,
  { host, forwardedHost, extra = [], lan = null }: { host: string | null; forwardedHost?: string | null; extra?: string[]; lan?: Lan },
): boolean {
  if (origin === null) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false; // "null" (sandboxed frames, file:) and anything unparsable
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (LOOPBACK.has(url.hostname)) return true;
  if (extra.some((o) => o.replace(/\/+$/, "") === url.origin)) return true;
  // The page's own host (e.g. through tailscale serve), but only a host this server is known by.
  return [host, forwardedHost].some((h) => !!h && h.toLowerCase() === url.host.toLowerCase() && hostTrusted(h, extra, lan));
}
