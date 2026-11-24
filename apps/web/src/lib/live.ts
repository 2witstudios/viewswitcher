// One WebSocket to the server: live state (on air, OBS, warnings) and file-change versions.
import type { LiveState, SceneEdit, ServerMessage } from "@viewswitcher/shared";
import { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } });

type Live = {
  connected: boolean;
  state: LiveState | null;
  /** Bumped per library path when its file changes; `*` bumps when any org's shared theme changes. */
  versions: Record<string, number>;
};

let live: Live = { connected: false, state: null, versions: {} };

type PreviewListener = (path: string, edit: SceneEdit) => void;
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

/** Running inside the ViewSwitcher iPad app (its WebView appends this to the user agent). */
export const inApp = typeof navigator !== "undefined" && navigator.userAgent.includes("ViewSwitcher");
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
    if (inApp && !downTimer) downTimer = setTimeout(() => location.replace("capacitor://localhost/"), BACK_TO_CONNECTOR_MS);
    setTimeout(connect, 1000);
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data) as ServerMessage;
    if (msg.t === "state") set({ state: msg.state });
    if (msg.t === "scene:preview") previewListeners.forEach((l) => l(msg.path, msg.edit));
    if (msg.t === "build" && msg.build && ownBuild && msg.build !== ownBuild) location.reload();
    if (msg.t === "library:changed") {
      const versions = { ...live.versions };
      for (const p of msg.paths) {
        versions[p] = (versions[p] ?? 0) + 1;
        if (p.includes("templates/_shared/")) versions["*"] = (versions["*"] ?? 0) + 1;
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
export function sceneUrl(path: string, versions: Record<string, number>, preview = false, edit = false) {
  const v = `${versions[path] ?? 0}.${versions["*"] ?? 0}`;
  return `/library/${path}?${edit ? "edit&" : ""}${preview ? "preview&" : ""}v=${v}`;
}
