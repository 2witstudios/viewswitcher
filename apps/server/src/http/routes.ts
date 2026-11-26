// Every route the server has, each with the audience it is for (gate.ts) and the body it takes.
// http/dispatch.ts applies the checks; a route that names no audience is for this Mac only, so a
// new route is closed until someone decides who else may use it.
//
// - mac (no audience named): what only this Mac may see or use: absolute paths (/api/info, the
//   Claude Desktop extension), the Mac app's pairing admin, the agents' /mcp.
// - paired: the switcher itself, for this Mac, the USB-C device and paired phones and tablets.
// - public: the pairing page and its POST.
import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { existsSync } from "node:fs";
import type { ServerMessage, Slot } from "@viewswitcher/shared";
import { claudeCodeCommand, commandLine, detectClients, mcpbFile, mcpbManifest, type stdioLaunch } from "../agent-connect";
import { asDropped, type BuiltinPack } from "../builtin-packs";
import { Audience, rateKey } from "../gate";
import * as lib from "../library";
import { customizeScene, duplicateScene, orgDir, sceneFromTemplate } from "../library-actions";
import { resolveInLibrary } from "../library/contain";
import type { Placer } from "../live/placement";
import type { LiveStore } from "../live/store";
import { handleMcp } from "../mcp/http";
import type { McpDeps } from "../mcp/server";
import type { OBSClient } from "../obs";
import { appParent } from "../parent-watch";
import { checkObsSetup, setupObs } from "../obs-setup";
import { cancelPack, installPack, removeSet, stagePack } from "../packs";
import { pageProto } from "../origin";
import { PAIR_PAGE_CSP, pairPage } from "../pair-page";
import { deviceName, guessName, type Pairing, tokenCookie } from "../pairing";
import { inside, PathError, plainName } from "../paths";
import { withBridge } from "../scene-bridge";
import { editScene, parseEdit, readForEdit, renameScene, scenePath } from "../scene-edit";
import { defuseMeta, libraryHeaders } from "../scene-sandbox";
import { writeSettings } from "../settings";
import type { Ctx, Route } from "./dispatch";

export type RouteDeps = {
  /** The library folder. */
  root: string;
  /** The starter kit new orgs are made from. */
  starter: string;
  /** The built switcher. */
  webDist: string;
  /** OBS's scene and source names, and the port its program source loads. */
  obsNames: Parameters<typeof setupObs>[1];
  obsPort: number;
  store: LiveStore;
  obs: OBSClient;
  placer: Placer;
  /** Whether a program page's slot report is the newest from that page (slot-order.ts). */
  acceptSlots: (page: unknown, seq: unknown) => boolean;
  publish: (msg: ServerMessage) => void;
  builtins: () => Promise<BuiltinPack[]>;
  starterScript: string | null;
  pairing: Pairing;
  /** Phones and tablets: what the Mac app's window shows, and the Wi-Fi setting (null, or why it couldn't listen). */
  remote: { status: () => object & { urls: string[]; localName: string | null }; setLan: (on: boolean) => string | null };
  /** Whether a request carries the Mac app's secret (the pairing admin). */
  isAdmin: (req: Request) => boolean;
  /** The port this server listens on. */
  port: () => number;
  /** What an agent runs to connect over stdio. */
  ownStdio: (port: number) => ReturnType<typeof stdioLaunch>;
  extensionVersion: string;
  mcp: { deps: McpDeps; allowedOrigins: string[]; onSeen: (client: string | null) => void };
  log?: (line: string) => void;
};

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const notFound = () => json({ error: "Not found" }, 404);

async function fileResponse(abs: string, cache = "no-store", extra: Record<string, string> = {}) {
  const s = await stat(abs).catch(() => null);
  if (!s?.isFile()) return null;
  return new Response(Bun.file(abs), { headers: { "cache-control": cache, ...extra } });
}

/** A secure cookie when the page itself came over https (tailscale serve). */
export const secure = (c: Ctx) => pageProto(c.url, c.req.headers) === "https";

