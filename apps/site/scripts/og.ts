// Generates the social card (public/og.png, 1200×630) and the icons from the mark.
//   bun run og        (from apps/site; run after `bun run shots`)
import { chromium } from "playwright-core";
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import data from "../src/data/scenes.json";

const site = resolve(import.meta.dir, "..");
const pub = join(site, "public");
const b64 = async (p: string) => (await readFile(p)).toString("base64");
const font = (pkg: string, file: string) => b64(join(site, "node_modules/@fontsource-variable", pkg, "files", file));

// ---- icons: the two-screens mark (apps/web/public/icon.svg) in graphite and white
const mark = (front: string, back: string, edge: string) =>
  `<rect x="7.5" y="4" width="13.5" height="10" rx="2.6" stroke="${back}" stroke-width="1.8" fill="none"/><rect x="3" y="10" width="13.5" height="10" rx="2.6" fill="${front}" stroke="${edge}" stroke-width="1.6" paint-order="stroke"/>`;
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><style>.f{fill:#16181e}.b{stroke:#8b909c}.e{stroke:#fff}@media (prefers-color-scheme: dark){.f{fill:#f4f5f7}.b{stroke:#a3a8b5}.e{stroke:#0b0c0f}}</style><rect class="b" x="7.5" y="4" width="13.5" height="10" rx="2.6" stroke-width="1.8" fill="none"/><rect class="f e" x="3" y="10" width="13.5" height="10" rx="2.6" stroke-width="1.6" paint-order="stroke"/></svg>\n`;
await writeFile(join(pub, "favicon.svg"), favicon);
const tile = (size: number) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"><rect width="24" height="24" fill="#16181e"/><g transform="translate(2.4 2.4) scale(.8)">${mark("#f4f5f7", "#a3a8b5", "#16181e")}</g></svg>`);
await sharp(tile(180)).png().toFile(join(pub, "apple-touch-icon.png"));
// favicon.ico: a single 32×32 PNG wrapped in an ICO header
const png32 = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24">${mark("#16181e", "#8b909c", "#ffffff")}</svg>`)).png().toBuffer();
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico.writeUInt8(32, 6); ico.writeUInt8(32, 7); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png32.length, 14); ico.writeUInt32LE(22, 18);
await writeFile(join(pub, "favicon.ico"), new Uint8Array(Buffer.concat([ico, png32])));

// ---- social card
const shot = await b64(join(site, "src/assets/scenes/daisy-teaching.webp"));
const slots = data["daisy-teaching"].slots;
const pct = (v: number, of: number) => `${(v / of) * 100}%`;
const devices = slots.map((s) => `<div class="dev ${s.name}" style="left:${pct(s.x, 1920)};top:${pct(s.y, 1080)};width:${pct(s.w, 1920)};height:${pct(s.h, 1080)}"><span>${s.name}</span></div>`).join("");
const html = `<!doctype html><html><head><style>
@font-face { font-family: SG; src: url(data:font/woff2;base64,${await font("space-grotesk", "space-grotesk-latin-wght-normal.woff2")}) format("woff2"); font-weight: 300 700; }
@font-face { font-family: IS; src: url(data:font/woff2;base64,${await font("instrument-sans", "instrument-sans-latin-wght-normal.woff2")}) format("woff2"); font-weight: 400 700; }
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; background: #fff; color: #16181e; font-family: IS; display: grid; grid-template-columns: 470px 1fr; gap: 40px; padding: 64px; overflow: hidden; }
.copy { display: flex; flex-direction: column; justify-content: space-between; }
.brand { display: flex; align-items: center; gap: 12px; font: 700 30px/1 SG; letter-spacing: -0.02em; }
h1 { font: 700 54px/1.04 SG; letter-spacing: -0.035em; }
p { font-size: 22px; color: #4b505c; }
.mon { align-self: center; background: #0b0c0f; border-radius: 20px; padding: 10px; }
.bar { color: #f4f5f7; font: 600 17px IS; display: flex; gap: 10px; align-items: center; padding: 4px 8px 12px; }
.dot { width: 11px; height: 11px; border-radius: 50%; background: #ff4d4f; }
.frame { position: relative; width: 100%; aspect-ratio: 16/9; border-radius: 12px; overflow: hidden; background: url(data:image/webp;base64,${shot}) center/cover; }
.dev { position: absolute; border-radius: 5px; display: grid; place-items: center; color: #a3a8b5; font: 600 12px IS; letter-spacing: .08em; background: linear-gradient(160deg,#2b2f39,#23262e); }
.dev.Camera { background: radial-gradient(120% 90% at 50% 30%, #3a3f4b, #1f2229 70%); color: #c4c8d2; }
</style></head><body>
<div class="copy">
  <div class="brand"><svg width="40" height="40" viewBox="0 0 24 24">${mark("#16181e", "#8b909c", "#ffffff")}</svg>ViewSwitcher</div>
  <h1>Look professional when you go live.</h1>
  <p>Professional overlays and layouts for OBS. Free for Mac.</p>
</div>
<div class="mon"><div class="bar"><span class="dot"></span>On air <span style="color:#a3a8b5;font-weight:500">Teaching</span></div><div class="frame">${devices}</div></div>
</body></html>`;
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ type: "png" });
  await sharp(png).png({ compressionLevel: 9 }).toFile(join(pub, "og.png"));
} finally { await browser.close(); }
console.log("wrote public/og.png, favicon.svg, favicon.ico, apple-touch-icon.png");
