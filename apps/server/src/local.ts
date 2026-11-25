// Whether a request comes from this Mac itself, for the things only this Mac may see or use:
// /api/info (an absolute path) and /mcp (an agent that can change the library).
// The connection must come from loopback, be addressed to a loopback host, and carry no proxy
// headers: tailscale serve also connects from 127.0.0.1, but adds X-Forwarded-For. And it must not
// be the iPad: the USB-C bridge (usb-bridge.ts) pipes the iPad's bytes, unchanged, into a socket it
// opens from 127.0.0.1, with Host: 127.0.0.1. So the bridge records the local port of each socket it
// opens (bridgePorts), and a request on one of those is the iPad's, not this Mac's.

const LOOPBACK_PEERS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** The local ports of the USB-C bridge's open connections to this server (the iPad's requests). */
export const bridgePorts = new Set<number>();

/** The other end of a request's connection (Bun's server.requestIP). */
export type Peer = { address: string; port?: number } | null | undefined;

export function isLocalRequest(req: Request, peer: Peer, bridged: ReadonlySet<number> = bridgePorts): boolean {
  const h = req.headers;
  return (
    !!peer && LOOPBACK_PEERS.has(peer.address) &&
    !(peer.port !== undefined && bridged.has(peer.port)) &&
    /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(h.get("host") ?? "") &&
    !h.has("x-forwarded-for") && !h.has("x-forwarded-host") && !h.has("forwarded")
  );
}
