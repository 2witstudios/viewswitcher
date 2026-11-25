// The editor's mode (mode.ts) as React state: the store applies each event at once, and every new
// mode renders.
import { useRef, useState } from "react";
import { createModeStore, IDLE, type Mode } from "./mode";

export type ModeStore = ReturnType<typeof createModeStore> & { mode: Mode };

export function useMode(): ModeStore {
  const [mode, setMode] = useState<Mode>(IDLE);
  const store = useRef<ReturnType<typeof createModeStore> | null>(null);
  store.current ??= createModeStore(setMode);
  return { mode, ...store.current };
}
