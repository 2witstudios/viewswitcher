// One WebSocket to the server: live state (on air, OBS, warnings) and file-change versions.
import type { LiveState, ServerMessage } from "@daisy/shared";
import { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } });

type Live = {
  connected: boolean;
  state: LiveState | null;
  /** Bumped per library path when its file changes; `*` bumps for shared theme changes. */
  versions: Record<string, number>;
};

let live: Live = { connected: false, state: null, versions: {} };
const listeners = new Set<() => void>();
const set = (patch: Partial<Live>) => {
  live = { ...live, ...patch };
  listeners.forEach((l) => l());
};

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => set({ connected: true });
  ws.onclose = () => {
    set({ connected: false });
    setTimeout(connect, 1000);
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data) as ServerMessage;
    if (msg.t === "state") set({ state: msg.state });
    if (msg.t === "library:changed") {
      const versions = { ...live.versions };
      for (const p of msg.paths) {
        versions[p] = (versions[p] ?? 0) + 1;
        if (p.startsWith("templates/_shared")) versions["*"] = (versions["*"] ?? 0) + 1;
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

/** URL for a library file that changes whenever the file (or the shared theme) changes. */
export function sceneUrl(path: string, versions: Record<string, number>, preview = false) {
  const v = `${versions[path] ?? 0}.${versions["*"] ?? 0}`;
  return `/library/${path}?${preview ? "preview&" : ""}v=${v}`;
}
