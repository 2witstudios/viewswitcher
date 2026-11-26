// ViewSwitcher server: the switcher API, the library files, live state, OBS, and the MCP server for agents.
import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import type { ServerMessage } from "@viewswitcher/shared";
import type { Server, ServerWebSocket } from "bun";
import { stdioLaunch } from "./agent-connect";
import { type BuiltinPackFiles, buildBuiltins, readBuiltins } from "./builtin-packs";
import { config } from "./config";
import { createLog } from "./log";
import { loopbackAddress } from "./gate";
import { dispatcher, type SocketData } from "./http/dispatch";
import { pairPageResponse, routes, secure } from "./http/routes";
import { pairingOrder, thisMac } from "./lan";
import { appParent, watchParent } from "./parent-watch";
import { LibraryScanner } from "./library/scanner";
import { ensureLibrary } from "./library-kit";
import { createPlacer } from "./live/placement";
import { LiveStore } from "./live/store";
import { noteSeen } from "./mcp/http";
import type { McpDeps } from "./mcp/server";
import { OBSClient } from "./obs";
import { checkObsSetup } from "./obs-setup";
import { sweepStaging } from "./packs";
import { Pairing, sha3, tokenCookie, tokenFromCookie } from "./pairing";
import { createPreviewer } from "./preview";
import { viewHashes } from "./scene-edit";
import { pathScrub } from "./scrub";
import { followSettings, readSettings, widens } from "./settings";
import { createSlotOrder } from "./slot-order";
import { startUsbBridge, usbAvailable } from "./usb-bridge";

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
let builtinsLoad: Promise<BuiltinPackFiles[]> | null = null;
const builtins = () =>
  (builtinsLoad ??= (config.packs
    ? readBuiltins(config.packs)
    : buildBuiltins(config.starter, (id, e) =>
        console.error(`[packs] built-in template pack ${id} left out: ${e.message}`), config.shows)
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
type Socket = ServerWebSocket<SocketData>;
const sockets = new Set<Socket>();
// A removed device's token stops at once: its next request is refused, and its live sockets close now.
pairing.onRemoved = (id) => {
  for (const ws of sockets) if (ws.data.remote === id) ws.close(4401, "This phone or tablet was removed");
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
const log = createLog(config.verbose);

/** Reads an org's content for the switcher and agents; its scene-title cache lives as long as the server. */
const scanner = new LibraryScanner(config.library);

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
/** The last flush of library changes; each waits for the one before it. */
let flushing: Promise<void> = Promise.resolve();
// settings.json changed outside the switcher (by hand, a git checkout): agents follow what it says now.
// The guard limits MCP tools; an agent that can write the library folder can write this file too, so a
// change that lets agents do more is logged where a person can see it.
const settingsChanged = followSettings(config.library, (s) => {
  if (s.agentOnAir === state.agent.onAir) return;
  if (widens(state.agent.onAir, s.agentOnAir)) console.log(`[settings] settings.json changed outside the switcher: agents may now put things on air "${s.agentOnAir}" (was "${state.agent.onAir}")`);
  store.update({ agent: { ...state.agent, onAir: s.agentOnAir } });
});
watch(config.library, { recursive: true }, (_event, filename) => {
  if (!filename) return;
  const rel = filename.split(sep).join("/");
  if (rel === ".viewswitcher" || rel === ".viewswitcher/settings.json") settingsChanged();
  if (rel.startsWith(".git") || rel.startsWith(".viewswitcher") || rel.includes("/.") || rel.endsWith("~")) return;
  changed.add(rel);
  scanner.touched(rel);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    const paths = [...changed];
    changed = new Set();
    scanner.forget(paths);
    // One flush at a time, in the order they fired: a slow one (its hashes read before a newer change)
    // must never publish after the flush for that change, or a client would keep the older hash.
    flushing = flushing.then(async () => {
      // The on-air record first (its file may be gone): a client that reloads on the change must not load a 404.
      await store.filesChanged(paths).catch((e) => console.error("[state]", (e as Error).message));
      // The views' hashes, so an editor sees that a change is its own save without reading it again.
      const hashes = await viewHashes(config.library, paths).catch(() => ({}));
      publish({ t: "library:changed", paths, seq: ++librarySeq, ...(Object.keys(hashes).length ? { hashes } : {}) });
    });
  }, 120);
});

// ---------------------------------------------------------------- phones and tablets

/** This Mac's .local name and LAN addresses, while something can reach us over the network; null otherwise (origin.ts). */
const lanNames = () => (lanServer ? thisMac() : null);

function remoteStatus() {
  const mac = thisMac();
  const addresses = pairingOrder(mac.addresses, mac.vpn);
  const connected = new Map<string, number>();
  for (const ws of sockets) if (ws.data.remote) connected.set(ws.data.remote, (connected.get(ws.data.remote) ?? 0) + 1);
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
    // Off means off: the port closes and every paired phone or tablet is cut off now, on the Wi-Fi or through
    // tailscale serve (they stay paired). Only this Mac's and the USB-C device's sockets have no remote.
    for (const ws of sockets) if (ws.data.lan || ws.data.remote) ws.close(1001, "Wi-Fi connections were turned off");
    s.stop(true);
    console.log("[wifi] network listener closed; 127.0.0.1 only");
  }
  return null;
}

