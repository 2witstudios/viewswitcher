// Arrow keys move the selected box 1 px (10 with Shift), live as they go. The moves of one box are
// saved together, half a second after the keys stop, or sooner when anything else happens first.
import type { MoveEdit, SceneEdit } from "@viewswitcher/shared";
import { useRef } from "react";
import { nudge as nudged, type Pos, samePos } from "./geometry";
import type { UndoEntry } from "./useUndo";

const NUDGE_SAVE_MS = 500;

type Nudge = { id: number; before: MoveEdit; last: Pos; gen: number; timer?: ReturnType<typeof setTimeout> };

export function useNudge(opts: {
  generation: () => number;
  posNow: (id: number) => Pos | null;
  applyDom: (edit: SceneEdit) => void;
  liveEdit: (edit: SceneEdit, gen?: number) => void;
  save: (edits: SceneEdit[], undo: UndoEntry[], madeIn: number) => void;
}) {
  const o = useRef(opts);
  o.current = opts;
  const nudge = useRef<Nudge | null>(null);

  /** Save the moves so far. A change made next saves after them, so it can't be overwritten by them. */
  const flush = () => {
    const n = nudge.current;
    if (!n) return;
    clearTimeout(n.timer);
    nudge.current = null;
    if (samePos(n.last, n.before)) return;
    o.current.save([{ id: n.id, ...n.last }], [{ before: n.before, after: { id: n.id, ...n.last } }], n.gen);
  };

  /** Drop moves not saved yet and put the box (and the stream) back: Undo, or Edit a copy on the way out. */
  const cancel = () => {
    const n = nudge.current;
    if (!n) return false;
    clearTimeout(n.timer);
    nudge.current = null;
    o.current.applyDom(n.before);
    o.current.liveEdit(n.before, n.gen);
    return true;
  };

  /** A new version loaded: the moves named the old one's ids, so they're gone with it. */
  const drop = () => {
    clearTimeout(nudge.current?.timer);
    nudge.current = null;
  };

  /** One arrow-key step of box `id`. */
  const step = (id: number, key: string, shift: boolean) => {
    const now = o.current.posNow(id);
    const next = now && nudged(now, key, shift);
    if (!now || !next) return;
    if (!nudge.current || nudge.current.id !== id) {
      flush();
      nudge.current = { id, before: { id, ...now }, last: now, gen: o.current.generation() };
    }
    const n = nudge.current;
    o.current.applyDom({ id, ...next });
    o.current.liveEdit({ id, ...next }, n.gen);
    n.last = next;
    clearTimeout(n.timer);
    n.timer = setTimeout(flush, NUDGE_SAVE_MS);
  };

  return {
    step,
    flush,
    cancel,
    drop,
    /** Moves are waiting to save. */
    pending: () => nudge.current !== null,
    /** What puts the box back, while moves are waiting to save. */
    putBack: () => (nudge.current ? { edit: nudge.current.before, gen: nudge.current.gen } : null),
  };
}
