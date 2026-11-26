// What the scene editor's Add menu puts in a scene: one element, in the middle, using the classes
// every org's theme defines (abs, panel, display, muted, slot), so it picks up the org's look.
import { escapeHtml } from "./html-scan";
import { SCENE } from "./snap";

export type AddKind = "text" | "title" | "image" | "camera" | "screen" | "guest";

/** Device boxes and the OBS source each one asks for. */
export const DEVICE_SLOTS: Partial<Record<AddKind, string>> = { camera: "Camera", screen: "Screen", guest: "Guest" };


/** A box of `w`×`h` in the middle of the scene, or centred on `at` and kept inside the scene. */
const middle = (w: number, h: number, at?: { x: number; y: number }) => {
  if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return { left: Math.round((SCENE.width - w) / 2), top: Math.round((SCENE.height - h) / 2), w, h };
  const clamp = (v: number, size: number, room: number) => Math.round(Math.max(0, Math.min(room - size, v - size / 2)));
  return { left: clamp(at.x, w, SCENE.width), top: clamp(at.y, h, SCENE.height), w, h };
};
const box = (b: { left: number; top: number; w: number; h: number }) => `left: ${b.left}px; top: ${b.top}px; width: ${b.w}px; height: ${b.h}px`;

/** A slot name not used in the scene yet: "Camera", then "Camera 2", "Camera 3"… */
export function freeSlotName(base: string, used: string[]): string {
  if (!used.includes(base)) return base;
  let n = 2;
  while (used.includes(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/**
 * The markup for a new element of `kind`. `slots` are the scene's slot names (so a second camera box
 * asks for "Camera 2"); `image` is the picture for an image (its natural size keeps its shape).
 * `at`: where it was dropped (EDIT-22), in scene pixels: it's centred there, inside the scene, and a
 * picture smaller than the 600 px box keeps its own size instead of being blown up.
 */
export function markupFor(kind: AddKind, opts: { slots?: string[]; image?: { src: string; width?: number; height?: number }; at?: { x: number; y: number } } = {}): string {
  switch (kind) {
    case "text":
      return `<p class="abs display" style="${box(middle(720, 96))}; margin: 0; font-size: 72px; line-height: 1.15">New text</p>`;
    case "title":
      return (
        `<div class="abs panel" style="${box(middle(800, 150))}; box-sizing: border-box; padding: 0 40px; display: flex; flex-direction: column; justify-content: center; gap: 12px">` +
        `<h2 class="display" style="font-size: 56px; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">Name</h2>` +
        `<p class="muted" style="margin: 0; font-size: 26px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">Title or topic</p>` +
        `</div>`
      );
    case "image": {
      const src = opts.image?.src;
      if (!src) throw new Error("An image needs a picture");
      const nw = opts.image?.width || 1, nh = opts.image?.height || 1;
      // Fit inside 600×600, keeping its shape (a dropped picture is never made bigger than it is).
      const k = Math.min(600 / nw, 600 / nh, opts.at && nw > 1 && nh > 1 ? 1 : Infinity);
      const w = Math.max(16, Math.round(nw * k)), h = Math.max(16, Math.round(nh * k));
      return `<img class="abs" src="${escapeHtml(src)}" alt="" style="${box(middle(w, h, opts.at))}; object-fit: contain">`;
    }
    case "camera":
    case "guest":
    case "screen": {
      const name = freeSlotName(DEVICE_SLOTS[kind]!, opts.slots ?? []);
      const b = kind === "screen" ? middle(1280, 720) : middle(640, 360);
      return `<div class="slot" data-slot="${escapeHtml(name)}" style="${box(b)}"></div>`;
    }
  }
}
