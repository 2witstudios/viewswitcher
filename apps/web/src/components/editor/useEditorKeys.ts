// The editor's keys, read against the mode: Cmd-Z, Escape, Delete and the arrows act on a quiet
// scene; while something is under way only its own Escape does anything. Keys pressed in the frame
// (while typing) arrive here too.
import { useEffect, useRef } from "react";
import { modalOpen } from "../../lib/modal";
import { listenKeys } from "./frame-dom";
import { isArrow } from "./geometry";
import type { ModeStore } from "./useMode";

export function useEditorKeys(opts: {
  mode: ModeStore;
  frame: () => Document | null;
  /** The frame (re)loaded: its document gets the listener. */
  ready: boolean;
  frameKey: number;
  selected: number | null;
  undo: () => void;
  escape: () => void;
  remove: (id: number) => void;
  nudge: (id: number, key: string, shift: boolean) => void;
  cancelTyping: () => void;
  closePicker: () => void;
  closeDropChoice: () => void;
}) {
  const o = useRef(opts);
  o.current = opts;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = o.current;
      if (e.defaultPrevented) return; // already handled (e.g. Return/Esc in the text being typed)
      // Edit with AI (or another modal) is open over the editor: its keys are its own.
      if (modalOpen(document)) return;
      const undoKey = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z";
      switch (k.mode.now().kind) {
        case "saving-structure":
          // Element ids are about to change, so nothing may start on the old ones.
          if (isArrow(e.key) || e.key === "Delete" || e.key === "Backspace" || undoKey) e.preventDefault();
          return;
        // The picture picker or a drop's Replace / Add names an image by id: the scene stays as it is until it closes.
        case "picking":
          if (e.key === "Escape") k.closePicker();
          return;
        case "dropChoice":
          if (e.key === "Escape") k.closeDropChoice();
          return;
        case "typing":
          if (e.key === "Escape") k.cancelTyping();
          return;
        case "idle":
          break;
        default:
          return;
      }
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
      if (undoKey && !e.shiftKey) {
        e.preventDefault();
        k.undo();
        return;
      }
      if (e.key === "Escape") return k.escape();
      if (k.selected === null) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        k.remove(k.selected);
      } else if (isArrow(e.key)) {
        e.preventDefault();
        k.nudge(k.selected, e.key, e.shiftKey);
      }
    };
    window.addEventListener("keydown", onKey);
    const stop = listenKeys(opts.ready ? opts.frame() : null, onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      stop();
    };
  }, [opts.ready, opts.frameKey]);
}
