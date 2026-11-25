// One WebSocket to the server: live state (on air, OBS, warnings) and file-change versions.
import type { LiveState, SceneEdit, ServerMessage } from "@viewswitcher/shared";
import { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { clientKind, connectorUrl } from "./client-kind";

export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } });

type Live = {
  connected: boolean;
  state: LiveState | null;
  /** Bumped per library path when its file changes; `*` bumps when any org's shared theme changes. */
  versions: Record<string, number>;
};

let live: Live = { connected: false, state: null, versions: {} };

type PreviewListener = (path: string, hash: string, edit: SceneEdit, order: { session: string; seq: number }) => void;
const previewListeners = new Set<PreviewListener>();
/** Live changes from the scene editor (never saved): the program page applies them to the on-air scene. */
export function onScenePreview(listener: PreviewListener) {
  previewListeners.add(listener);
  return () => void previewListeners.delete(listener);
}
const listeners = new Set<() => void>();
const set = (patch: Partial<Live>) => {
  live = { ...live, ...patch };
  listeners.forEach((l) => l());
};

/** Running inside the ViewSwitcher iPad app (by its user agent; the Mac app's window is not this). */
export const inApp = typeof navigator !== "undefined" && clientKind(navigator.userAgent) === "ipad";
/** How the app reaches the Mac: its USB-C tunnel serves the switcher on 127.0.0.1. */
export const appLink = inApp ? (location.hostname === "127.0.0.1" ? "USB" : "Network") : null;

// In the app, if the server has been unreachable for a few seconds, go back to the app's
// connector page: it picks whichever link works now (USB-C or the network) and returns here.
const BACK_TO_CONNECTOR_MS = 4000;
let downTimer: ReturnType<typeof setTimeout> | undefined;
/** The built entry script this page runs (undefined under the Vite dev server, which never reloads this way). */
const ownBuild = typeof document !== "undefined" ? document.querySelector<HTMLScriptElement>('script[src*="/assets/index-"]')?.getAttribute("src") ?? undefined : undefined;

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    clearTimeout(downTimer);
    downTimer = undefined;
    set({ connected: true });
  };
  ws.onclose = () => {
    set({ connected: false });
    if (inApp && !downTimer) downTimer = setTimeout(() => location.replace(connectorUrl(navigator.userAgent)), BACK_TO_CONNECTOR_MS);
    setTimeout(connect, 1000);
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data) as ServerMessage;
    if (msg.t === "state") set({ state: msg.state });
    if (msg.t === "scene:preview") previewListeners.forEach((l) => l(msg.path, msg.hash, msg.edit, { session: msg.session, seq: msg.seq }));
    if (msg.t === "build" && msg.build && ownBuild && msg.build !== ownBuild) location.reload();
    if (msg.t === "library:changed") {
      const versions = { ...live.versions };
      for (const p of msg.paths) {
        versions[p] = (versions[p] ?? 0) + 1;
        // An org's or a template set's shared theme: every cover may use it.
        if (p.includes("/_shared/")) versions["*"] = (versions["*"] ?? 0) + 1;
      }
      set({ versions });
      queryClient.invalidateQueries({ queryKey: ["library"] });
    }
  };
}
if (typeof window !== "undefined") connect();

export function useLive(): Live {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => live,
  );
}

/**
 * URL for a library file that changes whenever the file (or the shared theme) changes.
 * `preview` paints the ground and labels slots; `edit` serves it with data-vs element ids.
 */
/** `bridge`: with the bridge the program page talks to the sandboxed scene through (EDIT-26). */
export function sceneUrl(path: string, versions: Record<string, number>, preview = false, edit = false, bridge = false) {
  const v = `${versions[path] ?? 0}.${versions["*"] ?? 0}`;
  return `${libraryUrl(path)}?${edit ? "edit&" : ""}${bridge ? "bridge&" : ""}${preview ? "preview&" : ""}v=${v}`;
}

/** /library/<path> with each segment encoded, so a "#", "?" or "%" in a file name survives. */
export function libraryUrl(path: string) {
  return `/library/${path.split("/").map(encodeURIComponent).join("/")}`;
}
