// Presses on the scene: a tap selects, a second tap on text types in it, a long-press or right-click
// opens the menu, and a press that moves drags the box under it (or resizes the selected box from a
// corner handle). Each drag or resize shows live as it goes and saves once, when it's let go.
import { isSlot, movableIn } from "@viewswitcher/shared";
import type { Box, SceneBase, SceneEdit } from "@viewswitcher/shared";
import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject, useRef } from "react";
import type { Hit } from "./frame-dom";
import { type Corner, dragTo, type DragStart, type Pos, resizeEdit, type ResizeStart, resizeTo, samePos, sameSize, type Size } from "./geometry";
import { canStart } from "./mode";
import type { ModeStore } from "./useMode";
import type { UndoEntry } from "./useUndo";

const LONG_PRESS_MS = 550;
const DOUBLE_TAP_MS = 350;
const DRAG_START_PX = 6; // screen px before a press becomes a drag
const SNAP_PX = 7; // screen px

/** A press on the scene, from pointerdown to pointerup: a tap, a long-press, or (once it moves) a drag or resize. */
export type Gesture = {
  pointerId: number; cx: number; cy: number; hit: Hit; moved: boolean; long: boolean; timer?: ReturnType<typeof setTimeout>;
  drag?: DragStart & { id: number; last: Pos; gen: number };
  resize?: ResizeStart & { id: number; last: Pos & Size; gen: number };
};
type Point = { clientX: number; clientY: number };

