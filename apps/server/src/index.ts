// ViewSwitcher server: the switcher API, the library files, live state, and OBS.
import { watch } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { EditError, obsColor, orgOf } from "@viewswitcher/shared";
import type { LiveState, OnAir, ServerMessage, Slot } from "@viewswitcher/shared";
import { config } from "./config";
import * as lib from "./library";
import { ensureLibrary } from "./library-kit";
import { OBSClient } from "./obs";
import { checkObsSetup, setupObs } from "./obs-setup";
import { inside, PathError, plainName } from "./paths";
import { placeDevices } from "./placement";
import { createSlotOrder } from "./slot-order";
import { editScene, parseEdit, readForEdit, scenePath } from "./scene-edit";
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

// ---------------------------------------------------------------- live state

const saved = await readFile(stateFile, "utf8").then((t) => JSON.parse(t) as { onAir: OnAir | null }, () => ({ onAir: null }));
const state: LiveState = {
  onAir: saved.onAir,
  obs: { connected: false, recording: false, streaming: false },
  obsSetup: null,
  usb: { enabled: false, attached: false, connected: false },
  warnings: [],
};
if (state.onAir) state.onAir.transition = await lib.resolveTransition(config.library, state.onAir.path).catch(() => null);
let lastSlots: { path: string; slots: Slot[] } | null = null;
const acceptSlots = createSlotOrder();

function publish(msg: ServerMessage) {
  server.publish("all", JSON.stringify(msg));
}
const publishState = () => publish({ t: "state", state });

// The web build being served. Pages (OBS's program source, the iPad, browsers) reload when it changes,
// so a rebuild reaches OBS without anyone refreshing its browser source.
const readBuild = () =>
  readFile(join(config.webDist, "index.html"), "utf8").then((html) => html.match(/\/assets\/index-[\w-]+\.js/)?.[0] ?? "", () => "");
let build = await readBuild();
setInterval(async () => {
  const next = await readBuild();
  if (next === build) return;
  build = next;
  if (process.env.VIEWSWITCHER_LOG) console.log("[build] switcher rebuilt, reloading pages");
  publish({ t: "build", build });
}, 2000);

async function persist() {
  await mkdir(join(config.library, ".viewswitcher"), { recursive: true });
  await writeFile(stateFile, JSON.stringify({ onAir: state.onAir }, null, 2));
}

const obs = new OBSClient({
  url: config.obs.url,
  password: config.obs.password,
  log: true,
  onStatus: (s) => {
    state.obs = s;
    if (!s.connected) state.obsSetup = null;
    publishState();
  },
  onIdentified: () => {
    groundShown = null;
    recheckSetup();
    if (lastSlots) applyLatest();
  },
  onEvent: (type, data) => {
    if (SETUP_EVENTS.has(type) || (type === "InputSettingsChanged" && data.inputName === config.obs.programSource)) recheckSetup();
  },
}).start();

// Whether OBS has the scene and sources the switcher needs; the switcher shows a setup card until it does.
// Rechecked when OBS connects, after "Set up OBS", and when scenes or sources come and go in OBS.
const SETUP_EVENTS = new Set(["SceneCreated", "SceneRemoved", "SceneNameChanged", "SceneItemCreated", "SceneItemRemoved", "InputNameChanged", "InputRemoved"]);
let setupTimer: ReturnType<typeof setTimeout> | undefined;
function recheckSetup() {
  clearTimeout(setupTimer);
  setupTimer = setTimeout(async () => {
    const next = await checkObsSetup(obs, config.obs, config.port).catch(() => null);
    if (JSON.stringify(next) === JSON.stringify(state.obsSetup)) return;
    state.obsSetup = next;
    publishState();
  }, 300);
}

// OBS placements run one at a time, and only the latest request is applied: overlapping
// placements would interleave OBS requests and could leave sources from an older scene.
let placementQueue = Promise.resolve();
let placementSeq = 0;

function applyLatest(): Promise<void> {
  const seq = ++placementSeq;
  placementQueue = placementQueue.then(async () => {
    if (seq !== placementSeq || !lastSlots) return; // superseded
    if (process.env.VIEWSWITCHER_LOG) console.log(`[place] ${lastSlots.path.split("/").slice(-2).join("/")}`);
    await applySlots(lastSlots.path, lastSlots.slots);
  });
  return placementQueue;
}

