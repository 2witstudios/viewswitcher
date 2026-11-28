// The Windows app's icons, drawn from the brand mark (apps/site/public/brand/viewswitcher-icon.svg: five
// rounded rectangles, the bottom one red) into .ico files: the app icon (graphite tile), and the tray's
// for a dark and a light taskbar plus the on-air one (all red, as the Mac's StatusIconLive).
//   bun apps/windows/scripts/icons.ts      writes apps/windows/ViewSwitcher.Windows/Assets/*.ico
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type RGBA = [number, number, number, number];
const hex = (h: string, a = 255): RGBA => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];

/** The mark in its 24-unit box (the SVG's transform applied): x, y, w, h, radius, and whether it's the red one. */
const S = 0.76, TX = 0.6, TY = 3.944;
const RECTS = [
  [0, 0, false], [20, 0, false], [4.2, 7.6, false], [15.8, 7.6, false], [10, 15.2, true],
].map(([x, y, red]) => ({ x: TX + (x as number) * S, y: TY + (y as number) * S, w: 10 * S, h: 6 * S, r: 1.2 * S, red: red as boolean }));

const inRounded = (px: number, py: number, r: { x: number; y: number; w: number; h: number; r: number }) => {
  if (px < r.x || py < r.y || px > r.x + r.w || py > r.y + r.h) return false;
  const cx = Math.min(Math.max(px, r.x + r.r), r.x + r.w - r.r);
  const cy = Math.min(Math.max(py, r.y + r.r), r.y + r.h - r.r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r.r ** 2;
};

/** One square image, `size` px, 4×4 supersampled; `pad` is the margin in 24-unit box units. */
function draw(size: number, o: { mark: RGBA; red: RGBA; tile?: RGBA; pad: number }): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const box = 24 + o.pad * 2;
  const N = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const ux = ((x + (sx + 0.5) / N) / size) * box - o.pad;
          const uy = ((y + (sy + 0.5) / N) / size) * box - o.pad;
          const hit = RECTS.find((q) => inRounded(ux, uy, q));
          let c: RGBA | null = hit ? (hit.red ? o.red : o.mark) : null;
          if (!c && o.tile) {
            // The tile: a rounded square over the whole image (radius a fifth of it).
            const t = { x: -o.pad, y: -o.pad, w: box, h: box, r: box * 0.2 };
            if (inRounded(ux, uy, t)) c = o.tile;
          }
          if (c) { r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3]; }
        }
      }
      const i = (y * size + x) * 4;
      const n = N * N;
      px[i + 3] = Math.round(a / n);
      if (a > 0) { px[i] = Math.round(r / a); px[i + 1] = Math.round(g / a); px[i + 2] = Math.round(b / a); }
    }
  }
  return px;
}

/** A 32-bit BMP entry for an .ico: BITMAPINFOHEADER (height doubled), BGRA bottom-up, then the AND mask. */
function dib(size: number, rgba: Uint8Array): Uint8Array {
  const maskRow = Math.ceil(size / 32) * 4;
  const out = new Uint8Array(40 + size * size * 4 + maskRow * size);
  const v = new DataView(out.buffer);
  v.setUint32(0, 40, true);
  v.setInt32(4, size, true);
  v.setInt32(8, size * 2, true);
  v.setUint16(12, 1, true);
  v.setUint16(14, 32, true);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4;
      const d = 40 + ((size - 1 - y) * size + x) * 4;
      out[d] = rgba[s + 2]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s]; out[d + 3] = rgba[s + 3];
    }
  }
  return out; // the AND mask stays zero: alpha says it all
}

function ico(images: { size: number; data: Uint8Array }[]): Uint8Array {
  const head = 6 + 16 * images.length;
  const total = head + images.reduce((n, i) => n + i.data.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint16(2, 1, true);
  v.setUint16(4, images.length, true);
  let at = head;
  images.forEach((img, k) => {
    const e = 6 + 16 * k;
    out[e] = img.size >= 256 ? 0 : img.size;
    out[e + 1] = img.size >= 256 ? 0 : img.size;
    v.setUint16(e + 4, 1, true);
    v.setUint16(e + 6, 32, true);
    v.setUint32(e + 8, img.data.length, true);
    v.setUint32(e + 12, at, true);
    out.set(img.data, at);
    at += img.data.length;
  });
  return out;
}

const make = (sizes: number[], o: Parameters<typeof draw>[1]) => ico(sizes.map((size) => ({ size, data: dib(size, draw(size, o)) })));

const dir = join(import.meta.dir, "../ViewSwitcher.Windows/Assets");
mkdirSync(dir, { recursive: true });
const RED = hex("#ff4d4f");
const APP = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const TRAY = [16, 20, 24, 32, 40, 48, 64];
writeFileSync(join(dir, "ViewSwitcher.ico"), make(APP, { mark: hex("#f4f5f7"), red: RED, tile: hex("#16181e"), pad: 3 }));
writeFileSync(join(dir, "TrayDark.ico"), make(TRAY, { mark: hex("#f4f5f7"), red: RED, pad: 0 }));
writeFileSync(join(dir, "TrayLight.ico"), make(TRAY, { mark: hex("#16181e"), red: RED, pad: 0 }));
writeFileSync(join(dir, "TrayLive.ico"), make(TRAY, { mark: RED, red: RED, pad: 0 }));
console.log(`[icons] ${dir}`);