export function useGestures(opts: {
  mode: ModeStore;
  overlay: RefObject<HTMLDivElement | null>;
  ready: boolean;
  selected: number | null;
  scale: () => number;
  base: () => SceneBase | null;
  generation: () => number;
  toScene: (e: Point) => { x: number; y: number };
  hit: (x: number, y: number) => Hit;
  node: (id: number) => HTMLElement | null;
  rectOf: (id: number) => Box | null;
  posNow: (id: number) => Pos | null;
  sizeNow: (id: number) => Size | null;
  applyDom: (edit: SceneEdit) => void;
  liveEdit: (edit: SceneEdit, gen?: number) => void;
  save: (edits: SceneEdit[], undo: UndoEntry[], madeIn: number) => void;
  flushNudge: () => void;
  startEdit: (id: number) => void;
  select: (id: number | null) => void;
  setHover: (id: number | null) => void;
  closeMenu: () => void;
  openMenu: (cx: number, cy: number, h: Hit, longPress?: boolean) => void;
}) {
  const o = useRef(opts);
  o.current = opts;
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ t: number; cx: number; cy: number; leaf: number | null } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const { mode, selected } = o.current;
    if (!canStart(mode.now()) || !o.current.ready || e.button > 0) return;
    o.current.closeMenu();
    const p = o.current.toScene(e);
    const overlay = o.current.overlay.current!;
    // A corner handle of the selected box: resize it.
    const corner = (e.target as HTMLElement).closest?.("[data-corner]")?.getAttribute("data-corner") as Corner | null;
    const b = o.current.base();
    if (corner && selected !== null && b) {
      const pos = o.current.posNow(selected), size = o.current.sizeNow(selected);
      if (pos && size) {
        e.preventDefault();
        o.current.flushNudge();
        overlay.setPointerCapture(e.pointerId);
        const start = { ...pos, ...size };
        gesture.current = {
          pointerId: e.pointerId, cx: e.clientX, cy: e.clientY, hit: { leaf: null, move: selected, image: null }, moved: true, long: false,
          resize: { id: selected, corner, start, x0: p.x, y0: p.y, last: start, slot: isSlot(b, selected), gen: o.current.generation() },
        };
        mode.dispatch({ t: "resize", id: selected, ...size });
        return;
      }
    }
    const h = o.current.hit(p.x, p.y);
    overlay.setPointerCapture(e.pointerId);
    const g: Gesture = { pointerId: e.pointerId, cx: e.clientX, cy: e.clientY, hit: h, moved: false, long: false };
    if (h.leaf !== null || h.move !== null) {
      g.timer = setTimeout(() => {
        g.long = true;
        o.current.openMenu(g.cx, g.cy, h, true);
      }, LONG_PRESS_MS);
    }
    gesture.current = g;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const { mode } = o.current;
    const g = gesture.current;
    if (g?.resize && g.pointerId === e.pointerId) {
      const r = g.resize;
      const next = resizeTo(r, o.current.toScene(e), e.shiftKey);
      if (samePos(next, r.last) && sameSize(next, r.last)) return;
      r.last = next;
      const edit = resizeEdit(r.id, r.corner, next);
      o.current.applyDom(edit);
      o.current.liveEdit(edit, r.gen);
      mode.dispatch({ t: "resize", id: r.id, width: next.width, height: next.height });
      return;
    }
    if (!g || g.pointerId !== e.pointerId) {
      if (e.pointerType === "mouse" && canStart(mode.now()) && o.current.ready) {
        const p = o.current.toScene(e);
        o.current.setHover(o.current.hit(p.x, p.y).leaf);
      }
      return;
    }
    if (!g.moved && Math.hypot(e.clientX - g.cx, e.clientY - g.cy) < DRAG_START_PX) return;
    if (!g.moved) {
      g.moved = true;
      clearTimeout(g.timer);
      const id = g.hit.move;
      const b = o.current.base();
      if (id === null || g.long || !b) return;
      const self = o.current.node(id);
      const start = o.current.posNow(id);
      const rect = o.current.rectOf(id);
      if (!self || !start || !rect) return;
      // Snap to every other movable box that isn't this one, inside it, or around it.
      const others = b.els.filter((x) => x.id !== id && movableIn(b, x.id)).flatMap((x) => {
        const n = o.current.node(x.id);
        if (!n || n.contains(self) || self.contains(n)) return [];
        const r = o.current.rectOf(x.id);
        return r ? [r] : [];
      });
      const p = o.current.toScene({ clientX: g.cx, clientY: g.cy });
      o.current.flushNudge();
      if (mode.dispatch({ t: "drag", id, ...start, guides: { x: [], y: [] } }).kind !== "dragging") return;
      g.drag = { id, start, rect, others, x0: p.x, y0: p.y, last: start, gen: o.current.generation() };
      o.current.select(id);
      o.current.setHover(null);
    }
    const d = g.drag;
    if (!d) return;
    const next = dragTo(d, o.current.toScene(e), SNAP_PX / o.current.scale());
    if (samePos(next, d.last)) return;
    d.last = { left: next.left, top: next.top };
    o.current.applyDom({ id: d.id, ...d.last });
    o.current.liveEdit({ id: d.id, ...d.last }, d.gen);
    mode.dispatch({ t: "drag", id: d.id, ...next });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const { mode, save } = o.current;
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    clearTimeout(g.timer);
    if (g.resize) {
      const { id, start, last, gen, corner } = g.resize;
      mode.dispatch({ t: "end", kind: "resizing" });
      if (!sameSize(last, start)) save([resizeEdit(id, corner, last)], [{ before: resizeEdit(id, corner, start), after: resizeEdit(id, corner, last) }], gen);
      return;
    }
    if (g.drag) {
      const { id, start, last, gen } = g.drag;
      mode.dispatch({ t: "end", kind: "dragging" });
      if (!samePos(last, start)) save([{ id, ...last }], [{ before: { id, ...start }, after: { id, ...last } }], gen);
      return;
    }
    if (g.moved || g.long) return;
    // A tap: a second one on the same text edits it; otherwise select what's under it.
    const t = lastTap.current;
    const now = performance.now();
    if (t && now - t.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - t.cx, e.clientY - t.cy) < 30 && g.hit.leaf !== null && t.leaf === g.hit.leaf) {
      lastTap.current = null;
      o.current.startEdit(g.hit.leaf);
      return;
    }
    lastTap.current = { t: now, cx: e.clientX, cy: e.clientY, leaf: g.hit.leaf };
    o.current.select(g.hit.move);
  };

  /** The press was taken away (a system gesture, the pointer lost): put the box back where it was. */
  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    const { mode, applyDom, liveEdit } = o.current;
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    clearTimeout(g.timer);
    if (g.resize) {
      const { id, start, gen } = g.resize;
      applyDom({ id, ...start });
      liveEdit({ id, ...start }, gen);
      mode.dispatch({ t: "end", kind: "resizing" });
      return;
    }
    if (g.drag) {
      applyDom({ id: g.drag.id, ...g.drag.start });
      liveEdit({ id: g.drag.id, ...g.drag.start }, g.drag.gen);
      mode.dispatch({ t: "end", kind: "dragging" });
    }
  };

  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!canStart(o.current.mode.now())) return;
    const g = gesture.current;
    if (g) clearTimeout(g.timer);
    if (g) g.long = true;
    const p = o.current.toScene(e);
    o.current.openMenu(e.clientX, e.clientY, o.current.hit(p.x, p.y));
  };

  /** A new version loaded: a press on the old one is over. */
  const drop = () => {
    clearTimeout(gesture.current?.timer);
    gesture.current = null;
  };

  return { gesture, drop, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onContextMenu } };
}
