import type { ImageMetadata } from "astro";
import data from "../data/views.json";
import { SHOWS, viewId, type Show, type ViewSpec } from "@viewswitcher/packs/shows";

export type Slot = { name: string; x: number; y: number; w: number; h: number; radius: string };
export type Media = { image: ImageMetadata; focus: string; alt: string };
export type View = ViewSpec & { id: string; show: Show; image: ImageMetadata; ground: string; slots: (Slot & { media: Media })[] };

const viewImages = import.meta.glob<{ default: ImageMetadata }>("../assets/views/*.webp", { eager: true });
const mediaImages = import.meta.glob<{ default: ImageMetadata }>("../assets/media/*.{jpg,webp}", { eager: true });

/** What fills the device boxes: photos (credited in CREDITS.md) and rendered screen shares. */
const MEDIA: Record<string, { focus: string; alt: string }> = {
  "fc-host": { focus: "28% 40%", alt: "a podcast host talking into a microphone" },
  "fc-analyst": { focus: "40% 35%", alt: "an analyst at a microphone, waving" },
  "fc-stadium": { focus: "50% 55%", alt: "a football stadium at night under floodlights" },
  "nova-cam": { focus: "58% 40%", alt: "a streamer with a headset at an RGB-lit desk" },
  "nova-gameplay": { focus: "50% 50%", alt: "blurred gameplay on the screen" },
  pastor: { focus: "52% 30%", alt: "a pastor preaching with a microphone" },
  remi: { focus: "50% 40%", alt: "a vlogger filming herself with an action camera on a hillside" },
  "remi-lake": { focus: "50% 55%", alt: "an alpine lake between mountains at dusk" },
  kofi: { focus: "50% 32%", alt: "a reporter with a microphone on a street" },
  festival: { focus: "50% 45%", alt: "a festival crowd with their arms raised" },
  cook: { focus: "75% 35%", alt: "a cook smiling as she stirs a pot at the stove" },
  dough: { focus: "50% 50%", alt: "bread dough rising in a lined pot, up close" },
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
