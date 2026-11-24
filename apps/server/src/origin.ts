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
// header), *.local (Bonjour names on the LAN), and the hosts in VIEWSWITCHER_ORIGINS. Rebinding
// needs a domain the attacker controls; none of these are.

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

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

/** Whether a Host header names this server (see above). */
export function hostTrusted(host: string | null, extra: string[] = []): boolean {
  if (!host) return false;
  const name = hostname(host);
  if (!name || /[^a-z0-9.\-\[\]:]/.test(name)) return false;
  return LOOPBACK.has(name) || name.endsWith(".ts.net") || name.endsWith(".local") || originHosts(extra).includes(name);
}

export function originAllowed(
  origin: string | null,
  { host, forwardedHost, extra = [] }: { host: string | null; forwardedHost?: string | null; extra?: string[] },
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
  return [host, forwardedHost].some((h) => !!h && h.toLowerCase() === url.host.toLowerCase() && hostTrusted(h, extra));
}
