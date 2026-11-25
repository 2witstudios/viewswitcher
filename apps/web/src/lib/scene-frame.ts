// Scene frames (EDIT-26). Every frame that shows a scene is sandboxed so it gets an opaque origin:
// the scene's scripts run, but as no site, so they can't call the switcher's API, open its socket,
// or reach into this page (the server serves library pages with the same sandbox as a CSP too;
// apps/server/src/scene-sandbox.ts). The scene editor's frame is the one exception: it needs the
// scene's DOM, so it's same-origin, and loads the scene with ?inert, which the server serves with
// `script-src 'none'`: none of the scene's code runs there.
import type { Slot } from "@viewswitcher/shared";

/** Covers, the program page, transitions: the scene's own scripts run; nothing else is allowed. */
export const SCENE_SANDBOX = "allow-scripts";
/**
 * The scene editor: same-origin so it can edit the DOM in place. allow-scripts only because WebKit
 * (the iPad, the Mac app) won't run the editor's own listeners in the frame without it; the scene's
 * own code is blocked by the ?inert response's CSP (script-src 'none'). Only ever with ?inert.
 */
export const EDITOR_SANDBOX = "allow-same-origin allow-scripts";

/** What a scene's bridge says about itself (apps/server/src/scene-bridge.ts). */
export type FrameState = { id: number; slots: Slot[]; version: string | null; hold: string | null };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 100_000 ? v : null);

/** Slots from a frame, which may say anything: at most 32, each a name and four finite numbers. */
export function cleanSlots(raw: unknown): Slot[] {
  if (!Array.isArray(raw)) return [];
  const out: Slot[] = [];
  for (const s of raw.slice(0, 32)) {
    const source = typeof s?.source === "string" ? s.source.slice(0, 80) : "";
    const [x, y, w, h] = [num(s?.x), num(s?.y), num(s?.w), num(s?.h)];
    if (source && x !== null && y !== null && w !== null && h !== null) out.push({ source, x, y, w, h });
  }
  return out;
}

/** A frame:state message, checked; null for anything else. */
export function frameState(data: unknown): FrameState | null {
  const d = data as Record<string, unknown> | null;
  if (!d || typeof d !== "object" || d.viewswitcher !== "frame:state" || typeof d.id !== "number") return null;
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 100) : null);
  return { id: d.id, slots: cleanSlots(d.slots), version: str(d.version), hold: str(d.hold) };
}
