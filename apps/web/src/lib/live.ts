// One WebSocket to the server: live state (on air, OBS, warnings) and file-change versions.
import type { LiveState, SceneEdit, ServerMessage } from "@viewswitcher/shared";
import { QueryClient } from "@tanstack/react-query";
import { useRef, useSyncExternalStore } from "react";
import { clientKind, connectorUrl } from "./client-kind";

export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } });

export type Live = {
  connected: boolean;
  state: LiveState | null;
  /** Bumped per library path when its file changes; `*` bumps when any org's shared theme changes. */
  versions: Record<string, number>;
};

/** A value that changes over time, read by components a part at a time (useStore). */
export type Store<T> = { get: () => T; set: (next: T) => void; subscribe: (listener: () => void) => () => void };

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe: (l) => (listeners.add(l), () => void listeners.delete(l)),
  };
}

/**
 * The part of a store's value a component uses: it re-renders only when that part changes (by
 * `isEqual`, Object.is unless given). The selector may be a new function on every render.
 */
export function useStore<T, S>(store: Store<T>, selector: (value: T) => S, isEqual: (a: S, b: S) => boolean = Object.is): S {
  const last = useRef<{ value: T; selector: (value: T) => S; selected: S } | null>(null);
  const read = () => {
    const value = store.get();
    const l = last.current;
    if (l && l.value === value && l.selector === selector) return l.selected;
    const next = selector(value);
    // An equal selection keeps the one returned before, so React sees nothing changed and skips the render.
    const selected = l && isEqual(l.selected, next) ? l.selected : next;
    last.current = { value, selector, selected };
    return selected;
  };
  return useSyncExternalStore(store.subscribe, read, read);
}

/**
 * `next`, keeping each part of `prev` that's equal to its counterpart in `next` (values as JSON
 * carries them). Every state message is a new object from the socket; this way a part that didn't
 * change (OBS's status, what's on air) is the same object as before, so a component that reads only
 * that part doesn't re-render.
 */
export function keepUnchanged<T>(prev: T, next: T): T {
  if (Object.is(prev, next)) return prev;
  if (typeof prev !== "object" || typeof next !== "object" || !prev || !next || Array.isArray(prev) !== Array.isArray(next)) return next;
  if (Array.isArray(next)) {
    const p = prev as unknown[];
    const merged = next.map((v, i) => keepUnchanged(p[i], v));
    return (merged.length === p.length && merged.every((v, i) => v === p[i]) ? p : merged) as T;
  }
  const p = prev as Record<string, unknown>, n = next as Record<string, unknown>;
  const merged: Record<string, unknown> = {};
  let same = Object.keys(p).length === Object.keys(n).length;
  for (const k of Object.keys(n)) {
    merged[k] = keepUnchanged(p[k], n[k]);
    if (merged[k] !== p[k] || !(k in p)) same = false;
  }
  return (same ? p : merged) as T;
}

const store = createStore<Live>({ connected: false, state: null, versions: {} });

type PreviewListener = (path: string, hash: string, edit: SceneEdit, order: { session: string; seq: number }) => void;
const previewListeners = new Set<PreviewListener>();
/** Live changes from the scene editor (never saved): the program page applies them to the on-air scene. */
export function onScenePreview(listener: PreviewListener) {
  previewListeners.add(listener);
  return () => void previewListeners.delete(listener);
}
const set = (patch: Partial<Live>) => store.set({ ...store.get(), ...patch });

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

/** The server run and its last library change this page heard; null until the first hello. */
let heard: { server: string; seq: number } | null = null;

/**
 * Whether a page coming back to the live socket missed library changes: the server restarted (a new
 * run) or sent changes while the page was away. A short drop with nothing changed reloads nothing.
 */
export function missedChanges(last: { server: string; seq: number } | null, hello: { server: string; seq: number }): boolean {
  return last !== null && (last.server !== hello.server || last.seq !== hello.seq);
}

/**
 * After changes were missed, any file may have changed: bump every version (the shared `*`, in every
 * scene url) so each scene loads what's on disk now.
 */
export function caughtUp(versions: Record<string, number>): Record<string, number> {
  return { ...versions, "*": (versions["*"] ?? 0) + 1 };
}

/** Live state after a state message or a library change from the socket. */
export function nextLive(live: Live, msg: Extract<ServerMessage, { t: "state" | "library:changed" }>): Live {
  if (msg.t === "state") return { ...live, state: keepUnchanged(live.state, msg.state) };
  const versions = { ...live.versions };
  for (const p of msg.paths) {
    versions[p] = (versions[p] ?? 0) + 1;
    // An org's or a template set's shared theme: every cover may use it.
    if (p.includes("/_shared/")) versions["*"] = (versions["*"] ?? 0) + 1;
  }
  return { ...live, versions };
}

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
    if (msg.t === "hello") {
      if (missedChanges(heard, msg)) {
        set({ versions: caughtUp(store.get().versions) });
        queryClient.invalidateQueries({ queryKey: ["library"] });
      }
      heard = { server: msg.server, seq: msg.seq };
    }
    if (msg.t === "state" || msg.t === "library:changed") store.set(nextLive(store.get(), msg));
    if (msg.t === "scene:preview") previewListeners.forEach((l) => l(msg.path, msg.hash, msg.edit, { session: msg.session, seq: msg.seq }));
    if (msg.t === "build" && msg.build && ownBuild && msg.build !== ownBuild) location.reload();
    if (msg.t === "library:changed") {
      queryClient.invalidateQueries({ queryKey: ["library"] });
      if (heard) heard = { ...heard, seq: msg.seq };
    }
  };
}
if (typeof window !== "undefined") connect();

/**
 * The part of live state a component uses, e.g. `useLive((l) => l.state?.onAir)`: it re-renders only
 * when that part changes, not for every state message (warnings, OBS, the agent) or file change.
 */
export function useLive<S>(selector: (live: Live) => S, isEqual?: (a: S, b: S) => boolean): S {
  return useStore(store, selector, isEqual);
}

/**
 * URL for a library file that changes whenever the file (or the shared theme) changes.
 * `preview` paints the ground and labels slots; `edit` serves it with data-vs element ids.
 */
/** `bridge`: with the bridge the program page talks to the sandboxed scene through. */
export function sceneUrl(path: string, versions: Record<string, number>, preview = false, edit = false, bridge = false) {
  const v = `${versions[path] ?? 0}.${versions["*"] ?? 0}`;
  return `${libraryUrl(path)}?${edit ? "edit&" : ""}${bridge ? "bridge&" : ""}${preview ? "preview&" : ""}v=${v}`;
}

/** /library/<path> with each segment encoded, so a "#", "?" or "%" in a file name survives. */
export function libraryUrl(path: string) {
  return `/library/${path.split("/").map(encodeURIComponent).join("/")}`;
}
