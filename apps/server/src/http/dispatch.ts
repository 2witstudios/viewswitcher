// The one way into the server: every request, on 127.0.0.1 and on the Wi-Fi listener, goes through
// dispatch(), which applies the same checks in the same order to every route (http/routes.ts):
//
// 1. the host guard: the Host must be a name this server is known by (DNS rebinding, origin.ts);
// 2. the audience: who is asking (gate.ts), from the listener it came in on, the USB-C bridge's
//    marked connections and the device token, against who the route is for. Anything from
//    elsewhere than this Mac and the USB-C bridge is served only while remote access is on. A route
//    that names no audience is this Mac's only, and a path no route has is a 404 like one of those;
// 3. for anything but GET, and for a WebSocket upgrade, an Origin of exactly this server's own
//    (or a configured one), so no other page, on another site or another port, can act;
// 4. for a request with a body (POST), a JSON one (multipart for the upload routes), so no page can send one
//    to another origin without a CORS preflight, which this server never grants;
// 5. the route's handler,
//
// all inside one response wrapper: every response outside /library/ says it may only be framed by
// the switcher's own pages and is never sniffed, and errors are scrubbed of absolute paths, a 500's
// message going only to this Mac.
//
// /library/ keeps its own headers (scene-sandbox.ts), with no frame-ancestors: a scene has nothing
// to click, framing one gives a page nothing it can read, and a sandboxed document's 'self' is an
// opaque origin in some engines, which would blank every scene tile in the switcher.
import { COMPUTER } from "../platform-dirs";
import { EditError } from "@viewswitcher/shared";
import type { Server } from "bun";
import { admits, type Audience, type Caller, callerOf, isMacOrUsb, pageLoad, type Peer } from "../gate";
import { hostTrusted, type Lan, originAllowed, pageProto } from "../origin";
import { PackError } from "../packs";
import { PathError } from "../paths";
import { SettingsError } from "../settings";
import type { Log } from "../log";

/** A refusal with its status, from a handler or the checks. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** A live socket's data: the paired phone or tablet it belongs to, and whether it came over the Wi-Fi. */
export type SocketData = { remote: string | null; lan: boolean };

/** What a handler gets. */
export type Ctx = {
  req: Request;
  url: URL;
  /** The decoded path. */
  path: string;
  srv: Server<SocketData>;
  peer: Peer;
  caller: Caller;
  /** It came in on the Wi-Fi listener. */
  lan: boolean;
  /** The request's JSON body: an object, {} when empty; anything else is a 400. */
  json(): Promise<Record<string, any>>;
};

export type Route = {
  /** GET routes answer HEAD too. ANY: the handler decides (/mcp). */
  method: "GET" | "POST" | "ANY";
  path: string | ((path: string) => boolean);
  /** Who it's for. None: this Mac only. */
  audience?: Audience;
  /** What a request other than GET must send: JSON unless it says multipart (uploads). */
  body?: "json" | "multipart";
  /** undefined: the connection was upgraded to a WebSocket. */
  handler: (c: Ctx) => Promise<Response | undefined> | Response | undefined;
};

export type DispatchOptions = {
  routes: Route[];
  /** VIEWSWITCHER_ORIGINS. */
  allowedOrigins: string[];
  /** This Mac's .local name and LAN addresses while the Wi-Fi listener is on, else null (origin.ts). */
  lan: () => Lan;
  /** The Wi-Fi setting: whether anything but this Mac and the USB-C bridge is served at all. */
  remoteAccess: () => boolean;
  /** Whether a request came in on the Wi-Fi listener. */
  onLan: (srv: Server<SocketData>) => boolean;
  /** The paired phone or tablet a request's token belongs to, or null. */
  remote: (req: Request) => string | null;
  /** After a paired phone's or tablet's request: a Set-Cookie that renews its pairing, or null. */
  renew: (remote: string, c: Ctx) => string | null;
  /** The pairing page, for a stranger's page load. */
  pairPage: (req: Request) => Response;
  /** Takes absolute paths out of error messages (scrub.ts). */
  scrub: (message: string) => string;
  log?: Log;
  /** The USB-C bridge's connections (gate.ts bridgePorts); tests pass their own. */
  bridged?: ReadonlySet<number>;
};

export const FRAME_ANCESTORS = "frame-ancestors 'self'";

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

/** A path no route has, or a method its route doesn't take: this Mac's, like any undeclared route, and not found. */
const NOT_FOUND: Route = { method: "ANY", path: () => true, handler: () => json({ error: "Not found" }, 404) };

const matches = (r: Route, method: string, path: string) =>
  (r.method === "ANY" || r.method === method || (r.method === "GET" && method === "HEAD")) && (typeof r.path === "string" ? r.path === path : r.path(path));

