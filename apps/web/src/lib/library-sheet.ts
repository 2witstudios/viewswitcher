// Whether the library (orgs, projects, streams) is open on a phone. Upright it
// unfolds under the top bar, sideways it slides in over the deck. Its own button and the page title
// (the stream picker) both open it, so the state lives here rather than in the sidebar.
import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

export function setLibraryOpen(next: boolean) {
  if (next === open) return;
  open = next;
  listeners.forEach((l) => l());
}

export function useLibraryOpen(): boolean {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => open,
    () => false,
  );
}
