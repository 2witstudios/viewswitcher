// The App Store versions of the screenshots (scripts/ipad-shots.sh). Each raw capture is shown in a
// realistic device (a sideways one for a landscape capture) on a portrait canvas: ViewSwitcher's dark
// ground with a soft lift and a faint red glow behind the device, the white logo at the top, a two-line
// Space Grotesk headline (the second line red) and a one-line Instrument Sans subtitle.
// Canvases are the App Store sizes, always portrait:
//   iPad 13-inch            2064 × 2752   <dir>/*.png
//   iPhone 6.9-inch         1320 × 2868   <dir>/*.png               (--phone)
//   iPhone 6.3-inch         1206 × 2622   <dir>-6.3/*.png           (--phone, the "medium display" slot)
// Rendered with Chrome (playwright-core, from apps/site) so the type matches the site.
//
//   bun apps/apple/scripts/frame-shots.ts <dir> [--phone]     (reads <dir>/raw/*.png)
import { createRequire } from "node:module";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const site = resolve(import.meta.dir, "../../site");
const need = createRequire(join(site, "package.json"));
const { chromium } = need("playwright-core") as typeof import("playwright-core");
const fontFile = (pkg: string, file: string) => need.resolve(`@fontsource-variable/${pkg}/files/${file}`);

type Copy = { head: [string, string]; sub: string };
/** What each raw screenshot says, by its name; a raw shot with none is left out. */
export const IPAD: Record<string, Copy> = {
  "1-stream-landscape": { head: ["Look professional", "when you go live."], sub: "Tap a view on the iPad beside you and OBS switches." },
  "2-editor-landscape": { head: ["Change titles", "while you're live."], sub: "Retype a title right on the view. It's on stream as you type." },
  "3-templates-landscape": { head: ["Your show's look,", "ready to go."], sub: "Free template sets for church, sports and more, in your colors." },
  "4-sermon-portrait": { head: ["Tap a view.", "OBS switches."], sub: "Your camera, screen and titles move into place." },
  "5-pastor-landscape": { head: ["Run the service", "without a crew."], sub: "Welcome, worship, sermon, giving: one tap each." },
};
export const IPHONE: Record<string, Copy> = {
  "1-deck-landscape": { head: ["Tap a view.", "OBS switches."], sub: "Turn your iPhone sideways and run the show like a deck." },
  "2-sermon-portrait": { head: ["Always know", "what's on air."], sub: "What your viewers see stays on top, marked in red." },
  "3-pair-portrait": { head: ["Scan the code.", "You're connected."], sub: "Pair with your Mac over Wi-Fi, or plug in with USB-C." },
  "4-pastor-landscape": { head: ["Your whole show,", "in your pocket."], sub: "Every view one tap away, from the pulpit to the press box." },
};

const args = process.argv.slice(2);
const phone = args.includes("--phone");
const dir = resolve(args.find((a) => !a.startsWith("--")) ?? join(import.meta.dir, "../AppStore/screenshots", phone ? "iphone" : ""));
const copy = phone ? IPHONE : IPAD;
const canvases = phone ? [{ W: 1320, H: 2868, out: dir }, { W: 1206, H: 2622, out: `${dir}-6.3` }] : [{ W: 2064, H: 2752, out: dir }];
/** A PNG's pixel size, from its IHDR chunk. */
const size = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)] as const;
const b64 = async (p: string) => (await readFile(p)).toString("base64");

const grotesk = await b64(fontFile("space-grotesk", "space-grotesk-latin-wght-normal.woff2"));
const instrument = await b64(fontFile("instrument-sans", "instrument-sans-latin-wght-normal.woff2"));
const logo = await b64(join(site, "public/brand/viewswitcher-logo-white.svg"));
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/'/g, "&#8217;");

