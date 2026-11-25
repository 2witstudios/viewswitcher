// The App Store versions of the iPad screenshots (scripts/ipad-shots.sh): each raw capture inside a
// clean iPad frame on a white ground, with a short caption above in the site's voice and face (Space
// Grotesk). Same pixel size as the raw capture, the 13-inch App Store size: 2752×2064 or 2064×2752.
// Rendered with Chrome (playwright-core, from apps/site) so the type matches the site.
//
//   bun apps/apple/scripts/frame-shots.ts <dir>        (reads <dir>/raw/*.png, writes <dir>/*.png)
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

const dir = resolve(process.argv[2] ?? join(import.meta.dir, "../AppStore/screenshots"));
const fontData = (await readFile(font)).toString("base64");
const browser = await chromium.launch({ channel: "chrome" });
try {
  for (const file of (await readdir(join(dir, "raw"))).filter((f) => f.endsWith(".png")).sort()) {
    const name = file.replace(/\.png$/, "");
    const caption = CAPTIONS[name];
    if (!caption) continue;
    const landscape = name.includes("landscape");
    const [W, H] = landscape ? [2752, 2064] : [2064, 2752];
    // The device: the screen at its own aspect, a graphite bezel around it, as large as the space under the caption allows.
    const captionH = landscape ? 330 : 440, margin = landscape ? 110 : 120, bezel = landscape ? 44 : 48;
    const room = { w: W - 2 * margin, h: H - captionH - margin };
    const scale = Math.min((room.w - 2 * bezel) / W, (room.h - 2 * bezel) / H);
    const sw = Math.round(W * scale), sh = Math.round(H * scale);
    const png = (await readFile(join(dir, "raw", file))).toString("base64");
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>
      @font-face { font-family: "Space Grotesk"; font-weight: 300 700; src: url(data:font/woff2;base64,${fontData}) format("woff2"); }
      html, body { margin: 0; width: ${W}px; height: ${H}px; background: #ffffff; overflow: hidden; }
      body { display: flex; flex-direction: column; align-items: center; }
      h1 { font: 700 ${landscape ? 118 : 124}px/1.05 "Space Grotesk", sans-serif; letter-spacing: -0.025em; color: #16181e;
           margin: 0; height: ${captionH}px; display: flex; align-items: center; justify-content: center; text-align: center;
           max-width: ${W - 2 * margin}px; text-wrap: balance; }
      .ipad { padding: ${bezel}px; background: #16181e; border-radius: ${bezel + 46}px;
              box-shadow: 0 0 0 3px #3a3d45 inset, 0 60px 120px -40px rgba(22, 24, 30, .35); }
      .ipad img { display: block; width: ${sw}px; height: ${sh}px; border-radius: 46px; }
    </style><h1>${caption}</h1><div class="ipad"><img src="data:image/png;base64,${png}"></div>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(dir, file), type: "png" });
    await page.close();
    console.log(`framed ${file}`);
  }
} finally {
  await browser.close();
}
