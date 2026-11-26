// One WebSocket to the server: live state (on air, OBS, warnings) and file-change versions.
import { libraryUrl, parseLibraryPath } from "@viewswitcher/shared";
import type { LiveState, SceneEdit, ServerMessage } from "@viewswitcher/shared";
import { QueryClient } from "@tanstack/react-query";
import { useRef, useSyncExternalStore } from "react";
import { clientKind, connectorUrl } from "./client-kind";

export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } });

export type Live = {
  connected: boolean;
  state: LiveState | null;
  /**
   * Bumped per library path when its file changes; per shared folder (sharedRootOf) and per org
   * (`<org>/*`) when a file in one of its _shared/ folders changes; `*` when every file may have.
   */
  versions: Record<string, number>;
  /** Each changed view's hash as the server last read it (an editor's version); none when it couldn't say. */
  hashes: Record<string, string>;
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

const store = createStore<Live>({ connected: false, state: null, versions: {}, hashes: {} });

type LiveEditListener = (path: string, hash: string, edit: SceneEdit, order: { session: string; seq: number }) => void;
const liveEditListeners = new Set<LiveEditListener>();
/** Live changes from the scene editor (never saved): the program page applies them to the on-air scene. */
export function onLiveEdit(listener: LiveEditListener) {
  liveEditListeners.add(listener);
  return () => void liveEditListeners.delete(listener);
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

/**
 * The shared folder a library path is in or names, as its version key: `<org>/templates/_shared`
 * (the org's theme, scripts and transition) or `<org>/templates/<set>/_shared` (a template set's);
 * null for anything else.
 */
export function sharedRootOf(path: string): string | null {
  // A set's folder never starts with "_" (isListedFolder), so templates/_shared/_shared/… is the org's.
  const m = /^([^/]+)\/templates\/(?:([^/_][^/]*)\/)?_shared(?:\/|$)/.exec(path);
  if (!m) return null;
  return m[2] ? `${m[1]}/templates/${m[2]}/_shared` : `${m[1]}/templates/_shared`;
}

/** Bumped by a change in any of an org's shared folders. */
const anyShared = (org: string) => `${org}/*`;

/**
 * The shared versions a view's page depends on. The org's own templates use the org's _shared/; a
 * set's views (and its transition) their set's, and they may link the org's too. A project's or a
 * stream's view may have come from any template, set or not, so any shared change in its org counts.
 * Cheap enough for every tile on every change: a path is read, not the page.
 */
export function sharedFor(path: string): string[] {
  const p = parseLibraryPath(path);
  const org = `${p.org}/templates/_shared`;
  if ((p.kind === "template" || p.kind === "transition" || p.kind === "shared") && p.rest.startsWith("templates/")) return p.set ? [`${p.org}/templates/${p.set}/_shared`, org] : [org];
  return [anyShared(p.org)];
}

/** Live state after a state message or a library change from the socket. */
export function nextLive(live: Live, msg: Extract<ServerMessage, { t: "state" | "library:changed" }>): Live {
  if (msg.t === "state") return { ...live, state: keepUnchanged(live.state, msg.state) };
  const versions = { ...live.versions };
  const hashes = { ...live.hashes };
  const bump = (k: string) => (versions[k] = (versions[k] ?? 0) + 1);
  for (const p of msg.paths) {
    bump(p);
    // A hash the server didn't send now would be an older version's: forget it.
    if (msg.hashes?.[p]) hashes[p] = msg.hashes[p];
    else delete hashes[p];
    // A shared folder: the views that use it reload (sharedFor), not every view in every org.
    const root = sharedRootOf(p);
    if (root) {
      bump(root);
      bump(anyShared(parseLibraryPath(p).org));
    }
  }
  return { ...live, versions, hashes };
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
    if (msg.t === "scene:liveEdit") liveEditListeners.forEach((l) => l(msg.path, msg.hash, msg.edit, { session: msg.session, seq: msg.seq }));
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
 * URL for a library file that changes whenever the file (or a shared folder it may use, sharedFor) changes. `cover` paints
 * the ground and labels the camera boxes, for tiles and covers: on the wire that's ?preview, the name
 * every scene.js (each library's, each pack's) reads, so it stays. `edit` serves it with data-vs
 * element ids; `bridge` adds the bridge the program page talks to the sandboxed view through.
 */
export function sceneUrl(path: string, versions: Record<string, number>, cover = false, edit = false, bridge = false) {
  // Counters only go up, so their sum changes whenever one of them does.
  const shared = sharedFor(path).reduce((n, k) => n + (versions[k] ?? 0), 0);
  const v = `${versions[path] ?? 0}.${versions["*"] ?? 0}.${shared}`;
  return `${libraryUrl(path)}?${edit ? "edit&" : ""}${bridge ? "bridge&" : ""}${cover ? "preview&" : ""}v=${v}`;
}

