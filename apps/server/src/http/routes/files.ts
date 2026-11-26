// Files (paired): the library's, served sandboxed, and the switcher's own pages, last of all routes.
import { readFile, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { Audience } from "../../gate";
import { resolveInLibrary } from "../../library/contain";
import { inside, PathError } from "../../paths";
import { withBridge } from "../../scene-bridge";
import { readForEdit } from "../../scene-edit";
import { defuseMeta, libraryHeaders } from "../../scene-sandbox";
import type { Ctx, Route } from "../dispatch";
import type { RouteDeps } from "../routes";
import { fileResponse } from "./kit";

export function fileRoutes(d: RouteDeps): Route[] {
  const { root } = d;

  /** A file in the library, served sandboxed (scene-sandbox.ts): a scene's scripts never run as the switcher. */
  async function library(c: Ctx): Promise<Response> {
    const rel = c.path.slice("/library/".length);
    let file: string;
    try {
      // Through links too, never outside the library or into a dot-folder (library/contain.ts).
      file = await resolveInLibrary(root, rel);
    } catch (e) {
      if (e instanceof PathError) return new Response("Not found", { status: 404, headers: libraryHeaders(rel) });
      throw e;
    }
    // Headers for where the file really is: a link in templates/ to the org's own media isn't a template's.
    const served = relative(await realpath(root), file).split(sep).join("/");
    const headers = libraryHeaders(served);
    const q = c.url.searchParams;
    const inert = q.has("inert");
    if (rel.endsWith(".html") && (q.has("edit") || q.has("bridge"))) {
      // ?edit: the scene with data-vs element ids, for the editor and the program page; the file is only read.
      // If it can't be tagged for any reason, serve the plain file: the program shows the scene and
      // live edits simply don't apply to it. ?bridge: with the bridge the program page talks to it through.
      const scene = q.has("edit")
        ? await readForEdit(root, rel).catch((e) => {
            d.log?.(`[edit] serving ${rel} untagged: ${(e as Error).message}`);
            return null;
          })
        : null;
      const html = scene?.html ?? (await readFile(file, "utf8").catch(() => null));
      if (html !== null) {
        // INERT_CSP (same-origin) only on a body that went through defuseMeta; anything else is sandboxed as usual.
        return new Response(inert ? defuseMeta(html) : q.has("bridge") ? withBridge(html) : html, {
          headers: {
            ...(inert ? libraryHeaders(served, true) : headers), "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
            ...(scene ? { "x-scene-hash": scene.hash, "access-control-expose-headers": "x-scene-hash" } : {}),
          },
        });
      }
    }
    return (await fileResponse(file, "no-store", headers)) ?? new Response("Not found", { status: 404, headers });
  }

  /** The built switcher: real files, else index.html for client-side routes. */
  async function spa(c: Ctx): Promise<Response> {
    const immutable = c.path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-store";
    const asset = c.path !== "/" && (await fileResponse(inside(d.webDist, c.path), immutable));
    if (asset) return asset;
    const index = await fileResponse(join(d.webDist, "index.html"));
    return index ?? new Response("The switcher isn't built yet. Run `bun run build`, or use the dev server (`bun run dev`, then http://localhost:5173).", { status: 503 });
  }

  return [
    { method: "GET", path: (p) => p.startsWith("/library/"), audience: Audience.Paired, handler: library },
    {
      // The switcher's own pages and their files, last: any other path that isn't the API, the socket or the agents'.
      method: "GET",
      path: (p) => !p.startsWith("/api/") && p !== "/api" && p !== "/ws" && p !== "/mcp",
      audience: Audience.Paired,
      handler: spa,
    },
  ];
}