export function routes(d: RouteDeps): Route[] {
  const { root, store } = d;
  /** One org's folder; every mutation below works inside it. */
  const org = (id: unknown) => orgDir(root, id);

  /** A JSON POST for the switcher. */
  const post = (path: string, handler: (b: Record<string, any>, c: Ctx) => Promise<unknown> | unknown): Route => ({
    method: "POST",
    path,
    audience: Audience.Paired,
    handler: async (c) => {
      const r = await handler(await c.json(), c);
      return r instanceof Response ? r : json(r);
    },
  });
  const get = (path: string, handler: (c: Ctx) => Promise<unknown> | unknown): Route => ({
    method: "GET",
    path,
    audience: Audience.Paired,
    handler: async (c) => {
      const r = await handler(c);
      return r instanceof Response ? r : json(r);
    },
  });
  /** The Mac app's pairing admin: this Mac only (no audience), and only with the app's secret. */
  const admin = (method: "GET" | "POST", path: string, handler: (b: Record<string, any>) => Promise<Response> | Response): Route => ({
    method,
    path,
    handler: async (c) => (d.isAdmin(c.req) ? handler(method === "POST" ? await c.json() : {}) : notFound()),
  });

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
      // live previews simply don't apply to it. ?bridge: with the bridge the program page talks to it through.
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
    // ---------------------------------------------------------------- pairing (public)
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
        const r = d.pairing.pair(b.code, deviceName(b.name, c.req.headers.get("user-agent") ?? ""), rateKey(c.peer?.address, c.req.headers));
        if (!r.ok) {
          console.log(`[pairing] refused a code from ${c.peer?.address} (${r.reason})`);
          return json({ error: r.error }, r.reason === "limited" ? 429 : 403);
        }
        console.log(`[pairing] paired "${r.device.name}"`);
        return Response.json({ ok: true, name: r.device.name }, { headers: { "cache-control": "no-store", "set-cookie": tokenCookie(r.token, secure(c)) } });
      },
    },

    // ---------------------------------------------------------------- this Mac only (no audience)
    {
      // For the Mac app's menu (Open Library Folder) and Edit with AI's commands: with the Claude Desktop
      // extension below, the only responses with absolute paths in them.
      method: "GET",
      path: "/api/info",
      // sidecar, parentPid and pid let a relaunched app find and replace an orphan it started before.
      handler: () =>
        json({ library: root, port: d.port(), sidecar: appParent() !== null, parentPid: appParent(), pid: process.pid, claudeCode: claudeCodeCommand(root, homedir()), stdio: commandLine(d.ownStdio(d.port())) }),
    },
    {
      // Which agent apps this Mac has, so Edit with AI lists them first. Booleans only.
      method: "GET",
      path: "/api/agent/clients",
      handler: () => json(detectClients({ home: homedir(), path: process.env.PATH ?? "", exists: existsSync })),
    },
    {
      // Add to Claude Desktop: an extension made for this install, whose command is this server's own executable.
      method: "GET",
      path: "/api/agent/viewswitcher.mcpb",
      handler: () => {
        const file = mcpbFile(mcpbManifest({ launch: d.ownStdio(d.port()), version: d.extensionVersion }));
        return new Response(file, { headers: { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="ViewSwitcher.mcpb"', "cache-control": "no-store" } });
      },
    },
    admin("GET", "/api/remote", () => json(d.remote.status())),
    admin("POST", "/api/remote", (b) => {
      const error = d.remote.setLan(b.enabled === true);
      return error ? json({ error, ...d.remote.status() }, 500) : json(d.remote.status());
    }),
    admin("POST", "/api/remote/code", () => {
      const { code, expiresAt } = d.pairing.newCode();
      const s = d.remote.status();
      const [host] = s.urls.filter((u) => !u.includes(".local:")).concat(s.urls);
      // The link opens on an address any phone can reach; `mac` also names this Mac's .local name, so the
      // iPhone and iPad app can pair on the name, which survives the router handing the Mac a new address.
      const mac = s.localName && host && !host.includes(".local:") ? `&mac=${encodeURIComponent(s.localName)}` : "";
      return json({ ...s, code: { code, expiresAt }, pairUrl: host ? `${host}pair?code=${code}${mac}` : null });
    }),
    admin("POST", "/api/remote/remove", async (b) => {
      try {
        await d.pairing.remove(String(b.id ?? ""));
      } catch (e) {
        return json({ error: (e as Error).message, ...d.remote.status() }, 500);
      }
      return json(d.remote.status());
    }),
    {
      // The agents' MCP server. Its handler checks once more that this is this Mac (mcp/http.ts).
      method: "ANY",
      path: "/mcp",
      handler: (c) => {
        // No idle timeout for agents' calls: Bun drops a connection that's quiet for 10 s, and a tool
        // call can be quiet longer than that (previews run one at a time, ~1.5 s each, so a few in
        // parallel queue up), which the agent would see as a transport error, not an answer.
        c.srv.timeout(c.req, 0);
        return handleMcp(c.req, c.peer, d.mcp);
      },
    },

    // ---------------------------------------------------------------- the switcher (paired)
    {
      // The live state. A WebSocket isn't covered by CORS, so the dispatcher checks its Origin like a POST's.
      method: "GET",
      path: "/ws",
      audience: Audience.Paired,
      handler: (c) =>
        c.srv.upgrade(c.req, { data: { device: c.caller.kind === "device" ? c.caller.device : null, lan: c.lan } }) ? undefined : new Response("Upgrade failed", { status: 400 }),
    },
    post("/api/log", (b) => {
      console.log("[client]", JSON.stringify(b));
      return { ok: true };
    }),
    get("/api/orgs", () => lib.listOrgs(root)),
    post("/api/orgs", (b) => lib.createOrg(root, d.starter, b.name, b.accent, b.ground)),
    get("/api/library", (c) => lib.scanLibrary(root, plainName(c.url.searchParams.get("org") ?? ""))),
    get("/api/state", () => store.state),
    post("/api/onair", (b) => store.goOnAir({ path: b.path, label: b.label, projectId: b.projectId, streamId: b.streamId })),
    // What agents connected over MCP may put on air (agent-guard.ts); people in the switcher are never limited.
    post("/api/agent/settings", async (b) => {
      const s = await writeSettings(root, { agentOnAir: b.onAir });
      store.update({ agent: { ...store.state.agent, onAir: s.agentOnAir } });
      return store.state.agent;
    }),
    post("/api/program/slots", async (b) => {
      // Devices follow what the program page is *showing*, never what was just requested: the page
      // always converges on the latest on-air scene, so its last report matches the final picture.
      // (Ignoring "stale" reports by scene caused drift.) Reports are numbered per page; one that
      // arrives after a newer one from the same page (a live drag's 33 ms reports can swap) is ignored.
      if (!d.acceptSlots(b.page, b.seq)) return { ok: true, stale: true, warnings: store.state.warnings };
      d.log?.(`[slots] ${String(b.path).split("/").slice(-2).join("/")}`);
      const slots: Slot[] = (Array.isArray(b.slots) ? b.slots : []).map((s: Slot) => ({
        source: String(s.source), x: Number(s.x), y: Number(s.y), w: Number(s.w), h: Number(s.h),
      }));
      await d.placer.report(String(b.path), slots);
      return { ok: true, warnings: store.state.warnings };
    }),
    post("/api/projects", (b) => lib.createProject(org(b.org), b.name, b.templates ?? [])),
    post("/api/streams", (b) => lib.createStream(org(b.org), b.projectId, b.name, b.date)),
    // Where the copy is, so the switcher can open it in the editor.
    post("/api/scenes/from-template", (b) => sceneFromTemplate(root, { org: b.org, template: b.template, projectId: b.projectId, streamId: b.streamId })),
    post("/api/scenes/customize", (b) => customizeScene(root, { org: b.org, projectId: b.projectId, streamId: b.streamId, name: b.name })),
    post("/api/transition/customize", async (b) => {
      await lib.customizeTransition(org(b.org), b.projectId);
      return { ok: true };
    }),
    post("/api/transition/revert", async (b) => {
      await lib.revertTransition(org(b.org), b.projectId);
      return { ok: true };
    }),
    post("/api/scenes/revert", async (b) => {
      await lib.revert(org(b.org), b.projectId, b.streamId, b.name);
      return { ok: true };
    }),
    post("/api/scenes/duplicate", (b) => duplicateScene(root, b.path)),
    {
      method: "POST",
      path: "/api/assets",
      audience: Audience.Paired,
      body: "multipart",
      handler: async (c) => {
        const form = await c.req.formData();
        const orgId = plainName(String(form.get("org") ?? ""));
        const saved = [];
        for (const f of form.getAll("file")) {
          if (f instanceof File && f.size > 0) saved.push({ path: `${orgId}/${(await lib.saveAsset(org(orgId), f)).path}` });
        }
        return json({ saved });
      },
    },
    // Template packs: check a dropped .zip or folder and show it, install it as a template set, or remove a set. See packs.ts.
    {
      method: "POST",
      path: "/api/packs/stage",
      audience: Audience.Paired,
      body: "multipart",
      handler: async (c) => {
        const form = await c.req.formData();
        const orgId = plainName(String(form.get("org") ?? ""));
        const zip = form.get("zip");
        if (zip instanceof File) return json(await stagePack(root, orgId, { zip: new Uint8Array(await zip.arrayBuffer()) }, d.starterScript));
        const paths = form.getAll("path").map(String);
        const files = form.getAll("file");
        if (!files.length || files.length !== paths.length || files.some((f) => !(f instanceof File))) return json({ error: "Drop a template pack: a .zip, or its folder" }, 400);
        return json(await stagePack(root, orgId, { files: files.map((f, i) => ({ path: paths[i]!, data: f as File })) }, d.starterScript));
      },
    },
    // The built-in template packs: listed, then staged like a dropped one.
    get("/api/packs/builtin", async () => (await d.builtins()).map(({ id, name, description, views }) => ({ id, name, description, views }))),
    post("/api/packs/builtin/stage", async (b) => {
      const pack = (await d.builtins()).find((p) => p.id === b.id);
      if (!pack) return json({ error: "There's no built-in template pack by that name" }, 404);
      return stagePack(root, plainName(String(b.org ?? "")), { files: asDropped(pack) }, d.starterScript);
    }),
    post("/api/packs/install", (b) => installPack(root, plainName(String(b.org ?? "")), b.token)),
    post("/api/packs/cancel", async (b) => {
      await cancelPack(root, plainName(String(b.org ?? "")), b.token);
      return { ok: true };
    }),
    post("/api/sets/remove", (b) => removeSet(root, plainName(String(b.org ?? "")), String(b.set ?? ""))),
    post("/api/open", async (b) => {
      // Opens the file in an editor on this Mac: a link to somewhere outside the library opens nothing.
      const abs = await resolveInLibrary(root, b.path);
      const app = process.env.VIEWSWITCHER_EDITOR;
      Bun.spawn(app ? ["open", "-a", app, abs] : ["open", "-t", abs], { stdout: "ignore", stderr: "ignore" });
      return { ok: true };
    }),
    // Scene editor: patch the file (409 when it changed since the editor loaded it), or show a change
    // live on the program page without writing anything.
    post("/api/scene/edit", async (b) => {
      const r = await editScene(root, b.path, String(b.hash ?? ""), b.edits);
      if (!r.ok) return json({ error: "This scene changed since you opened it", hash: r.hash }, 409);
      d.log?.(`[edit] ${String(b.path).split("/").slice(-2).join("/")} ${r.changed ? "saved" : "unchanged"}`);
      return r;
    }),
    // Rename a scene: its title, and a stream scene's file. The scene stays on air if it is.
    post("/api/scene/rename", async (b) => {
      const r = await renameScene(root, b.path, String(b.hash ?? ""), b.name);
      if (!r.ok) return json({ error: "This scene changed since you opened it", hash: r.hash }, 409);
      await store.renamed(b.path, b.name, r);
      return r;
    }),
    post("/api/scene/preview", (b) => {
      scenePath(root, b.path);
      // The hash names the file version the edit's ids belong to; pages showing another version ignore it.
      d.publish({ t: "scene:preview", path: b.path, hash: String(b.hash ?? ""), edit: parseEdit(b.edit), session: String(b.session ?? "").slice(0, 40), seq: Number(b.seq) || 0 });
      return { ok: true };
    }),
    post("/api/obs/setup", async () => {
      if (!d.obs.status.connected) return json({ error: "OBS isn't connected. Open OBS and turn on Tools → WebSocket Server Settings → Enable WebSocket server." }, 503);
      // While streaming or recording, setup never switches OBS's program scene (it would cut the stream).
      const report = await setupObs(d.obs, d.obsNames, d.obsPort, { switchProgram: !d.obs.status.streaming && !d.obs.status.recording });
      store.update({ obsSetup: await checkObsSetup(d.obs, d.obsNames, d.obsPort) });
      return report;
    }),
    post("/api/obs/record", () => d.obs.request("ToggleRecord")),
    post("/api/obs/stream", () => d.obs.request("ToggleStream")),

    // ---------------------------------------------------------------- files (paired)
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

/** The pairing page as a response, for the dispatcher's strangers. */
export function pairPageResponse(req: Request): Response {
  return new Response(req.method === "HEAD" ? null : pairPage({ name: guessName(req.headers.get("user-agent") ?? "") }), {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": PAIR_PAGE_CSP, "x-frame-options": "DENY", "referrer-policy": "no-referrer" },
  });
}
