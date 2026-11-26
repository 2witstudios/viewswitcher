// What the route files share: JSON answers, files from disk, and the three kinds of route the
// switcher has (a paired JSON GET or POST, and the Mac app's pairing admin).
import { stat } from "node:fs/promises";
import { Audience } from "../../gate";
import { pageProto } from "../../origin";
import type { Ctx, Route } from "../dispatch";
import type { RouteDeps } from "../routes";

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
export const notFound = () => json({ error: "Not found" }, 404);

export async function fileResponse(abs: string, cache = "no-store", extra: Record<string, string> = {}) {
  const s = await stat(abs).catch(() => null);
  if (!s?.isFile()) return null;
  return new Response(Bun.file(abs), { headers: { "cache-control": cache, ...extra } });
}

/** A secure cookie when the page itself came over https (tailscale serve). */
export const secure = (c: Ctx) => pageProto(c.url, c.req.headers) === "https";

/** A JSON POST for the switcher (paired). */
export const post = (path: string, handler: (b: Record<string, any>, c: Ctx) => Promise<unknown> | unknown): Route => ({
  method: "POST",
  path,
  audience: Audience.Paired,
  handler: async (c) => {
    const r = await handler(await c.json(), c);
    return r instanceof Response ? r : json(r);
  },
});

/** A JSON GET for the switcher (paired). */
export const get = (path: string, handler: (c: Ctx) => Promise<unknown> | unknown): Route => ({
  method: "GET",
  path,
  audience: Audience.Paired,
  handler: async (c) => {
    const r = await handler(c);
    return r instanceof Response ? r : json(r);
  },
});

/** The Mac app's pairing admin: this Mac only (no audience), and only with the app's secret. */
export const admin = (d: RouteDeps, method: "GET" | "POST", path: string, handler: (b: Record<string, any>) => Promise<Response> | Response): Route => ({
  method,
  path,
  handler: async (c) => (d.isAdmin(c.req) ? handler(method === "POST" ? await c.json() : {}) : notFound()),
});
