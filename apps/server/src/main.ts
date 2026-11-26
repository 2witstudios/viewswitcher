// ViewSwitcher server: the switcher API, the library files, live state, OBS, and the MCP server for agents.
import { existsSync, watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { EditError } from "@viewswitcher/shared";
import type { ServerMessage, Slot } from "@viewswitcher/shared";
import type { Server, ServerWebSocket } from "bun";
import { claudeCodeCommand, commandLine, detectClients, mcpbFile, mcpbManifest, stdioLaunch } from "./agent-connect";
import { config } from "./config";
import * as lib from "./library";
import { customizeScene, duplicateScene, orgDir, sceneFromTemplate } from "./library-actions";
import { ensureLibrary } from "./library-kit";
import { createPlacer } from "./live/placement";
import { LiveStore } from "./live/store";
import { handleMcp, noteSeen } from "./mcp/http";
import { createPreviewer } from "./preview";
import type { McpDeps } from "./mcp/server";
import { OBSClient } from "./obs";
import { checkObsSetup, setupObs } from "./obs-setup";
import { fromThisMac, fromThisMacOnly, gate, loopbackAddress, rateKey } from "./gate";
import { pairingOrder, thisMac } from "./lan";
import { hostTrusted, originAllowed } from "./origin";
import { PAIR_PAGE_CSP, pairPage } from "./pair-page";
import { deviceName, guessName, Pairing, sha3, tokenCookie, tokenFromCookie } from "./pairing";
import { inside, PathError, plainName } from "./paths";
import { createSlotOrder } from "./slot-order";
import { cancelPack, installPack, PackError, removeSet, stagePack, sweepStaging } from "./packs";
import { withBridge } from "./scene-bridge";
import { editScene, parseEdit, readForEdit, renameScene, scenePath } from "./scene-edit";
import { defuseMeta, libraryHeaders } from "./scene-sandbox";
import { readSettings, SettingsError, writeSettings } from "./settings";
import { asDropped, type BuiltinPack, buildBuiltins, readBuiltins } from "./builtin-packs";
import { startUsbBridge, usbAvailable } from "./usb-bridge";
import { appParent, watchParent } from "./parent-watch";

// A new library gets the agent skill, CLAUDE.md, a git repo and a first org; an existing one is left as it is.
const firstRun = await ensureLibrary(config.library, { kit: config.libraryKit, starter: config.starter });
if (firstRun.copied.length || firstRun.updated.length || firstRun.org) {
  const did = [
    firstRun.copied.length && `added ${firstRun.copied.join(", ")}`,
    firstRun.updated.length && `updated ${firstRun.updated.join(", ")}`,
    firstRun.git && "git init",
    firstRun.org && `created org "${firstRun.org}"`,
  ].filter(Boolean);
  console.log(`[library] ${did.join("; ")}`);
}
const stateFile = join(config.library, ".viewswitcher", "state.json");
await sweepStaging(config.library).catch(() => {});
/** The starter kit's scene.js: a pack that ships the same one is marked "the standard scene script" on install. */
const starterScript = await readFile(join(config.starter, "templates/_shared/scene.js"), "utf8").catch(() => null);
/** The built-in template packs: loaded once, on first use, and kept (a pack that won't build is logged and left out). */
let builtinsLoad: Promise<BuiltinPack[]> | null = null;
const builtins = () =>
  (builtinsLoad ??= (config.packs
    ? readBuiltins(config.packs)
    : buildBuiltins(config.starter, existsSync(join(config.site, "src/data/shows.ts")) ? config.site : null, (id, e) =>
        console.error(`[packs] built-in template pack ${id} left out: ${e.message}`))
  ).catch((e) => {
    console.error("[packs] built-in template packs:", (e as Error).message);
    return [];
  }));
void builtins();

// The network is reached only through the Wi-Fi setting (its own listener, which it can close); HOST may
// only move the main listener between loopback addresses.
if (!loopbackAddress(config.host) && config.host !== "localhost") {
  console.error(`[viewswitcher] HOST=${config.host} isn't a loopback address. To let phones and tablets connect, use the Wi-Fi setting (VIEWSWITCHER_LAN=1).`);
  process.exit(1);
}

// Phones and tablets: before anything else awaits, so publish() can always reach them.
/** Paired devices and the open pairing code (pairing.ts); devices.json sits with state.json, outside git (.viewswitcher/ is ignored). */
const pairing = await new Pairing({ file: join(config.library, ".viewswitcher", "devices.json"), ttlMs: Number(process.env.VIEWSWITCHER_PAIR_TTL_MS) || undefined }).load();
type Socket = ServerWebSocket<{ device: string | null; lan: boolean }>;
const sockets = new Set<Socket>();
// A removed device's token stops at once: its next request is refused, and its live sockets close now.
pairing.onRemoved = (id) => {
  for (const ws of sockets) if (ws.data.device === id) ws.close(4401, "This device was removed");
};

/** The main listener on 127.0.0.1, from the end of startup on. */
let server: Server<Socket["data"]> | undefined;
/** The Wi-Fi listener, while "Let phones and tablets on this Wi-Fi connect" is on. */
let lanServer: Server<Socket["data"]> | null = null;

// ---------------------------------------------------------------- live state

/** Every client on 127.0.0.1 and, while it's on, the Wi-Fi listener. Safe before either exists. */
function publish(msg: ServerMessage) {
  const text = JSON.stringify(msg);
  server?.publish("all", text);
  lanServer?.publish("all", text);
}
const log = process.env.VIEWSWITCHER_LOG ? (line: string) => console.log(line) : undefined;

const store = await LiveStore.open({
  root: config.library,
  file: stateFile,
  publish,
  log,
  initial: {
    obs: { connected: false, recording: false, streaming: false },
    obsSetup: null,
    usb: { enabled: false, attached: false, connected: false },
    agent: { onAir: (await readSettings(config.library)).agentOnAir, lastSeen: null, client: null },
  },
});
const state = store.state;
const acceptSlots = createSlotOrder();

// The web build being served. Pages (OBS's program source, the iPad, browsers) reload when it changes,
// so a rebuild reaches OBS without anyone refreshing its browser source.
const readBuild = () =>
  readFile(join(config.webDist, "index.html"), "utf8").then((html) => html.match(/\/assets\/index-[\w-]+\.js/)?.[0] ?? "", () => "");
let build = await readBuild();
setInterval(async () => {
  const next = await readBuild();
  if (next === build) return;
  build = next;
  log?.("[build] switcher rebuilt, reloading pages");
  publish({ t: "build", build });
}, 2000);

const obs = new OBSClient({
  url: config.obs.url,
  password: config.obs.password,
  log: true,
  onStatus: (s) => store.update(s.connected ? { obs: s } : { obs: s, obsSetup: null }),
  onIdentified: () => {
    placer.reset();
    recheckSetup();
    void placer.replay();
  },
  onEvent: (type, data) => {
    placer.onEvent(type);
    if (SETUP_EVENTS.has(type) || (type === "InputSettingsChanged" && data.inputName === config.obs.programSource)) recheckSetup();
  },
});

// OBS sources follow the slots of the scene the program page shows (live/placement.ts).
const placer = createPlacer({
  obs,
  names: config.obs,
  ground: (path) => store.groundFor(path),
  onPlaced: (warnings) => store.setPlacementWarnings(warnings),
  placed: store.placedSources,
  log,
});

// Whether OBS has the scene and sources the switcher needs, in order; the switcher shows a setup card
// until it does. Rechecked when OBS connects, after "Set up OBS", and when scenes or sources come, go
// or move in OBS.
const SETUP_EVENTS = new Set(["SceneCreated", "SceneRemoved", "SceneNameChanged", "SceneItemCreated", "SceneItemRemoved", "SceneItemListReindexed", "InputNameChanged", "InputRemoved"]);
let setupTimer: ReturnType<typeof setTimeout> | undefined;
function recheckSetup() {
  clearTimeout(setupTimer);
  setupTimer = setTimeout(async () => {
    const next = await checkObsSetup(obs, config.obs, config.port).catch(() => null);
    if (JSON.stringify(next) === JSON.stringify(state.obsSetup)) return;
    store.update({ obsSetup: next });
  }, 300);
}
obs.start();

// ---------------------------------------------------------------- library watcher

let changed = new Set<string>();
/** This run of the server, and its library changes so far: a reconnecting client asks whether it missed any. */
const serverRun = crypto.randomUUID();
let librarySeq = 0;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
watch(config.library, { recursive: true }, (_event, filename) => {
  if (!filename) return;
  const rel = filename.split(sep).join("/");
  if (rel.startsWith(".git") || rel.startsWith(".viewswitcher") || rel.includes("/.") || rel.endsWith("~")) return;
  changed.add(rel);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(async () => {
    const paths = [...changed];
    changed = new Set();
    // The on-air record first (its file may be gone): a client that reloads on the change must not load a 404.
    await store.filesChanged(paths).catch((e) => console.error("[state]", (e as Error).message));
    publish({ t: "library:changed", paths, seq: ++librarySeq });
  }, 120);
});

// ---------------------------------------------------------------- HTTP

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const body = async (req: Request) => (await req.json().catch(() => ({}))) as Record<string, any>;

// ---------------------------------------------------------------- phones and tablets

/** This Mac's .local name and LAN addresses, while something can reach us over the network; null otherwise (origin.ts). */
const lanNames = () => (lanServer ? thisMac() : null);

function remoteStatus() {
  const mac = thisMac();
  const addresses = pairingOrder(mac.addresses, mac.vpn);
  const connected = new Map<string, number>();
  for (const ws of sockets) if (ws.data.device) connected.set(ws.data.device, (connected.get(ws.data.device) ?? 0) + 1);
  return {
    enabled: !!lanServer,
    port: config.port,
    localName: mac.localName,
    urls: lanServer ? [...(mac.localName ? [mac.localName] : []), ...addresses].map((h) => `http://${h}:${config.port}/`) : [],
    code: pairing.codeExpiresAt() ? { expiresAt: pairing.codeExpiresAt() } : null,
    /** The last code was cancelled by wrong guesses: someone on the network is guessing. */
    codeGuessed: pairing.codeGuessed,
    devices: pairing.list().map((d) => ({ ...d, connected: connected.get(d.id) ?? 0 })),
  };
}

function setLan(on: boolean): string | null {
  if (on && !lanServer) {
    try {
      lanServer = Bun.serve({ hostname: config.lanHost, port: config.port, fetch: handle, websocket });
      console.log(`[wifi] phones and tablets may connect: http://${thisMac().localName ?? config.lanHost}:${config.port}`);
    } catch (e) {
      console.error("[wifi] couldn't listen on the network:", (e as Error).message);
      return `Couldn't listen on the network: ${(e as Error).message}`;
    }
  }
  if (!on && lanServer) {
    const s = lanServer;
    lanServer = null;
    // Off means off: the port closes and every device on the Wi-Fi is cut off now (they stay paired).
    for (const ws of sockets) if (ws.data.lan) ws.close(1001, "Wi-Fi connections were turned off");
    s.stop(true);
    console.log("[wifi] network listener closed; 127.0.0.1 only");
  }
  return null;
}

/** The pairing endpoints the Mac app calls: from this Mac, with the secret it started the server with. */
const adminSecret = config.adminToken.length >= 32 ? sha3(config.adminToken) : null;
const isAdmin = (req: Request, macOnly: boolean) =>
  macOnly && adminSecret !== null && sha3(req.headers.get("x-viewswitcher-admin") ?? "") === adminSecret; // digests, not raw secrets (pairing.ts)

async function remoteApi(req: Request, path: string): Promise<Response> {
  if (path === "/api/remote" && req.method === "GET") return json(remoteStatus());
  if (req.method !== "POST") return json({ error: "Not found" }, 404);
  const b = await body(req);
  if (path === "/api/remote") {
    const error = setLan(b.enabled === true);
    return error ? json({ error, ...remoteStatus() }, 500) : json(remoteStatus());
  }
  if (path === "/api/remote/code") {
    const { code, expiresAt } = pairing.newCode();
    const s = remoteStatus();
    const [host] = s.urls.filter((u) => !u.includes(".local:")).concat(s.urls);
    // The link opens on an address any phone can reach; `mac` also names this Mac's .local name, so the
    // iPhone and iPad app can pair on the name, which survives the router handing the Mac a new address.
    const mac = s.localName && host && !host.includes(".local:") ? `&mac=${encodeURIComponent(s.localName)}` : "";
    return json({ ...s, code: { code, expiresAt }, pairUrl: host ? `${host}pair?code=${code}${mac}` : null });
  }
  if (path === "/api/remote/remove") {
    try {
      await pairing.remove(String(b.id ?? ""));
    } catch (e) {
      return json({ error: (e as Error).message, ...remoteStatus() }, 500);
    }
    return json(remoteStatus());
  }
  return json({ error: "Not found" }, 404);
}

/** `macOnly`: from this Mac itself, not the iPad on the USB-C bridge (gate.ts fromThisMacOnly). */
async function api(req: Request, path: string, url: URL, macOnly: boolean): Promise<Response> {
  const root = config.library;
  const post = req.method === "POST";
  /** One org's folder; every mutation below works inside it. */
  const org = (id: unknown) => orgDir(root, id);

  if (path === "/api/orgs" && req.method === "GET") return json(await lib.listOrgs(root));
  if (path === "/api/orgs" && post) {
    const b = await body(req);
    return json(await lib.createOrg(root, config.starter, b.name, b.accent, b.ground));
  }
  if (path === "/api/library" && req.method === "GET") return json(await lib.scanLibrary(root, plainName(url.searchParams.get("org") ?? "")));
  if (path === "/api/state" && req.method === "GET") return json(state);
  // For the Mac app's menu (Open Library Folder) and Edit with AI's commands: with the Claude Desktop
  // extension below, the only responses with absolute paths in them. Only for this Mac itself
  // (gate.ts fromThisMacOnly): from loopback, addressed to a loopback host, no proxy headers, and not
  // the iPad on the USB-C bridge.
  if (path === "/api/info" && req.method === "GET") {
    if (!macOnly) return json({ error: "Not found" }, 404);
    const port = server?.port ?? config.port;
    // sidecar, parentPid and pid let a relaunched app find and replace an orphan it started before.
    return json({ library: root, port, sidecar: appParent() !== null, parentPid: appParent(), pid: process.pid, claudeCode: claudeCodeCommand(root, homedir()), stdio: commandLine(ownStdio(port)) });
  }
  if (path === "/api/remote" || path.startsWith("/api/remote/")) {
    return isAdmin(req, macOnly) ? remoteApi(req, path) : json({ error: "Not found" }, 404);
  }
  // Which agent apps this Mac has, so Edit with AI lists them first. Booleans only.
  if (path === "/api/agent/clients" && req.method === "GET") {
    if (!macOnly) return json({ error: "Not found" }, 404);
    return json(detectClients({ home: homedir(), path: process.env.PATH ?? "", exists: existsSync }));
  }
  // Add to Claude Desktop: an extension made for this install, whose command is this server's own executable.
  if (path === "/api/agent/viewswitcher.mcpb" && req.method === "GET") {
    if (!macOnly) return json({ error: "Not found" }, 404);
    const file = mcpbFile(mcpbManifest({ launch: ownStdio(server?.port ?? config.port), version: extensionVersion }));
    return new Response(file, { headers: { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="ViewSwitcher.mcpb"', "cache-control": "no-store" } });
  }

  if (path === "/api/onair" && post) {
    const b = await body(req);
    return json(await store.goOnAir({ path: b.path, label: b.label, projectId: b.projectId, streamId: b.streamId }));
  }

  // What agents connected over MCP may put on air (agent-guard.ts); people in the switcher are never limited.
  if (path === "/api/agent/settings" && post) {
    const b = await body(req);
    const s = await writeSettings(root, { agentOnAir: b.onAir });
    store.update({ agent: { ...state.agent, onAir: s.agentOnAir } });
    return json(state.agent);
  }

  if (path === "/api/program/slots" && post) {
    const b = await body(req);
    // Devices follow what the program page is *showing*, never what was just requested: the page
    // always converges on the latest on-air scene, so its last report matches the final picture.
    // (Ignoring "stale" reports by scene caused drift.) Reports are numbered per page; one that
    // arrives after a newer one from the same page (a live drag's 33 ms reports can swap) is ignored.
    if (!acceptSlots(b.page, b.seq)) return json({ ok: true, stale: true, warnings: state.warnings });
    log?.(`[slots] ${String(b.path).split("/").slice(-2).join("/")}`);
    const slots: Slot[] = (Array.isArray(b.slots) ? b.slots : []).map((s: Slot) => ({
      source: String(s.source), x: Number(s.x), y: Number(s.y), w: Number(s.w), h: Number(s.h),
    }));
    await placer.report(String(b.path), slots);
    return json({ ok: true, warnings: state.warnings });
  }

  if (path === "/api/projects" && post) {
    const b = await body(req);
    return json(await lib.createProject(org(b.org), b.name, b.templates ?? []));
  }
  if (path === "/api/streams" && post) {
    const b = await body(req);
    return json(await lib.createStream(org(b.org), b.projectId, b.name, b.date));
  }
  if (path === "/api/scenes/from-template" && post) {
    const b = await body(req);
    // Where the copy is, so the switcher can open it in the editor.
    return json(await sceneFromTemplate(root, { org: b.org, template: b.template, projectId: b.projectId, streamId: b.streamId }));
  }
  if (path === "/api/scenes/customize" && post) {
    const b = await body(req);
    return json(await customizeScene(root, { org: b.org, projectId: b.projectId, streamId: b.streamId, name: b.name }));
  }
  if (path === "/api/transition/customize" && post) {
    const b = await body(req);
    await lib.customizeTransition(org(b.org), b.projectId);
    return json({ ok: true });
  }
  if (path === "/api/transition/revert" && post) {
    const b = await body(req);
    await lib.revertTransition(org(b.org), b.projectId);
    return json({ ok: true });
  }
  if (path === "/api/scenes/revert" && post) {
    const b = await body(req);
    await lib.revert(org(b.org), b.projectId, b.streamId, b.name);
    return json({ ok: true });
  }
  if (path === "/api/scenes/duplicate" && post) {
    const b = await body(req);
    return json(await duplicateScene(root, b.path));
  }
  if (path === "/api/assets" && post) {
    const form = await req.formData();
    const orgId = plainName(String(form.get("org") ?? ""));
    const saved = [];
    for (const f of form.getAll("file")) {
      if (f instanceof File && f.size > 0) saved.push({ path: `${orgId}/${(await lib.saveAsset(org(orgId), f)).path}` });
    }
    return json({ saved });
  }
  // Template packs: check a dropped .zip or folder and show it, install it as a
  // template set, or remove a set. See packs.ts.
  if (path === "/api/packs/stage" && post) {
    const form = await req.formData();
    const orgId = plainName(String(form.get("org") ?? ""));
    const zip = form.get("zip");
    if (zip instanceof File) return json(await stagePack(root, orgId, { zip: new Uint8Array(await zip.arrayBuffer()) }, starterScript));
    const paths = form.getAll("path").map(String);
    const files = form.getAll("file");
    if (!files.length || files.length !== paths.length || files.some((f) => !(f instanceof File))) return json({ error: "Drop a template pack: a .zip, or its folder" }, 400);
    return json(await stagePack(root, orgId, { files: files.map((f, i) => ({ path: paths[i]!, data: f as File })) }, starterScript));
  }
  // The built-in template packs: listed, then staged like a dropped one.
  if (path === "/api/packs/builtin" && req.method === "GET") {
    return json((await builtins()).map(({ id, name, description, views }) => ({ id, name, description, views })));
  }
  if (path === "/api/packs/builtin/stage" && post) {
    const b = await body(req);
    const pack = (await builtins()).find((p) => p.id === b.id);
    if (!pack) return json({ error: "There's no built-in template pack by that name" }, 404);
    return json(await stagePack(root, plainName(String(b.org ?? "")), { files: asDropped(pack) }, starterScript));
  }
  if (path === "/api/packs/install" && post) {
    const b = await body(req);
    return json(await installPack(root, plainName(String(b.org ?? "")), b.token));
  }
  if (path === "/api/packs/cancel" && post) {
    const b = await body(req);
    await cancelPack(root, plainName(String(b.org ?? "")), b.token);
    return json({ ok: true });
  }
  if (path === "/api/sets/remove" && post) {
    const b = await body(req);
    return json(await removeSet(root, plainName(String(b.org ?? "")), String(b.set ?? "")));
  }
  if (path === "/api/open" && post) {
    const b = await body(req);
    const abs = inside(root, b.path);
    const app = process.env.VIEWSWITCHER_EDITOR;
    Bun.spawn(app ? ["open", "-a", app, abs] : ["open", "-t", abs], { stdout: "ignore", stderr: "ignore" });
    return json({ ok: true });
  }
  // Scene editor: patch the file (409 when it changed since the editor loaded it), or show a change
  // live on the program page without writing anything.
  if (path === "/api/scene/edit" && post) {
    const b = await body(req);
    const r = await editScene(root, b.path, String(b.hash ?? ""), b.edits);
    if (!r.ok) return json({ error: "This scene changed since you opened it", hash: r.hash }, 409);
    log?.(`[edit] ${String(b.path).split("/").slice(-2).join("/")} ${r.changed ? "saved" : "unchanged"}`);
    return json(r);
  }
  // Rename a scene: its title, and a stream scene's file. The scene stays on air if it is.
  if (path === "/api/scene/rename" && post) {
    const b = await body(req);
    const r = await renameScene(root, b.path, String(b.hash ?? ""), b.name);
    if (!r.ok) return json({ error: "This scene changed since you opened it", hash: r.hash }, 409);
    await store.renamed(b.path, b.name, r);
    return json(r);
  }
  if (path === "/api/scene/preview" && post) {
    const b = await body(req);
    scenePath(root, b.path);
    // The hash names the file version the edit's ids belong to; pages showing another version ignore it.
    publish({ t: "scene:preview", path: b.path, hash: String(b.hash ?? ""), edit: parseEdit(b.edit), session: String(b.session ?? "").slice(0, 40), seq: Number(b.seq) || 0 });
    return json({ ok: true });
  }
  if (path === "/api/obs/setup" && post) {
    // JSON only: a cross-site page can't send that without a CORS preflight, which this server never grants,
    // so no website can rearrange OBS mid-stream (the other endpoints rely on the Origin check in handle()).
    if (!req.headers.get("content-type")?.startsWith("application/json")) return json({ error: "Expected application/json" }, 415);
    if (!obs.status.connected) return json({ error: "OBS isn't connected. Open OBS and turn on Tools → WebSocket Server Settings → Enable WebSocket server." }, 503);
    // While streaming or recording, setup never switches OBS's program scene (it would cut the stream).
    const report = await setupObs(obs, config.obs, config.port, { switchProgram: !obs.status.streaming && !obs.status.recording });
    store.update({ obsSetup: await checkObsSetup(obs, config.obs, config.port) });
    return json(report);
  }
  if (path === "/api/obs/record" && post) return json(await obs.request("ToggleRecord"));
  if (path === "/api/obs/stream" && post) return json(await obs.request("ToggleStream"));

  return json({ error: "Not found" }, 404);
}

async function fileResponse(abs: string, cache = "no-store", extra: Record<string, string> = {}) {
  const s = await stat(abs).catch(() => null);
  if (!s?.isFile()) return null;
  return new Response(Bun.file(abs), { headers: { "cache-control": cache, ...extra } });
}

// What an agent runs to connect over stdio: this executable with --mcp-stdio. In the Mac app's compiled
// sidecar, import.meta.dir is inside the binary (/$bunfs/…); from source, bun runs index.ts.
/** The Mac app passes its version (MCPB wants semver; a source checkout has none). */
const extensionVersion = /^\d+\.\d+\.\d+$/.test(process.env.VIEWSWITCHER_VERSION ?? "") ? process.env.VIEWSWITCHER_VERSION! : "1.0.0";
const ownStdio = (port: number) => stdioLaunch(process.execPath, import.meta.dir.startsWith("/$bunfs") ? null : join(import.meta.dir, "index.ts"), port);

// The MCP server for agents on this Mac (mcp/). It shares the switcher's state and its way of going on air.
const mcp: McpDeps = {
  root: config.library,
  kit: config.libraryKit,
  port: config.port,
  state: () => state,
  goOnAir: (b, check) => store.goOnAir(b, check),
  renamed: (from, name, r) => store.renamed(from, name, r),
  outputsKnown: () => obs.outputsKnown,
  previewer: createPreviewer(obs, { obs: config.obs, port: config.port, library: config.library }),
  templateSets: builtins,
  starterScript,
};
function agentSeen(client: string | null) {
  const seen = noteSeen(state.agent, client, Date.now());
  state.agent = seen.agent;
  if (seen.publish) store.publish();
}

/** Every request, on 127.0.0.1 and (while it's on) the Wi-Fi listener. */
async function handle(req: Request, srv: Server<Socket["data"]>): Promise<Response | undefined> {
    const url = new URL(req.url);
    const path = decodeURIComponent(url.pathname);
    try {
      const host = req.headers.get("host");
      const local = fromThisMac(srv.requestIP(req)?.address, req.headers);
      // DNS rebinding: a page at evil.example that now resolves to 127.0.0.1 sends Host: evil.example.
      // The API, the library and the live socket answer only to hosts this server is known by (origin.ts);
      // and anything not from this Mac, page loads included, only to those.
      if ((!local || path === "/ws" || path === "/mcp" || path.startsWith("/api/") || path.startsWith("/library/")) && !hostTrusted(host, config.allowedOrigins, lanNames())) {
        log?.(`[http] refused ${path} for Host ${host}`);
        return json({ error: "Unknown host. If you reach ViewSwitcher by another name, add it to VIEWSWITCHER_ORIGINS." }, 421);
      }
      // Anything not from this Mac needs a paired device (gate.ts); unpaired, it can only pair.
      const device = local ? null : pairing.check(tokenFromCookie(req.headers.get("cookie")));
      const g = gate({ local, paired: !!device, method: req.method, path });
      if (g.kind === "deny") return json({ error: "Pair this device first: open ViewSwitcher on the Mac, then Phones and Tablets." }, 401);
      if (g.kind === "pair-page") {
        return new Response(req.method === "HEAD" ? null : pairPage({ name: guessName(req.headers.get("user-agent") ?? "") }), {
          status: 401,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": PAIR_PAGE_CSP, "x-frame-options": "DENY", "referrer-policy": "no-referrer" },
        });
      }
      // Another website in a browser on this Mac (or on a paired phone) must not be able to change anything (see origin.ts).
      if (path.startsWith("/api/") && req.method !== "GET" && req.method !== "HEAD") {
        const ok = originAllowed(req.headers.get("origin"), { host, forwardedHost: req.headers.get("x-forwarded-host"), extra: config.allowedOrigins, lan: lanNames() });
        if (!ok) {
          log?.(`[http] refused ${req.method} ${path} from ${req.headers.get("origin")}`);
          return json({ error: "Not allowed from this page" }, 403);
        }
      }
      if (g.kind === "pair") {
        // The one POST an unpaired device may make: small, and its size known before it's read.
        const size = Number(req.headers.get("content-length"));
        if (!(size > 0 && size <= 2048)) return json({ error: "Too large" }, 413);
        const b = await body(req);
        const r = pairing.pair(b.code, deviceName(b.name, req.headers.get("user-agent") ?? ""), rateKey(srv.requestIP(req)?.address, req.headers));
        if (!r.ok) {
          console.log(`[pairing] refused a code from ${srv.requestIP(req)?.address} (${r.reason})`);
          return json({ error: r.error }, r.reason === "limited" ? 429 : 403);
        }
        console.log(`[pairing] paired "${r.device.name}"`);
        const secure = url.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
        return Response.json({ ok: true, name: r.device.name }, { headers: { "cache-control": "no-store", "set-cookie": tokenCookie(r.token, secure) } });
      }
      // A paired device (or this Mac) that opens the QR code's link again goes straight to the switcher.
      if (path === "/pair") return new Response(null, { status: 303, headers: { location: "/" } });
      if (path === "/ws") {
        // A WebSocket isn't covered by CORS: a website open in a browser on this Mac could otherwise read
        // the live state. Native clients send no Origin and are let through.
        if (!originAllowed(req.headers.get("origin"), { host, forwardedHost: req.headers.get("x-forwarded-host"), extra: config.allowedOrigins, lan: lanNames() })) {
          return json({ error: "Not allowed from this page" }, 403);
        }
        return srv.upgrade(req, { data: { device: device?.id ?? null, lan: srv === lanServer } }) ? undefined : new Response("Upgrade failed", { status: 400 });
      }
      if (path === "/mcp") {
        // Past the gate, and only ever this Mac itself: handleMcp refuses anything fromThisMacOnly
        // doesn't pass (a paired phone, the USB-C iPad, the Wi-Fi listener) with 404.
        // No idle timeout for agents' calls: Bun drops a connection that's quiet for 10 s, and a tool
        // call can be quiet longer than that (previews run one at a time, ~1.5 s each, so a few in
        // parallel queue up), which the agent would see as a transport error, not an answer.
        // Never on the Wi-Fi listener at all, whatever the peer says.
        if (srv === lanServer) return json({ error: "Not found" }, 404);
        if (fromThisMacOnly(srv.requestIP(req), req.headers)) srv.timeout(req, 0);
        return await handleMcp(req, srv.requestIP(req), { deps: mcp, allowedOrigins: config.allowedOrigins, onSeen: agentSeen });
      }
      const res = await route();
      // A device in use gets its cookie again once a day, so it stays paired 400 days from its last use.
      if (device && res && pairing.renew(device.id)) {
        const token = tokenFromCookie(req.headers.get("cookie"));
        if (token) res.headers.append("set-cookie", tokenCookie(token, url.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https"));
      }
      return res;


    async function route(): Promise<Response> {
      if (path.startsWith("/api/")) {
        log?.(`[http] ${req.method} ${path}`);
        if (path === "/api/log" && req.method === "POST") {
          console.log("[client]", JSON.stringify(await req.json().catch(() => ({}))));
          return json({ ok: true });
        }
        return await api(req, path, url, fromThisMacOnly(srv.requestIP(req), req.headers));
      }
      if (path.startsWith("/library/")) {
        // Every library page is served sandboxed (scene-sandbox.ts): a scene's scripts never run as the switcher.
        const rel = path.slice("/library/".length);
        // "x.html/" would resolve to the file: library URLs never end in a slash.
        if (rel.endsWith("/")) return new Response("Not found", { status: 404, headers: libraryHeaders(rel) });
        const inert = url.searchParams.has("inert");
        // INERT_CSP (same-origin) only on a body that went through defuseMeta below; anything else is sandboxed as usual.
        const headers = libraryHeaders(rel);
        if (path.endsWith(".html") && (url.searchParams.has("edit") || url.searchParams.has("bridge"))) {
          // ?edit: the scene with data-vs element ids, for the editor and the program page; the file is only read.
          // If it can't be tagged for any reason, serve the plain file: the program shows the scene and
          // live previews simply don't apply to it. ?bridge: with the bridge the program page talks to it through.
          const scene = url.searchParams.has("edit")
            ? await readForEdit(config.library, rel).catch((e) => {
                log?.(`[edit] serving ${rel} untagged: ${(e as Error).message}`);
                return null;
              })
            : null;
          const html = scene?.html ?? (await readFile(inside(config.library, rel), "utf8").catch(() => null));
          if (html !== null) {
            return new Response(inert ? defuseMeta(html) : url.searchParams.has("bridge") ? withBridge(html) : html, {
              headers: {
                ...(inert ? libraryHeaders(rel, true) : headers), "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
                ...(scene ? { "x-scene-hash": scene.hash, "access-control-expose-headers": "x-scene-hash" } : {}),
              },
            });
          }
        }
        return (await fileResponse(inside(config.library, rel), "no-store", headers)) ?? new Response("Not found", { status: 404 });
      }
      // The built SPA: real files, else index.html for client-side routes.
      const immutable = path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-store";
      const asset = path !== "/" && (await fileResponse(inside(config.webDist, path), immutable));
      if (asset) return asset;
      const index = await fileResponse(join(config.webDist, "index.html"));
      return index ?? new Response("The switcher isn't built yet. Run `bun run build`, or use the dev server (`bun run dev`, then http://localhost:5173).", { status: 503 });
    }
    } catch (e) {
      if (e instanceof PathError || e instanceof EditError || e instanceof PackError || e instanceof SettingsError) return json({ error: e.message }, 400);
      console.error(e);
      // The full message only for this Mac, with no absolute paths (AGENTS.md: a filesystem error names the
      // file it failed on); a paired device gets a plain one.
      const local = fromThisMac(srv.requestIP(req)?.address, req.headers);
      return json({ error: local ? String((e as Error).message).replaceAll(config.library, "<library>") : "Something went wrong on the Mac. Its server log has the details." }, 500);
    }
}

const websocket = {
  open(ws: Socket) {
    log?.("[ws] client connected");
    sockets.add(ws);
    ws.subscribe("all");
    ws.send(JSON.stringify({ t: "state", state } satisfies ServerMessage));
    ws.send(JSON.stringify({ t: "build", build } satisfies ServerMessage));
    ws.send(JSON.stringify({ t: "hello", server: serverRun, seq: librarySeq } satisfies ServerMessage));
  },
  message() {},
  close(ws: Socket) {
    sockets.delete(ws);
  },
};

server = Bun.serve({ hostname: config.host, port: config.port, fetch: handle, websocket });
if (config.lan) setLan(true);

console.log(`[viewswitcher] http://localhost:${server.port}  library: ${config.library}`);
console.log(`[viewswitcher] OBS program browser source → http://127.0.0.1:${server.port}/program`);

// Quit (the Mac app sends SIGTERM) or Ctrl-C: write paired devices first, so nothing changed in the last moment is lost.
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => void pairing.flush().finally(() => process.exit(0)));
}

// Started by the Mac app: exit if the app goes away without stopping us (parent-watch.ts).
const parent = appParent();
if (parent) {
  watchParent(parent, () => {
    console.log("[viewswitcher] the Mac app is gone; stopping");
    void pairing.flush().finally(() => process.exit(0));
  });
}

// USB-C link for the ViewSwitcher iPad app (see usb-bridge.ts).
if (process.env.VIEWSWITCHER_USB !== "0" && usbAvailable()) {
  store.update({ usb: { ...state.usb, enabled: true } });
  startUsbBridge({
    serverPort: config.port,
    onStatus: (s) => {
      store.update({ usb: { enabled: true, ...s } });
    },
  });
}