function page(W: number, H: number, shot: { png: string; w: number; h: number }, c: Copy) {
  const landscape = shot.w > shot.h;
  // Text sizes follow the canvas width; the device takes the rest.
  const k = W / 1000;
  const T = phone
    ? { logo: 300 * k, logoTop: 0.052 * H, head: 112 * k, sub: 36 * k, gap: 0.03 * H }
    : { logo: 260 * k, logoTop: 0.048 * H, head: 92 * k, sub: 27 * k, gap: 0.028 * H };
  // Device proportions, from the screen's short side.
  const D = phone ? { rim: 0.014, bezel: 0.03, radius: 0.13 } : { rim: 0.009, bezel: 0.042, radius: 0.034 };
  return `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: "Space Grotesk"; font-weight: 300 700; src: url(data:font/woff2;base64,${grotesk}) format("woff2"); }
  @font-face { font-family: "Instrument Sans"; font-weight: 400 700; src: url(data:font/woff2;base64,${instrument}) format("woff2"); }
  * { box-sizing: border-box; }
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
  body { position: relative; background: #0b0c0f; display: flex; flex-direction: column; align-items: center; }
  .lift { position: absolute; inset: 0; background: radial-gradient(ellipse 85% 55% at 50% 0%, #1d2028 0%, #12141a 45%, #0b0c0f 80%); }
  .glow { position: absolute; border-radius: 50%; background: radial-gradient(closest-side, rgba(255, 77, 79, .3), rgba(255, 77, 79, .1) 55%, rgba(255, 77, 79, 0) 100%); filter: blur(${40 * k}px); }
  header { position: relative; display: flex; flex-direction: column; align-items: center; padding-top: ${T.logoTop}px; width: 100%; }
  header img { width: ${T.logo}px; display: block; }
  h1 { margin: ${0.03 * H}px 0 0; font: 700 ${T.head}px/0.98 "Space Grotesk", sans-serif; letter-spacing: -0.045em; text-align: center; white-space: nowrap; }
  h1 span { display: block; color: #f4f5f7; }
  h1 span + span { color: #ff4d4f; }
  p { margin: ${0.018 * H}px 0 0; font: 400 ${T.sub}px/1.2 "Instrument Sans", sans-serif; color: #a3a8b5; white-space: nowrap; letter-spacing: -0.005em; }
  .stage { position: relative; flex: 1; width: 100%; margin-top: ${T.gap}px; margin-bottom: ${0.035 * H}px; display: flex; align-items: center; justify-content: center; }
  .rim { position: relative; background: linear-gradient(135deg, #6b6f7a 0%, #2a2c33 18%, #4d515b 42%, #24262c 62%, #5d616b 86%, #33363d 100%); box-shadow: 0 ${30 * k}px ${80 * k}px rgba(0, 0, 0, .55), 0 0 0 ${Math.max(1, k)}px rgba(255, 255, 255, .06); }
  .bezel { background: #050506; box-shadow: inset 0 0 0 ${Math.max(1, 1.5 * k)}px #1b1c20; }
  .bezel img { display: block; }
  .btn { position: absolute; background: linear-gradient(90deg, #3c3f47, #6b6f7a, #3c3f47); border-radius: ${2 * k}px; }
</style>
<div class="lift"></div><div class="glow" id="glow"></div>
<header><img src="data:image/svg+xml;base64,${logo}" alt=""><h1 id="h"><span>${escape(c.head[0])}</span><span>${escape(c.head[1])}</span></h1><p id="sub">${escape(c.sub)}</p></header>
<div class="stage" id="stage"><div class="rim" id="rim"><div class="bezel" id="bezel"><img id="shot" src="data:image/png;base64,${shot.png}"></div></div></div>
<script>
  const W = ${W}, landscape = ${landscape}, phone = ${phone}, D = ${JSON.stringify(D)}, sw = ${shot.w}, sh = ${shot.h};
  // One line each: shrink the headline and the subtitle until they fit.
  for (const [id, max] of [["h", 0.92 * W], ["sub", 0.9 * W]]) {
    const el = document.getElementById(id);
    let px = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > max && px > 10) { px -= 1; el.style.fontSize = px + "px"; }
  }
  // The device: as large as the stage allows, screen at the capture's own aspect.
  const stage = document.getElementById("stage").getBoundingClientRect();
  // A sideways iPhone is as wide as the canvas allows: its screen spans the width and only the bezel bleeds off.
  const maxW = (landscape ? (phone ? 1.04 : 0.95) : phone ? 0.8 : 0.86) * W, maxH = stage.height;
  const frame = (short) => short * (D.rim + D.bezel) * 2; // rim + bezel on both sides, from the screen's short side
  let scale = Math.min(maxW / sw, maxH / sh);
  for (let i = 0; i < 4; i++) { const f = frame(Math.min(sw, sh) * scale); scale = Math.min((maxW - f) / sw, (maxH - f) / sh); }
  const w = sw * scale, h = sh * scale, s = Math.min(w, h);
  const rim = D.rim * s, bezel = D.bezel * s, radius = D.radius * s;
  const img = document.getElementById("shot"), bz = document.getElementById("bezel"), rm = document.getElementById("rim");
  Object.assign(img.style, { width: w + "px", height: h + "px", borderRadius: radius + "px" });
  Object.assign(bz.style, { padding: bezel + "px", borderRadius: radius + bezel + "px" });
  Object.assign(rm.style, { padding: rim + "px", borderRadius: radius + bezel + rim + "px" });
  // The iPhone's buttons on its edges: action and volume on the left, the side button on the right
  // (sideways, with the top of the phone on the left: along the bottom and the top).
  if (phone) {
    const t = rim * 0.9, along = (landscape ? w : h) + 2 * (bezel + rim);
    const at = (side, from, len) => {
      const b = document.createElement("div"); b.className = "btn";
      if (!landscape) Object.assign(b.style, side < 0 ? { left: -t + "px" } : { right: -t + "px" }, { top: from * along + "px", width: t + "px", height: len * along + "px" });
      else Object.assign(b.style, side < 0 ? { bottom: -t + "px" } : { top: -t + "px" }, { left: from * along + "px", height: t + "px", width: len * along + "px" });
      rm.appendChild(b);
    };
    at(-1, 0.17, 0.05); at(-1, 0.25, 0.085); at(-1, 0.355, 0.085); at(1, 0.27, 0.13);
  }
  // The glow sits behind the device.
  const r = rm.getBoundingClientRect(), g = document.getElementById("glow");
  const gw = r.width * 1.35, gh = r.height * 1.05;
  Object.assign(g.style, { left: r.left + r.width / 2 - gw / 2 + "px", top: r.top + r.height / 2 - gh / 2 + "px", width: gw + "px", height: gh + "px" });
</script>`;
}

const browser = await chromium.launch({ channel: "chrome" });
try {
  for (const file of (await readdir(join(dir, "raw"))).filter((f) => f.endsWith(".png")).sort()) {
    const name = file.replace(/\.png$/, "");
    const c = copy[name];
    if (!c) continue;
    const raw = await readFile(join(dir, "raw", file));
    const [w, h] = size(raw);
    // A capture turned the wrong way would be framed in the wrong device: stop instead.
    if (w > h !== name.includes("landscape")) throw new Error(`${file} is ${w}×${h}, not ${name.includes("landscape") ? "landscape" : "portrait"}`);
    for (const { W, H, out } of canvases) {
      await mkdir(out, { recursive: true });
      const p = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      await p.setContent(page(W, H, { png: raw.toString("base64"), w, h }, c));
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(150);
      await p.screenshot({ path: join(out, file), type: "png" });
      await p.close();
      console.log(`framed ${out.split("/").slice(-1)[0]}/${file} (${W}×${H})`);
    }
  }
} finally {
  await browser.close();
}