/** The pairing endpoints the Mac app calls: from this Mac, with the secret it started the server with. */
const adminSecret = config.adminToken.length >= 32 ? sha3(config.adminToken) : null;
const isAdmin = (req: Request) => adminSecret !== null && sha3(req.headers.get("x-viewswitcher-admin") ?? "") === adminSecret; // digests, not raw secrets (pairing.ts)

// What an agent runs to connect over stdio: this executable with --mcp-stdio. In the Mac app's compiled
// sidecar, import.meta.dir is inside the binary (/$bunfs/…); from source, bun runs index.ts.
/** The Mac app passes its version (MCPB wants semver; a source checkout has none). */
const extensionVersion = /^\d+\.\d+\.\d+$/.test(process.env.VIEWSWITCHER_VERSION ?? "") ? process.env.VIEWSWITCHER_VERSION! : "1.0.0";
const ownStdio = (port: number) => stdioLaunch(process.execPath, import.meta.dir.startsWith("/$bunfs") ? null : join(import.meta.dir, "index.ts"), port);

// The MCP server for agents on this Mac (mcp/). It shares the switcher's state and its way of going on air.
const mcp: McpDeps = {
  root: config.library,
  scanner,
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

// ---------------------------------------------------------------- HTTP

/** Every request, on 127.0.0.1 and (while it's on) the Wi-Fi listener: one route table (http/routes.ts), one dispatcher. */
const handle = dispatcher({
  routes: routes({
    root: config.library,
    scanner,
    starter: config.starter,
    webDist: config.webDist,
    obsNames: config.obs,
    obsPort: config.port,
    store,
    obs,
    placer,
    acceptSlots,
    publish,
    builtins,
    starterScript,
    pairing,
    remote: { status: remoteStatus, setLan },
    isAdmin,
    port: () => server?.port ?? config.port,
    ownStdio,
    extensionVersion,
    mcp: { deps: mcp, allowedOrigins: config.allowedOrigins, onSeen: agentSeen },
    log,
  }),
  allowedOrigins: config.allowedOrigins,
  lan: lanNames,
  // One setting for everything not from this Mac or the USB-C bridge: the Wi-Fi listener and tailscale serve.
  remoteAccess: () => !!lanServer,
  onLan: (srv) => srv === lanServer,
  remote: (req) => pairing.check(tokenFromCookie(req.headers.get("cookie")))?.id ?? null,
  renew: (remote, c) => {
    const token = tokenFromCookie(c.req.headers.get("cookie"));
    return token && pairing.renew(remote) ? tokenCookie(token, secure(c)) : null;
  },
  pairPage: pairPageResponse,
  scrub: pathScrub(config.library),
  log,
});

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

// Quit (the Mac app sends SIGTERM) or Ctrl-C: write paired phones and tablets first, so nothing changed in the last moment is lost.
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
