// The App Store versions of the screenshots (scripts/ipad-shots.sh): each raw capture inside a clean
// device frame on a white ground, with a short caption above in the site's voice and face (Space
// Grotesk). Same pixel size as the raw capture, which is already an App Store size: the 13-inch iPad
// (2752×2064 / 2064×2752) or, with --phone, the 6.9-inch iPhone (2868×1320 / 1320×2868).
// Rendered with Chrome (playwright-core, from apps/site) so the type matches the site.
//
//   bun apps/apple/scripts/frame-shots.ts <dir> [--phone]     (reads <dir>/raw/*.png, writes <dir>/*.png)
import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const site = resolve(import.meta.dir, "../../site");
const need = createRequire(join(site, "package.json"));
const { chromium } = need("playwright-core") as typeof import("playwright-core");
const font = need.resolve("@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2");

/** Caption for each raw screenshot, by its name; a raw shot with none is left out. */
export const CAPTIONS: Record<string, string> = {
  "1-stream-landscape": "Look professional when you go live.",
  "2-editor-landscape": "Change titles live, right on the view.",
  "3-templates-landscape": "Free templates for every kind of show.",
  "4-stream-portrait": "Tap a view. OBS switches.",
  "5-demo-landscape": "Try it first: the demo needs no Mac.",
};
export const PHONE_CAPTIONS: Record<string, string> = {
  "1-deck-landscape": "Tap a view. OBS switches.",
  "2-onair-portrait": "Always know what's on air.",
  "3-pair-portrait": "Scan your Mac's code to pair.",
  "4-demo-landscape": "Try it first: the demo needs no Mac.",
};

const args = process.argv.slice(2);
const phone = args.includes("--phone");
const dir = resolve(args.find((a) => !a.startsWith("--")) ?? join(import.meta.dir, "../AppStore/screenshots", phone ? "iphone" : ""));
const captions = phone ? PHONE_CAPTIONS : CAPTIONS;
/** A PNG's pixel size, from its IHDR chunk. */
const size = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)] as const;

const fontData = (await readFile(font)).toString("base64");
const browser = await chromium.launch({ channel: "chrome" });
try {
  for (const file of (await readdir(join(dir, "raw"))).filter((f) => f.endsWith(".png")).sort()) {
    const name = file.replace(/\.png$/, "");
    const caption = captions[name];
    if (!caption) continue;
    const raw = await readFile(join(dir, "raw", file));
    const [W, H] = size(raw);
    const landscape = W > H;
    // A capture turned the wrong way would be framed squashed: stop instead.
    if (landscape !== name.includes("landscape")) throw new Error(`${file} is ${W}×${H}, not ${name.includes("landscape") ? "landscape" : "portrait"}`);
    const short = Math.min(W, H);
    // Proportions from the 13-inch iPad's 2064 px short side; a phone has a thinner bezel and rounder corners.
    const u = short / 2064;
    const captionH = Math.round((landscape ? 330 : 440) * u * (phone ? 1.25 : 1));
    const margin = Math.round((landscape ? 110 : 120) * u);
    const bezel = Math.round((phone ? 30 : landscape ? 44 : 48) * u);
    const radius = Math.round((phone ? 150 : 46) * u);
    const type = Math.round((landscape ? 118 : 124) * u * (phone ? (landscape ? 1.25 : 1.6) : 1));
    // The device: the screen at its own aspect, the bezel around it, as large as the space under the caption allows.
    const room = { w: W - 2 * margin, h: H - captionH - margin };
    const scale = Math.min((room.w - 2 * bezel) / W, (room.h - 2 * bezel) / H);
    const sw = Math.round(W * scale), sh = Math.round(H * scale);
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>
      @font-face { font-family: "Space Grotesk"; font-weight: 300 700; src: url(data:font/woff2;base64,${fontData}) format("woff2"); }
      html, body { margin: 0; width: ${W}px; height: ${H}px; background: #ffffff; overflow: hidden; }
      body { display: flex; flex-direction: column; align-items: center; }
      h1 { font: 700 ${type}px/1.05 "Space Grotesk", sans-serif; letter-spacing: -0.025em; color: #16181e;
           margin: 0; height: ${captionH}px; display: flex; align-items: center; justify-content: center; text-align: center;
           max-width: ${W - 2 * margin}px; text-wrap: balance; }
      .device { padding: ${bezel}px; background: #16181e; border-radius: ${radius + bezel}px;
                box-shadow: 0 0 0 ${Math.max(2, Math.round(3 * u))}px #3a3d45 inset, 0 ${Math.round(60 * u)}px ${Math.round(120 * u)}px -${Math.round(40 * u)}px rgba(22, 24, 30, .35); }
      .device img { display: block; width: ${sw}px; height: ${sh}px; border-radius: ${radius}px; }
    </style><h1>${caption}</h1><div class="device"><img src="data:image/png;base64,${raw.toString("base64")}"></div>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(dir, file), type: "png" });
    await page.close();
    console.log(`framed ${file}`);
  }
} finally {
  await browser.close();
}
