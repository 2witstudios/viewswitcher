// Dragging, resizing and nudging boxes, in scene pixels (1920×1080). Pure, so every rule here is
// tested without a browser: the 8 px grid, snapping to other boxes, 16:9 device boxes, the corners.
import { SCENE, snapMove } from "@viewswitcher/shared";
import type { Box, SizeEdit } from "@viewswitcher/shared";

export const SCENE_W = SCENE.width;
export const SCENE_H = SCENE.height;
export const MIN_SIZE = 24;
const GRID = 8;

export type Pos = { left: number; top: number };
export type Size = { width: number; height: number };
export type Corner = "nw" | "ne" | "sw" | "se";
export const CORNERS: readonly Corner[] = ["nw", "ne", "sw", "se"];

/** Which edges a corner moves: a west corner moves the left edge, a north one the top. */
export const sidesOf = (corner: Corner) => ({ west: corner === "nw" || corner === "sw", north: corner === "nw" || corner === "ne" });

/** A box in scene pixels as CSS on the stage, which shows the scene at `scale`. */
export const onStage = (b: Box, scale: number) => ({ left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale });

/** A corner handle's point on a box's screen rect (before scaling). */
export const cornerPoint = (rect: Box, corner: Corner) => ({ x: rect.x + (corner[1] === "e" ? rect.w : 0), y: rect.y + (corner[0] === "s" ? rect.h : 0) });

/** A drag that has started: the box's position and screen rect then, the boxes it snaps to, and where the pointer was. */
export type DragStart = { start: Pos; rect: Box; others: Box[]; x0: number; y0: number };

/**
 * Where a dragged box goes with the pointer at scene point `p`. Snapped to another box's edge it's
 * exact; otherwise left and top go on the 8 px grid themselves (the box's screen position can be
 * offset by its parent or margins, so the grid is the saved value's, not the screen's).
 */
export function dragTo(d: DragStart, p: { x: number; y: number }, threshold: number): Pos & { guides: { x: number[]; y: number[] } } {
  const s = snapMove({ ...d.rect, x: d.rect.x + p.x - d.x0, y: d.rect.y + p.y - d.y0 }, d.others, { threshold });
  const grid = (v: number, snapped: boolean) => (snapped ? Math.round(v) : Math.round(v / GRID) * GRID);
  return {
    left: grid(d.start.left + s.x - d.rect.x, s.guides.x.length > 0),
    top: grid(d.start.top + s.y - d.rect.y, s.guides.y.length > 0),
    guides: s.guides,
  };
}

export type ResizeStart = { corner: Corner; start: Pos & Size; x0: number; y0: number; /** A device box: keeps 16:9. */ slot: boolean };

/**
 * A box resized from one corner with the pointer at scene point `p`. The opposite corner stays put.
 * Device boxes keep 16:9 (the camera's own shape) unless `free` (Shift); sizes go on the grid.
 */
export function resizeTo(r: ResizeStart, p: { x: number; y: number }, free: boolean): Pos & Size {
  const dx = p.x - r.x0, dy = p.y - r.y0;
  const { west, north } = sidesOf(r.corner);
  let w = r.start.width + (west ? -dx : dx);
  let h = r.start.height + (north ? -dy : dy);
  if (r.slot && !free) {
    w = Math.max(MIN_SIZE * 16 / 9, Math.abs(dx) * 9 >= Math.abs(dy) * 16 ? w : h * 16 / 9);
    w = Math.round(w / 16) * 16;
    h = (w * 9) / 16;
  } else {
    w = Math.max(MIN_SIZE, Math.round(w / GRID) * GRID);
    h = Math.max(MIN_SIZE, Math.round(h / GRID) * GRID);
  }
  const width = Math.round(w), height = Math.round(h);
  return {
    width, height,
    left: west ? r.start.left + r.start.width - width : r.start.left,
    top: north ? r.start.top + r.start.height - height : r.start.top,
  };
}

/** The edit for a box at `v` resized from `corner`: left and top only where that corner moves them. */
export function resizeEdit(id: number, corner: Corner, v: Pos & Size): SizeEdit {
  const { west, north } = sidesOf(corner);
  return { id, width: v.width, height: v.height, ...(west ? { left: v.left } : {}), ...(north ? { top: v.top } : {}) };
}

/** A size typed in the position bar: whole pixels, never below the smallest box. */
export const clampSize = (width: number, height: number): Size => ({ width: Math.max(MIN_SIZE, Math.round(width)), height: Math.max(MIN_SIZE, Math.round(height)) });

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
/** An arrow key's step: 1 px, or 10 with Shift. Null for any other key. */
export function nudge(pos: Pos, key: string, shift: boolean): Pos | null {
  const dir = ARROWS[key];
  if (!dir) return null;
  const step = shift ? 10 : 1;
  return { left: pos.left + dir[0] * step, top: pos.top + dir[1] * step };
}
export const isArrow = (key: string) => key in ARROWS;

export const samePos = (a: Pos, b: Pos) => a.left === b.left && a.top === b.top;
export const sameSize = (a: Size, b: Size) => a.width === b.width && a.height === b.height;
