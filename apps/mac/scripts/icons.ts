// Renders the app icon (build/icon.png, 1024²) and the menu-bar icons (assets/tray*.png) from the
// ViewSwitcher mark (apps/ipad/www/icon.svg). Run after changing the mark: bun scripts/icons.ts
import sharp from "sharp";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

/** The mark in its 24-unit box: the back frame cut away around the front card. */
const mark = (back: string, front: string, cut: boolean) => `
  <defs><mask id="m"><rect x="-1" y="-1" width="26" height="26" fill="#fff"/>${cut ? `<rect x="3" y="10" width="13.5" height="10" rx="2.6" fill="#000" stroke="#000" stroke-width="3.2"/>` : ""}</mask></defs>
  <rect x="7.5" y="4" width="13.5" height="10" rx="2.6" fill="none" stroke="${back}" stroke-width="1.8" mask="url(#m)"/>
  <rect x="3" y="10" width="13.5" height="10" rx="2.6" fill="${front}"/>`;

// App icon: the macOS grid (an 824² rounded square centered on 1024²), graphite with the white mark.
const app = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a1c22"/><stop offset="1" stop-color="#0b0c0f"/></linearGradient></defs>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#g)"/>
  <rect x="100.5" y="100.5" width="823" height="823" rx="184.5" fill="none" stroke="#ffffff" stroke-opacity="0.08"/>
  <g transform="translate(212 212) scale(25)">${mark("#a3a8b5", "#f4f5f7", true)}</g>
</svg>`;
await sharp(Buffer.from(app)).png().toFile(join(root, "build/icon.png"));

// Menu bar: 16 pt. A template image (black + alpha; macOS tints it) when nothing is on air,
// and the same mark in tally red while something is: red is only ever for on air.
for (const [name, color] of [["trayTemplate", "#000000"], ["trayLive", "#ff4d4f"]] as const) {
  for (const scale of [1, 2]) {
    const px = 16 * scale;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24">${mark(color, color, true)}</svg>`;
    await sharp(Buffer.from(svg)).png().toFile(join(root, "assets", `${name}${scale === 2 ? "@2x" : ""}.png`));
  }
}
console.log("icons written");
