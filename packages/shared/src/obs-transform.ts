import type { Slot } from "./types";

/** Scene files are authored at this size; OBS may use another base canvas. */
export const SCENE_WIDTH = 1920;
export const SCENE_HEIGHT = 1080;

/** OBS alignment flags: left = 1, top = 4. */
const TOP_LEFT = 5;

export type ObsTransform = {
  positionX: number;
  positionY: number;
  scaleX: number;
  scaleY: number;
  cropLeft: number;
  cropRight: number;
  cropTop: number;
  cropBottom: number;
  alignment: number;
  rotation: number;
  boundsType: "OBS_BOUNDS_NONE";
  boundsWidth: number;
  boundsHeight: number;
};

/**
 * Fill a slot with a source like CSS `object-fit: cover`: scale until both sides cover,
 * then crop the overflow evenly (crop is in source pixels, applied before scale).
 */
export function coverTransform(
  slot: Slot,
  source: { width: number; height: number },
  canvas: { width: number; height: number } = { width: SCENE_WIDTH, height: SCENE_HEIGHT },
): ObsTransform {
  const kx = canvas.width / SCENE_WIDTH;
  const ky = canvas.height / SCENE_HEIGHT;
  const x = slot.x * kx, y = slot.y * ky, w = slot.w * kx, h = slot.h * ky;
  const sw = Math.max(1, source.width), sh = Math.max(1, source.height);
  const scale = Math.max(w / sw, h / sh);
  const cropX = Math.max(0, (sw - w / scale) / 2);
  const cropY = Math.max(0, (sh - h / scale) / 2);
  return {
    positionX: round(x),
    positionY: round(y),
    scaleX: scale,
    scaleY: scale,
    cropLeft: Math.floor(cropX),
    cropRight: Math.floor(cropX),
    cropTop: Math.floor(cropY),
    cropBottom: Math.floor(cropY),
    alignment: TOP_LEFT,
    rotation: 0,
    boundsType: "OBS_BOUNDS_NONE",
    boundsWidth: Math.max(1, round(w)),
    boundsHeight: Math.max(1, round(h)),
  };
}

const round = (v: number) => Math.round(v * 100) / 100;