// The OBS ground color follows the org of the scene being shown.
let groundShown: string | null = null;
async function applyGround(path: string) {
  const org = await lib.readOrg(config.library, orgOf(path)).catch(() => null);
  if (!org || org.ground === groundShown) return;
  await obs.request("SetInputSettings", { inputName: config.obs.groundSource, inputSettings: { color: obsColor(org.ground) } });
  groundShown = org.ground;
}

async function applySlots(path: string, slots: Slot[]) {
  if (!obs.status.connected) {
    state.warnings = [];
    return publishState();
  }
  try {
    await applyGround(path).catch(() => {}); // a missing ground source isn't worth a warning
    state.warnings = await placeDevices(obs, slots, config.obs);
  } catch (e) {
    state.warnings = [`Couldn't place sources in OBS: ${(e as Error).message}`];
  }
  publishState();
}

// ---------------------------------------------------------------- library watcher

let changed = new Set<string>();
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
    publish({ t: "library:changed", paths });
    // A transition file appeared or went away: re-pick the one for the scene on air.
    if (state.onAir && paths.some((p) => p.endsWith("transition.html"))) {
      const transition = await lib.resolveTransition(config.library, state.onAir.path);
      if (transition !== state.onAir.transition) {
        state.onAir.transition = transition;
        publishState();
      }
    }
  }, 120);
});

// ---------------------------------------------------------------- HTTP

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const body = async (req: Request) => (await req.json().catch(() => ({}))) as Record<string, any>;

async function api(req: Request, path: string, url: URL): Promise<Response> {
  const root = config.library;
  const post = req.method === "POST";
  /** One org's folder; every mutation below works inside it. */
  const org = (id: unknown) => inside(root, plainName(String(id ?? "")));

  if (path === "/api/orgs" && req.method === "GET") return json(await lib.listOrgs(root));
  if (path === "/api/orgs" && post) {
    const b = await body(req);
    return json(await lib.createOrg(root, config.starter, b.name, b.accent, b.ground));
  }
  if (path === "/api/library" && req.method === "GET") return json(await lib.scanLibrary(root, plainName(url.searchParams.get("org") ?? "")));
  if (path === "/api/state" && req.method === "GET") return json(state);
  // For the Mac app's menu (Open Library Folder). Only to local requests: a Tailscale-served
  // switcher has no use for this Mac's folder paths.
  if (path === "/api/info" && req.method === "GET") {
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.get("host") ?? "")) return json({ error: "Not found" }, 404);
    return json({ library: root, port: server.port });
  }

  if (path === "/api/onair" && post) {
    const b = await body(req);
    inside(root, b.path);
    if (process.env.VIEWSWITCHER_LOG) console.log(`[onair] ${String(b.path).split("/").slice(-2).join("/")}`);
    const o = await lib.readOrg(root, orgOf(b.path));
    const transition = await lib.resolveTransition(root, b.path);
    state.onAir = { path: b.path, org: o.id, ground: o.ground, transition, label: String(b.label ?? b.path), projectId: b.projectId, streamId: b.streamId };
    state.warnings = [];
    await persist();
    publishState();
    return json(state);
  }

  if (path === "/api/program/slots" && post) {
    const b = await body(req);
    // Devices follow what the program page is *showing*, never what was just requested: the page
    // always converges on the latest on-air scene, so its last report matches the final picture.
    // (Ignoring "stale" reports by scene caused drift.) Reports are numbered per page; one that
    // arrives after a newer one from the same page (a live drag's 33 ms reports can swap) is ignored.
    if (!acceptSlots(b.page, b.seq)) return json({ ok: true, stale: true, warnings: state.warnings });
    if (process.env.VIEWSWITCHER_LOG) console.log(`[slots] ${String(b.path).split("/").slice(-2).join("/")}`);
    const slots: Slot[] = (b.slots ?? []).map((s: Slot) => ({
      source: String(s.source), x: Number(s.x), y: Number(s.y), w: Number(s.w), h: Number(s.h),
    }));
    lastSlots = { path: b.path, slots };
    await applyLatest();
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
    return json(await lib.addFromTemplate(org(b.org), b.template, b.projectId, b.streamId));
  }
  if (path === "/api/scenes/customize" && post) {
    const b = await body(req);
    return json(await lib.customize(org(b.org), b.projectId, b.streamId, b.name));
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
    return json(await lib.duplicate(root, b.path));
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
    if (process.env.VIEWSWITCHER_LOG) console.log(`[edit] ${String(b.path).split("/").slice(-2).join("/")} ${r.changed ? "saved" : "unchanged"}`);
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
    if (!obs.status.connected) return json({ error: "OBS isn't connected. Open OBS and turn on Tools → WebSocket Server Settings → Enable WebSocket server." }, 503);
    const report = await setupObs(obs, config.obs, config.port);
    state.obsSetup = await checkObsSetup(obs, config.obs, config.port);
    publishState();
    return json(report);
  }
  if (path === "/api/obs/record" && post) return json(await obs.request("ToggleRecord"));
  if (path === "/api/obs/stream" && post) return json(await obs.request("ToggleStream"));

  return json({ error: "Not found" }, 404);
}

