// Daisy Production server: the switcher API, the library files, live state, and OBS.
import { watch } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import type { LiveState, OnAir, ServerMessage, Slot } from "@daisy/shared";
import { config } from "./config";
import * as lib from "./library";
import { OBSClient } from "./obs";
import { inside, PathError } from "./paths";
import { placeDevices } from "./placement";

await mkdir(config.library, { recursive: true });
const stateFile = join(config.library, ".daisy", "state.json");

// ---------------------------------------------------------------- live state

const saved = await readFile(stateFile, "utf8").then((t) => JSON.parse(t) as { onAir: OnAir | null }, () => ({ onAir: null }));
const state: LiveState = { onAir: saved.onAir, obs: { connected: false, recording: false, streaming: false }, warnings: [] };
let lastSlots: { path: string; slots: Slot[] } | null = null;

function publish(msg: ServerMessage) {
  server.publish("all", JSON.stringify(msg));
}
const publishState = () => publish({ t: "state", state });

async function persist() {
  await mkdir(join(config.library, ".daisy"), { recursive: true });
  await writeFile(stateFile, JSON.stringify({ onAir: state.onAir }, null, 2));
}

const obs = new OBSClient({
  url: config.obs.url,
  password: config.obs.password,
  log: true,
  onStatus: (s) => {
    state.obs = s;
    publishState();
  },
  onIdentified: () => {
    if (lastSlots) applyLatest();
  },
}).start();

// OBS placements run one at a time, and only the latest request is applied: overlapping
// placements would interleave OBS requests and could leave sources from an older scene.
let placementQueue = Promise.resolve();
let placementSeq = 0;

function applyLatest(): Promise<void> {
  const seq = ++placementSeq;
  placementQueue = placementQueue.then(async () => {
    if (seq !== placementSeq || !lastSlots) return; // superseded
    if (process.env.DAISY_LOG) console.log(`[place] ${lastSlots.path.split("/").slice(-2).join("/")}`);
    await applySlots(lastSlots.slots);
  });
  return placementQueue;
}

async function applySlots(slots: Slot[]) {
  if (!obs.status.connected) {
    state.warnings = [];
    return publishState();
  }
  try {
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
  if (rel.startsWith(".git") || rel.startsWith(".daisy") || rel.includes("/.") || rel.endsWith("~")) return;
  changed.add(rel);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    publish({ t: "library:changed", paths: [...changed] });
    changed = new Set();
  }, 120);
});

// ---------------------------------------------------------------- HTTP

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const body = async (req: Request) => (await req.json().catch(() => ({}))) as Record<string, any>;

async function api(req: Request, path: string): Promise<Response> {
  const root = config.library;
  const post = req.method === "POST";

  if (path === "/api/library" && req.method === "GET") return json(await lib.scanLibrary(root));
  if (path === "/api/state" && req.method === "GET") return json(state);

  if (path === "/api/onair" && post) {
    const b = await body(req);
    inside(root, b.path);
    if (process.env.DAISY_LOG) console.log(`[onair] ${String(b.path).split("/").slice(-2).join("/")}`);
    state.onAir = { path: b.path, label: String(b.label ?? b.path), projectId: b.projectId, streamId: b.streamId };
    state.warnings = [];
    await persist();
    publishState();
    return json(state);
  }

  if (path === "/api/program/slots" && post) {
    const b = await body(req);
    // Devices follow what the program page is *showing*, never what was just requested: the page
    // always converges on the latest on-air scene, and its reports arrive in order, so the last
    // placement always matches the final picture. (Ignoring "stale" reports here caused drift.)
    if (process.env.DAISY_LOG) console.log(`[slots] ${String(b.path).split("/").slice(-2).join("/")}`);
    const slots: Slot[] = (b.slots ?? []).map((s: Slot) => ({
      source: String(s.source), x: Number(s.x), y: Number(s.y), w: Number(s.w), h: Number(s.h),
    }));
    lastSlots = { path: b.path, slots };
    await applyLatest();
    return json({ ok: true, warnings: state.warnings });
  }

  if (path === "/api/projects" && post) {
    const b = await body(req);
    return json(await lib.createProject(root, b.name, b.templates ?? []));
  }
  if (path === "/api/streams" && post) {
    const b = await body(req);
    return json(await lib.createStream(root, b.projectId, b.name, b.date));
  }
  if (path === "/api/scenes/from-template" && post) {
    const b = await body(req);
    return json(await lib.addFromTemplate(root, b.template, b.projectId, b.streamId));
  }
  if (path === "/api/scenes/customize" && post) {
    const b = await body(req);
    return json(await lib.customize(root, b.projectId, b.streamId, b.name));
  }
  if (path === "/api/scenes/revert" && post) {
    const b = await body(req);
    await lib.revert(root, b.projectId, b.streamId, b.name);
    return json({ ok: true });
  }
  if (path === "/api/scenes/duplicate" && post) {
    const b = await body(req);
    return json(await lib.duplicate(root, b.path));
  }
  if (path === "/api/assets" && post) {
    const form = await req.formData();
    const saved = [];
    for (const f of form.getAll("file")) if (f instanceof File && f.size > 0) saved.push(await lib.saveAsset(root, f));
    return json({ saved });
  }
  if (path === "/api/open" && post) {
    const b = await body(req);
    const abs = inside(root, b.path);
    const app = process.env.DAISY_EDITOR;
    Bun.spawn(app ? ["open", "-a", app, abs] : ["open", "-t", abs], { stdout: "ignore", stderr: "ignore" });
    return json({ ok: true });
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
        if (process.env.DAISY_LOG) console.log(`[http] ${req.method} ${path}`);
        if (path === "/api/log" && req.method === "POST") {
          console.log("[client]", JSON.stringify(await req.json().catch(() => ({}))));
          return json({ ok: true });
        }
        return await api(req, path);
      }
      if (path.startsWith("/library/")) {
        return (await fileResponse(inside(config.library, path.slice("/library/".length)))) ?? new Response("Not found", { status: 404 });
      }
      // The built SPA: real files, else index.html for client-side routes.
      const immutable = path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-store";
      const asset = path !== "/" && (await fileResponse(inside(config.webDist, path), immutable));
      if (asset) return asset;
      const index = await fileResponse(join(config.webDist, "index.html"));
      return index ?? new Response("The switcher isn't built yet. Run `bun run build`, or use the dev server (`bun run dev`, then http://localhost:5173).", { status: 503 });
    } catch (e) {
      if (e instanceof PathError) return json({ error: e.message }, 400);
      console.error(e);
      return json({ error: (e as Error).message }, 500);
    }
  },
  websocket: {
    open(ws) {
      if (process.env.DAISY_LOG) console.log("[ws] client connected");
      ws.subscribe("all");
      ws.send(JSON.stringify({ t: "state", state } satisfies ServerMessage));
    },
    message() {},
  },
});

console.log(`[daisy] http://localhost:${server.port}  library: ${config.library}`);
console.log(`[daisy] OBS program browser source → http://127.0.0.1:${server.port}/program`);
