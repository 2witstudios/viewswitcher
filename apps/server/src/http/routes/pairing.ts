// Pairing phones and tablets: the public pairing page and its POST, and the Mac app's pairing admin
// (/api/remote…, this Mac only, with the app's secret).
import { Audience, rateKey } from "../../gate";
import { PAIR_PAGE_CSP, pairPage } from "../../pair-page";
import { guessName, remoteName, tokenCookie } from "../../pairing";
import type { Route } from "../dispatch";
import type { RouteDeps } from "../routes";
import { admin, json, secure } from "./kit";

export function pairingRoutes(d: RouteDeps): Route[] {
  return [
    {
      // The QR code's link: the pairing page, or for a device that's paired already (or this Mac), the switcher.
      method: "GET",
      path: "/pair",
      audience: Audience.Public,
      handler: (c) => (c.caller.kind === "stranger" ? pairPageResponse(c.req) : new Response(null, { status: 303, headers: { location: "/" } })),
    },
    {
      method: "POST",
      path: "/api/pair",
      audience: Audience.Public,
      handler: async (c) => {
        // Small, and its size known before it's read.
        const size = Number(c.req.headers.get("content-length"));
        if (!(size > 0 && size <= 2048)) return json({ error: "Too large" }, 413);
        const b = await c.json();
        const r = d.pairing.pair(b.code, remoteName(b.name, c.req.headers.get("user-agent") ?? ""), rateKey(c.peer?.address, c.req.headers));
        if (!r.ok) {
          console.log(`[pairing] refused a code from ${c.peer?.address} (${r.reason})`);
          return json({ error: r.error }, r.reason === "limited" ? 429 : 403);
        }
        console.log(`[pairing] paired "${r.remote.name}"`);
        return Response.json({ ok: true, name: r.remote.name }, { headers: { "cache-control": "no-store", "set-cookie": tokenCookie(r.token, secure(c)) } });
      },
    },
    admin(d, "GET", "/api/remote", () => json(d.remote.status())),
    admin(d, "POST", "/api/remote", (b) => {
      const error = d.remote.setLan(b.enabled === true);
      return error ? json({ error, ...d.remote.status() }, 500) : json(d.remote.status());
    }),
    admin(d, "POST", "/api/remote/code", () => {
      const { code, expiresAt } = d.pairing.newCode();
      const s = d.remote.status();
      const [host] = s.urls.filter((u) => !u.includes(".local:")).concat(s.urls);
      // The link opens on an address any phone can reach; `mac` also names this Mac's .local name, so the
      // iPhone and iPad app can pair on the name, which survives the router handing the Mac a new address.
      const mac = s.localName && host && !host.includes(".local:") ? `&mac=${encodeURIComponent(s.localName)}` : "";
      return json({ ...s, code: { code, expiresAt }, pairUrl: host ? `${host}pair?code=${code}${mac}` : null });
    }),
    admin(d, "POST", "/api/remote/remove", async (b) => {
      try {
        await d.pairing.remove(String(b.id ?? ""));
      } catch (e) {
        return json({ error: (e as Error).message, ...d.remote.status() }, 500);
      }
      return json(d.remote.status());
    }),
  ];
}

/** The pairing page as a response, for the dispatcher's strangers. */
export function pairPageResponse(req: Request): Response {
  return new Response(req.method === "HEAD" ? null : pairPage({ name: guessName(req.headers.get("user-agent") ?? "") }), {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": PAIR_PAGE_CSP, "x-frame-options": "DENY", "referrer-policy": "no-referrer" },
  });
}
