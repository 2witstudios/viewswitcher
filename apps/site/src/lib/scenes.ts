import type { ImageMetadata } from "astro";
import data from "../data/scenes.json";
import { SCENES, type SceneSpec } from "../data/scene-list";

export type Slot = { name: string; x: number; y: number; w: number; h: number; round: boolean };
export type Scene = SceneSpec & { image: ImageMetadata; slots: Slot[] };

const images = import.meta.glob<{ default: ImageMetadata }>("../assets/scenes/*.webp", { eager: true });

export function scene(id: string): Scene {
  const spec = SCENES.find((s) => s.id === id);
  const image = images[`../assets/scenes/${id}.webp`]?.default;
  const slots = (data as Record<string, { slots: Slot[] }>)[id]?.slots;
  if (!spec || !image || !slots) throw new Error(`scene "${id}" is missing; run bun run shots`);
  return { ...spec, image, slots };
}

/** A slot's box as percentages of the 1920×1080 frame, for absolutely positioned stand-ins. */
export const box = (s: Pick<Slot, "x" | "y" | "w" | "h">) => ({
  left: `${(s.x / 1920) * 100}%`, top: `${(s.y / 1080) * 100}%`,
  width: `${(s.w / 1920) * 100}%`, height: `${(s.h / 1080) * 100}%`,
});
