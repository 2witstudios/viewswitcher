// Snapping for dragging a box in the scene editor: to the edges and centers of other boxes and
// the 1920×1080 frame, else to an 8 px grid.

export type Box = { x: number; y: number; w: number; h: number };
export type Snapped = { x: number; y: number; guides: { x: number[]; y: number[] } };

export const SCENE = { width: 1920, height: 1080 };

/** Where a box dragged to (x, y) lands. `threshold` is in scene px. */
export function snapMove(box: Box, others: Box[], { grid = 8, threshold = 8 }: { grid?: number; threshold?: number } = {}): Snapped {
  const frame: Box = { x: 0, y: 0, w: SCENE.width, h: SCENE.height };
  const targets = [frame, ...others];
  const axis = (pos: number, size: number, lines: number[]) => {
    // The box's own edges and center, against every line; the closest within the threshold wins.
    let best: { delta: number; line: number } | null = null;
    for (const offset of [0, size / 2, size]) {
      for (const line of lines) {
        const delta = line - (pos + offset);
        if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, line };
      }
    }
    if (!best) return { pos: Math.round(pos / grid) * grid, guides: [] as number[] };
    const snapped = pos + best.delta;
    // Every line the snapped box now touches gets a guide.
    const guides = [...new Set(lines.filter((l) => [0, size / 2, size].some((o) => Math.abs(snapped + o - l) < 0.5)))];
    return { pos: snapped, guides };
  };
  const xs = targets.flatMap((t) => [t.x, t.x + t.w / 2, t.x + t.w]);
  const ys = targets.flatMap((t) => [t.y, t.y + t.h / 2, t.y + t.h]);
  const x = axis(box.x, box.w, xs);
  const y = axis(box.y, box.h, ys);
  return { x: x.pos, y: y.pos, guides: { x: x.guides, y: y.guides } };
}
