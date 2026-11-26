// Retyping text in place: the element becomes editable in the frame, each keystroke shows live,
// Return or a press outside saves, Esc puts the text back. The typing itself is the `typing` mode.
import { collapseHtmlSpace } from "@viewswitcher/shared";
import type { SceneEdit } from "@viewswitcher/shared";
import { useEffect, useRef } from "react";
import { toast } from "../ui";
import { beginTyping, endTyping, listenWhileTyping, setShownText } from "./frame-dom";
import { canStart } from "./mode";
import type { ModeStore } from "./useMode";
import type { UndoEntry } from "./useUndo";

export function useTextEditing(opts: {
  mode: ModeStore;
  frame: () => Document | null;
  generation: () => number;
  /** Whether a version is open (typing needs one to save against). */
  open: () => boolean;
  liveEdit: (edit: SceneEdit, gen?: number) => void;
  save: (edits: SceneEdit[], undo: UndoEntry[], madeIn: number) => void;
  redraw: () => void;
  /** Typing starts: menus, selection and hover go. */
  onStart: () => void;
}) {
  const o = useRef(opts);
  o.current = opts;
  const { mode } = opts.mode;
  const typing = mode.kind === "typing" ? mode : null;

  const start = (id: number) => {
    const { mode, frame, generation, onStart } = o.current;
    if (!canStart(mode.now())) return;
    const original = beginTyping(frame(), id);
    if (original === null) return;
    onStart();
    mode.dispatch({ t: "type", id, original, gen: generation() });
  };

  /** Save what was typed (`commit`), or put the text back. Nothing when nobody is typing. */
  const finish = (commit: boolean) => {
    const { mode, frame, liveEdit, save, redraw } = o.current;
    const m = mode.now();
    if (m.kind !== "typing") return;
    // Finished: leaving now mustn't put the old text back on air.
    mode.dispatch({ t: "end", kind: "typing" });
    const d = frame();
    const typed = endTyping(d, m.id);
    if (typed === null || !o.current.open()) return;
    // Collapse only HTML whitespace, as the server does: a non-breaking space is part of the text.
    // Browsers type a space at the start or end of editable text as U+00A0. That's typing, not text:
    // drop it at an edge unless the original had one there.
    const original = collapseHtmlSpace(m.original);
    let text = collapseHtmlSpace(typed);
    if (!original.startsWith(" ")) text = text.replace(/^ +/, "");
    if (!original.endsWith(" ")) text = text.replace(/ +$/, "");
    text = collapseHtmlSpace(text);
    if (!commit || !text.trim()) {
      if (commit && !text.trim()) toast("Text can't be empty: put back what was there");
      setShownText(d, m.id, m.original);
      liveEdit({ id: m.id, text: m.original }, m.gen);
    } else if (text === original) {
      setShownText(d, m.id, m.original);
    } else {
      setShownText(d, m.id, text);
      save([{ id: m.id, text }], [{ before: { id: m.id, text: original }, after: { id: m.id, text } }], m.gen);
    }
    redraw();
  };

  useEffect(() => {
    if (!typing) return;
    const { id, gen } = typing;
    return listenWhileTyping(o.current.frame(), id, {
      input: (text) => {
        o.current.liveEdit({ id, text }, gen);
        o.current.redraw();
      },
      // `finish` reads everything through `o`, so this render's copy is as good as the next one's.
      enter: () => finish(true),
      escape: () => finish(false),
      outside: () => finish(true),
    });
  }, [typing?.id, typing?.gen]);

  return { typing, start, finish };
}