/** The media type of a request's body, without its parameters. */
const mediaType = (req: Request) => (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();

/** Headers on a response, also one whose headers can't be changed (it gets copied). */
function withHeaders(res: Response, set: (h: Headers) => void): Response {
  try {
    set(res.headers);
    return res;
  } catch {
    const copy = new Response(res.body, res);
    set(copy.headers);
    return copy;
  }
}

/** frame-ancestors and nosniff, outside /library/ (see above). A page with its own CSP keeps it, and its own frame-ancestors. */
function secured(res: Response, path: string): Response {
  if (path.startsWith("/library/")) return res;
  return withHeaders(res, (h) => {
    h.set("x-content-type-options", "nosniff");
    const csp = h.get("content-security-policy");
    if (!csp) h.set("content-security-policy", FRAME_ANCESTORS);
    else if (!/(^|;)\s*frame-ancestors\b/i.test(csp)) h.set("content-security-policy", `${csp}; ${FRAME_ANCESTORS}`);
  });
}

const REMOTE_OFF = `This ${COMPUTER} isn't letting phones and tablets connect right now. On the ${COMPUTER}, turn on Phones and Tablets in ViewSwitcher.`;
const PAIR_FIRST = `Pair this phone or tablet first: open ViewSwitcher on the ${COMPUTER}, then Phones and Tablets.`;
const PLAIN_500 = `Something went wrong on the ${COMPUTER}. Its server log has the details.`;

export function dispatcher(o: DispatchOptions): (req: Request, srv: Server<SocketData>) => Promise<Response | undefined> {
  /** An error as a response: the message scrubbed, and a 500's only for this Mac. */
  function failure(e: unknown, caller: Caller): Response {
    const message = o.scrub(String((e as Error)?.message ?? e));
    if (e instanceof HttpError) return json({ error: message }, e.status);
    if (e instanceof PathError || e instanceof EditError || e instanceof PackError || e instanceof SettingsError) return json({ error: message }, 400);
    console.error(e);
    return json({ error: caller.kind === "mac" ? message : PLAIN_500 }, 500);
  }

  return async (req, srv) => {
    const url = new URL(req.url);
    let path = url.pathname;
    let caller: Caller = { kind: "stranger" };

    const run = async (): Promise<Response | undefined> => {
      const host = req.headers.get("host");
      if (!hostTrusted(host, o.allowedOrigins, o.lan())) {
        o.log?.(`[http] refused ${path} for Host ${host}`);
        return json({ error: "Unknown host. If you reach ViewSwitcher by another name, add it to VIEWSWITCHER_ORIGINS." }, 421);
      }
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        throw new HttpError(400, "Bad path");
      }

      const peer = srv.requestIP(req);
      const lan = o.onLan(srv);
      // Remote access off: nothing from elsewhere, not even the pairing page, whatever token it has.
      if ((lan || !isMacOrUsb(peer, req.headers)) && !o.remoteAccess()) return json({ error: REMOTE_OFF }, 403);
      caller = callerOf({ onLan: lan, peer, headers: req.headers, bridged: o.bridged, remote: () => o.remote(req) });

      const route = o.routes.find((r) => matches(r, req.method, path)) ?? NOT_FOUND;
      if (!admits(route.audience ?? "mac", caller)) {
        if (caller.kind !== "stranger") return json({ error: "Not found" }, 404);
        return pageLoad(req.method, path) ? o.pairPage(req) : json({ error: PAIR_FIRST }, 401);
      }

      const writes = req.method !== "GET" && req.method !== "HEAD";
      const origin = req.headers.get("origin");
      if ((writes || req.headers.get("upgrade")?.toLowerCase() === "websocket") && !originAllowed(origin, { host, proto: pageProto(url, req.headers), extra: o.allowedOrigins, lan: o.lan() })) {
        o.log?.(`[http] refused ${req.method} ${path} from ${origin}`);
        return json({ error: "Not allowed from this page" }, 403);
      }
      if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
        const want = route.body === "multipart" ? "multipart/form-data" : "application/json";
        if (mediaType(req) !== want) return json({ error: `Expected ${want}` }, 415);
      }

      let body: Promise<Record<string, any>> | undefined;
      const c: Ctx = {
        req, url, path, srv, peer, caller, lan,
        json: () =>
          (body ??= req.text().then((text) => {
            if (!text.trim()) return {};
            let v: unknown;
            try {
              v = JSON.parse(text);
            } catch {
              throw new HttpError(400, "Expected a JSON body");
            }
            if (!v || typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, "Expected a JSON object");
            return v as Record<string, any>;
          })),
      };
      const res = await route.handler(c);
      // A device in use gets its cookie again once a day, so it stays paired 400 days from its last use.
      const cookie = res && caller.kind === "remote" ? o.renew(caller.remote, c) : null;
      return res && cookie ? withHeaders(res, (h) => h.append("set-cookie", cookie)) : res;
    };

    let res: Response | undefined;
    try {
      res = await run();
    } catch (e) {
      res = failure(e, caller);
    }
    return res && secured(res, path);
  };
}
