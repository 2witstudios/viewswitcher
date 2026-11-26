// The editor's Undo list, in the order changes were made. Each entry is the edit that puts a change
// back, and the change itself. Every reload clears it: its ids name elements of the old version.
import type { SceneEdit } from "@viewswitcher/shared";
import { useState } from "react";

export type UndoEntry = { before: SceneEdit; after: SceneEdit };

export function useUndo() {
  const [entries, setEntries] = useState<UndoEntry[]>([]);
  return {
    entries,
    last: entries[entries.length - 1] as UndoEntry | undefined,
    push: (more: UndoEntry[]) => more.length && setEntries((u) => [...u, ...more]),
    pop: () => setEntries((u) => u.slice(0, -1)),
    clear: () => setEntries([]),
  };
}
