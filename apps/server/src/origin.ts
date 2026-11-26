// Who may talk to this server. It listens on 127.0.0.1, but a browser on this Mac can be at any
// website, or at another page served from this Mac (a dev server on another port), and those pages
// can reach it two ways:
//
// - Cross-origin requests. A "simple" POST (text/plain, no preflight) to 127.0.0.1:7420 could go on
//   air, start the stream or rearrange OBS. Browsers say where a request comes from in Origin, so a
//   state-changing request must come from exactly this server's own origin (scheme, host and port)
//   or one in VIEWSWITCHER_ORIGINS (originAllowed). Another port on localhost is another origin.
//   The dispatcher also asks for a JSON (or, for uploads, multipart) body, which no page can send
//   to another origin without a CORS preflight this server never grants.
// - DNS rebinding. evil.example first resolves to the attacker, then to 127.0.0.1: the page is now
//   "same-origin" with this server, and reads and writes it with Host: evil.example:7420. So every
//   request must be addressed to a host this server is really known by (hostTrusted), and the
//   Origin check only trusts "same origin" for those hosts.
//
// Trusted hosts: this Mac's loopback names, *.ts.net (tailscale serve, which forwards the Host
// header; developer-only, and only while remote access is on), the hosts in VIEWSWITCHER_ORIGINS,
// and, while phones and tablets may connect over Wi-Fi, this Mac's own Bonjour name (<name>.local)
// and its current LAN addresses. Rebinding needs a domain the attacker controls; none of these are.
// (Only this Mac's .local name is trusted: a device on the LAN can answer mDNS for any name.)
//
// Passing the host guard isn't being let in: each route declares who it is for (http/routes.ts).

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

/** VIEWSWITCHER_ORIGINS entry → its origin ("https://switcher.example.com/" → "https://switcher.example.com"); null if it isn't one. */
const originOf = (o: string) => {
  try {
    const u = new URL(o);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
};

/**
 * Whether a request's Origin may change things: none at all (native clients, curl: no page is
 * involved), exactly the request's own origin (`proto`://`host`, for a host this server is known by),
 * or one in VIEWSWITCHER_ORIGINS. "null" (a sandboxed scene, file:) and every other origin are refused.
 * `proto` is the scheme the page was loaded over: https behind tailscale serve, else http.
 */
export function originAllowed(
  origin: string | null,
  { host, proto = "http", extra = [], lan = null }: { host: string | null; proto?: "http" | "https"; extra?: string[]; lan?: Lan },
): boolean {
  if (origin === null) return true;
  const from = originOf(origin);
  if (!from) return false;
  if (extra.some((o) => originOf(o) === from)) return true;
  if (!host || !hostTrusted(host, extra, lan)) return false;
  return originOf(`${proto}://${host}`) === from;
}

/**
 * The scheme the page reached this server over, for its own origin: https behind tailscale serve,
 * which says so in X-Forwarded-Proto, else the request's own. A page can't set that header on a
 * request to another origin without a preflight, so it can't use it to pass for this server.
 */
export function pageProto(url: URL, headers: Headers): "http" | "https" {
  const forwarded = headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded === "http" || forwarded === "https") return forwarded;
  return url.protocol === "https:" ? "https" : "http";
}
