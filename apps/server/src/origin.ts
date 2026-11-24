// Which pages may change things (POST) on this server. A browser on this Mac can be at any
// website, and a website can send a "simple" cross-site POST (text/plain, no preflight) to
// 127.0.0.1:7420 — go on air, start the stream, rearrange OBS. Browsers say where a request
// comes from in Origin, so a POST whose Origin is some other site is refused.
//
// Allowed: no Origin (curl, the Mac app's own process, the OBS plugin), this Mac's loopback
// addresses on any port (the server itself, the iPad over USB at 127.0.0.1:7420, Vite on :5173),
// the host the request was made to (the same page, e.g. through `tailscale serve`, which forwards
// the Host header), and anything listed in VIEWSWITCHER_ORIGINS. A website can't have a loopback
// origin, and a cross-site request can't set Host or X-Forwarded-Host to ours without a preflight.

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

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
  return [host, forwardedHost].some((h) => !!h && h.toLowerCase() === url.host.toLowerCase());
}