async function fileResponse(abs: string, cache = "no-store") {
  const s = await stat(abs).catch(() => null);
  if (!s?.isFile()) return null;
  return new Response(Bun.file(abs), { headers: { "cache-control": cache } });
}

const server = Bun.serve({
  hostname: process.env.HOST ?? "127.0.0.1",
  port: config.port,
  async fetch(req, server) {
    const url = new URL(req.url);
    const path = decodeURIComponent(url.pathname);
    try {
      if (path === "/ws") {
        return server.upgrade(req) ? undefined : new Response("Upgrade failed", { status: 400 });
      }
      if (path.startsWith("/api/")) {
        if (process.env.VIEWSWITCHER_LOG) console.log(`[http] ${req.method} ${path}`);
        if (path === "/api/log" && req.method === "POST") {
          console.log("[client]", JSON.stringify(await req.json().catch(() => ({}))));
          return json({ ok: true });
        }
        return await api(req, path, url);
      }
      if (path.startsWith("/library/")) {
        if (url.searchParams.has("edit") && path.endsWith(".html")) {
          // The scene with data-vs element ids, for the editor and the program page; the file is only read.
          // If it can't be tagged for any reason, serve the plain file: the program shows the scene and
          // live previews simply don't apply to it.
          const rel = path.slice("/library/".length);
          const scene = await readForEdit(config.library, rel).catch((e) => {
            if (process.env.VIEWSWITCHER_LOG) console.log(`[edit] serving ${rel} untagged: ${(e as Error).message}`);
            return null;
          });
          if (scene) {
            return new Response(scene.html, {
              headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-scene-hash": scene.hash, "access-control-expose-headers": "x-scene-hash" },
            });
          }
        }
        return (await fileResponse(inside(config.library, path.slice("/library/".length)))) ?? new Response("Not found", { status: 404 });
      }
      // The built SPA: real files, else index.html for client-side routes.
      const immutable = path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-store";
      const asset = path !== "/" && (await fileResponse(inside(config.webDist, path), immutable));
      if (asset) return asset;
      const index = await fileResponse(join(config.webDist, "index.html"));
      return index ?? new Response("The switcher isn't built yet. Run `bun run build`, or use the dev server (`bun run dev`, then http://localhost:5173).", { status: 503 });
    } catch (e) {
      if (e instanceof PathError || e instanceof EditError) return json({ error: e.message }, 400);
      console.error(e);
      return json({ error: (e as Error).message }, 500);
    }
  },
  websocket: {
    open(ws) {
      if (process.env.VIEWSWITCHER_LOG) console.log("[ws] client connected");
      ws.subscribe("all");
      ws.send(JSON.stringify({ t: "state", state } satisfies ServerMessage));
      ws.send(JSON.stringify({ t: "build", build } satisfies ServerMessage));
    },
    message() {},
  },
});

console.log(`[viewswitcher] http://localhost:${server.port}  library: ${config.library}`);
console.log(`[viewswitcher] OBS program browser source → http://127.0.0.1:${server.port}/program`);

// Started by the Mac app: exit if the app goes away without stopping us (a crash, a force quit),
// so the port is never left held by an orphan.
const parent = Number(process.env.VIEWSWITCHER_PARENT_PID);
if (parent > 1) {
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch {
      console.log("[viewswitcher] the Mac app is gone; stopping");
      process.exit(0);
    }
  }, 2000).unref();
}

// USB-C link for the ViewSwitcher iPad app (see usb-bridge.ts).
if (process.env.VIEWSWITCHER_USB !== "0" && usbAvailable()) {
  state.usb.enabled = true;
  startUsbBridge({
    serverPort: config.port,
    onStatus: (s) => {
      state.usb = { enabled: true, ...s };
      publishState();
    },
  });
}
