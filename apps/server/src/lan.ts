// This Mac on the local network (MAC-23): its IPv4 addresses and its Bonjour name (<name>.local), for
// the host guard (origin.ts) and the addresses the pairing QR code points at. Both can change while
// the server runs (a new Wi-Fi network, a renamed Mac), so they are read again every few seconds.
import { networkInterfaces } from "node:os";

/** A VPN's interface (utun: Tailscale and most VPNs; ipsec, ppp): a phone on the Wi-Fi can't reach it. */
const vpn = (name: string) => /^(utun|ipsec|ppp)\d*$/.test(name);

/** IPv4 addresses on this Mac's network interfaces, apart from loopback and link-local (169.254/16).
 *  VPN interfaces come last, so the pairing QR code never prefers a Tailscale 100.x address over a Wi-Fi
 *  one in the same range (a hotspot or campus network is 100.64/10 too, PHONE-4). */
export function lanAddresses(ifaces = networkInterfaces()): string[] {
  const out = new Set<string>();
  const names = Object.keys(ifaces).sort((a, b) => Number(vpn(a)) - Number(vpn(b)));
  for (const name of names) {
    for (const i of ifaces[name] ?? []) {
      if (i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254.")) out.add(i.address);
    }
  }
  return [...out];
}

/** "Jonos-Mac.local", from macOS's LocalHostName (VIEWSWITCHER_LOCAL_NAME overrides it, for tests). */
function readLocalName(): string | null {
  const forced = process.env.VIEWSWITCHER_LOCAL_NAME;
  if (forced !== undefined) return forced ? `${forced.replace(/\.local$/i, "")}.local`.toLowerCase() : null;
  if (process.platform !== "darwin") return null;
  try {
    const p = Bun.spawnSync(["/usr/sbin/scutil", "--get", "LocalHostName"], { stdout: "pipe", stderr: "ignore" });
    const name = p.stdout.toString().trim();
    return /^[A-Za-z0-9-]{1,63}$/.test(name) ? `${name}.local`.toLowerCase() : null;
  } catch {
    return null;
  }
}

let cache: { at: number; addresses: string[]; localName: string | null } | null = null;

/** This Mac's LAN addresses and .local name, read at most every 5 seconds. */
export function thisMac(): { addresses: string[]; localName: string | null } {
  const now = Date.now();
  if (!cache || now - cache.at > 5000) cache = { at: now, addresses: lanAddresses(), localName: readLocalName() };
  return cache;
}
