// A contact sheet of every example view, composited the way the site and OBS do it:
// ground → photo in each device box (cover-fit at its focus point) → the view on top.
//
//   bun scripts/contact-sheet.ts <out.jpg> [show,show…]
//
// For checking renders by eye; it writes nothing into the repo.
import sharp, { type OverlayOptions } from "sharp";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { SHOWS, viewId } from "../src/data/shows";
import data from "../src/data/views.json";

const site = resolve(import.meta.dir, "..");
const [out, filter] = [process.argv[2], process.argv[3]?.split(",")];
if (!out) throw new Error("usage: bun scripts/contact-sheet.ts <out.jpg> [show,show]");

// Same focus points as src/lib/views.ts (kept in one place there; read them from the source).
const src = await Bun.file(join(site, "src/lib/views.ts")).text();
const focus = (name: string) => {
  const m = src.match(new RegExp(`"?${name}"?: \\{ focus: "(\\d+)% (\\d+)%"`));
  return m ? [Number(m[1]) / 100, Number(m[2]) / 100] : [0.5, 0.5];
};
const mediaPath = (n: string) => [".jpg", ".webp"].map((e) => join(site, "src/assets/media", n + e)).find(existsSync)!;

const W = 960, H = 540, S = W / 1920, LABEL = 34;
async function composite(showId: string, file: string, media: Record<string, string>, ground: string) {
  const rec = (data as Record<string, { slots: { name: string; x: number; y: number; w: number; h: number }[] }>)[viewId(showId, file)]!;
  const layers: OverlayOptions[] = [];
  for (const s of rec.slots) {
    const w = Math.max(1, Math.round(s.w * S)), h = Math.max(1, Math.round(s.h * S));
    const img = sharp(mediaPath(media[s.name]!));
    const { width: iw = 1, height: ih = 1 } = await img.metadata();
    const k = Math.max(w / iw, h / ih), sw = Math.ceil(iw * k), sh = Math.ceil(ih * k);
    const [fx, fy] = focus(media[s.name]!);
    const left = Math.round((sw - w) * fx!), top = Math.round((sh - h) * fy!);
    layers.push({ input: await img.resize(sw, sh).extract({ left, top, width: w, height: h }).toBuffer(), left: Math.round(s.x * S), top: Math.round(s.y * S) });
  }
  layers.push({ input: await sharp(join(site, "src/assets/views", `${viewId(showId, file)}.webp`)).resize(W, H).toBuffer(), left: 0, top: 0 });
  return sharp({ create: { width: W, height: H, channels: 3, background: ground } }).composite(layers).png().toBuffer();
}

const shows = SHOWS.filter((s) => !filter || filter.includes(s.id));
const cols = Math.max(...shows.map((s) => s.views.length));
const tiles: OverlayOptions[] = [];
for (const [r, show] of shows.entries()) for (const [c, v] of show.views.entries()) {
  const label = Buffer.from(`<svg width="${W}" height="${LABEL}"><text x="4" y="24" font-family="Helvetica" font-size="20" fill="#16181e">${show.name} · ${v.name}</text></svg>`);
  tiles.push({ input: await composite(show.id, v.file, v.media ?? {}, show.ground), left: c * (W + 12), top: r * (H + LABEL + 16) + LABEL });
  tiles.push({ input: label, left: c * (W + 12), top: r * (H + LABEL + 16) });
}
await sharp({ create: { width: cols * (W + 12), height: shows.length * (H + LABEL + 16), channels: 3, background: "#ffffff" } })
  .composite(tiles).jpeg({ quality: 82 }).toFile(out);
console.log(`wrote ${out}`);
