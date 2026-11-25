// Whether a request comes from this Mac itself, for the things only this Mac may see or use:
// /api/info (an absolute path) and /mcp (an agent that can change the library).
// The connection must come from loopback, be addressed to a loopback host, and carry no proxy
// headers: tailscale serve also connects from 127.0.0.1, but adds X-Forwarded-For.

const LOOPBACK_PEERS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function isLocalRequest(req: Request, peer: string | null | undefined): boolean {
  const h = req.headers;
  return (
    LOOPBACK_PEERS.has(peer ?? "") &&
    /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(h.get("host") ?? "") &&
    !h.has("x-forwarded-for") && !h.has("x-forwarded-host") && !h.has("forwarded")
  );
}
