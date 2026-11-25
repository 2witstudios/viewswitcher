// The editor's mode as React state, with `now()` for the handlers that run between renders (a save
// landing, a timer): each event is applied at once, so the next guard already sees it.
import { useRef, useState } from "react";
import { IDLE, type Mode, type ModeEvent, reduce } from "./mode";

export type ModeStore = { mode: Mode; now: () => Mode; dispatch: (e: ModeEvent) => Mode };

export function useMode(): ModeStore {
  const [mode, setMode] = useState<Mode>(IDLE);
  const ref = useRef<Mode>(IDLE);
  const store = useRef<Omit<ModeStore, "mode"> | null>(null);
  if (!store.current) {
    store.current = {
      now: () => ref.current,
      dispatch: (e) => {
        const next = reduce(ref.current, e);
        if (next !== ref.current) {
          ref.current = next;
          setMode(next);
        }
        return next;
      },
    };
  }
  return { mode, ...store.current };
}
