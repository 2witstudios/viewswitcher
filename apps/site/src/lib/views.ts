import type { ImageMetadata } from "astro";
import data from "../data/views.json";
import { SHOWS, viewId, type Show, type ViewSpec } from "../data/shows";

export type Slot = { name: string; x: number; y: number; w: number; h: number; radius: string };
export type Media = { image: ImageMetadata; focus: string; alt: string };
export type View = ViewSpec & { id: string; show: Show; image: ImageMetadata; ground: string; slots: (Slot & { media: Media })[] };

const viewImages = import.meta.glob<{ default: ImageMetadata }>("../assets/views/*.webp", { eager: true });
const mediaImages = import.meta.glob<{ default: ImageMetadata }>("../assets/media/*.{jpg,webp}", { eager: true });

/** What fills the device boxes: photos (credited in CREDITS.md) and rendered screen shares. */
const MEDIA: Record<string, { focus: string; alt: string }> = {
  presenter: { focus: "50% 30%", alt: "a presenter smiling at the camera" },
  cohost: { focus: "30% 40%", alt: "a guest talking to the camera" },
  teacher: { focus: "62% 40%", alt: "a teacher talking to the camera" },
  painting: { focus: "50% 50%", alt: "a watercolor painting in progress, from above" },
  pastor: { focus: "52% 30%", alt: "a pastor preaching with a microphone" },
  host: { focus: "42% 30%", alt: "a podcast host at a microphone" },
  guest: { focus: "68% 35%", alt: "a podcast guest at a microphone" },
  "screen-design": { focus: "50% 50%", alt: "a design app on the screen share" },
  "screen-sermon": { focus: "50% 50%", alt: "a sermon slide on the screen share" },
};

export function media(name: string): Media {
  const image = (mediaImages[`../assets/media/${name}.jpg`] ?? mediaImages[`../assets/media/${name}.webp`])?.default;
  const m = MEDIA[name];
  if (!image || !m) throw new Error(`media "${name}" is missing`);
  return { image, ...m };
}

export function view(showId: string, file: string): View {
  const show = SHOWS.find((s) => s.id === showId);
  const spec = show?.views.find((v) => v.file === file);
  const id = viewId(showId, file);
  const image = viewImages[`../assets/views/${id}.webp`]?.default;
  const rec = (data as Record<string, { ground: string; slots: Slot[] }>)[id];
  if (!show || !spec || !image || !rec) throw new Error(`view "${id}" is missing; run bun run shots`);
  return { ...spec, id, show, image, ground: rec.ground, slots: rec.slots.map((s) => ({ ...s, media: media(spec.media![s.name]!) })) };
}

export const showViews = (showId: string) => SHOWS.find((s) => s.id === showId)!.views.map((v) => view(showId, v.file));

/** A box as percentages of the 1920×1080 frame. */
export const box = (s: Pick<Slot, "x" | "y" | "w" | "h">) => ({
  left: `${(s.x / 1920) * 100}%`, top: `${(s.y / 1080) * 100}%`,
  width: `${(s.w / 1920) * 100}%`, height: `${(s.h / 1080) * 100}%`,
});
/** A slot's corner radius, scaled with the frame (the frame is a size container). */
export const radius = (r: string) => (r.endsWith("px") ? `calc(${parseFloat(r)} / 1920 * 100cqw)` : r);
