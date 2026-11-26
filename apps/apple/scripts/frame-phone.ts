// The iPhone App Store set, from scripts/frame-shots.ts --phone: four marketing shots, each built from
// real captures of the app (raw/, from AppStoreScreenshots.testPhoneShots) in realistic iPhones (frame-shots.ts'
// rim, bezel and buttons) beside the show itself, rebuilt from the site's template frames and photos.
//   1-stream    "Run your stream / from your phone."     the church stream big, the phone in front (Sermon on air)
//   2-switch    "Quickly switch / between views."        the sports podcast stream above the sideways deck
//   3-mac       "Plug into your Mac. / OBS does the rest." a MacBook showing the stream, the phone on a cable (Pastor)
//   4-looks     "A look for every / kind of show."       six template sets
// Laid out on a 440 × 956 grid (the design canvas) and scaled to each App Store size:
//   iPhone 6.9-inch 1320 × 2868   <dir>/*.png
//   iPhone 6.3-inch 1206 × 2622   <dir>-6.3/*.png
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SHOWS } from "../../site/src/data/shows";
import viewsJson from "../../site/src/data/views.json";

const site = resolve(import.meta.dir, "../../site");
const need = createRequire(join(site, "package.json"));
const { chromium } = need("playwright-core") as typeof import("playwright-core");
const fontFile = (pkg: string, file: string) => need.resolve(`@fontsource-variable/${pkg}/files/${file}`);
const b64 = async (p: string) => (await readFile(p)).toString("base64");

// Where each photo's subject sits (apps/site/src/lib/views.ts, MEDIA).
const FOCUS: Record<string, string> = {
  "fc-host": "28% 40%", "fc-analyst": "40% 35%", "fc-stadium": "50% 55%", "nova-cam": "58% 40%", "nova-gameplay": "50% 50%",
  pastor: "52% 30%", remi: "50% 40%", "remi-lake": "50% 55%", kofi: "50% 32%", festival: "50% 45%", cook: "75% 35%", dough: "50% 50%",
};
const VIEWS = viewsJson as Record<string, { ground: string; slots: { name: string; x: number; y: number; w: number; h: number; radius: string }[] }>;
const G = 440; // the grid's width; its height is 956

export async function framePhone(dir: string) {
  const raw = async (name: string) => {
    const f = join(dir, "raw", `${name}.png`);
    const png = await readFile(f).catch(() => { throw new Error(`no ${f}: run IPHONE=1 scripts/ipad-shots.sh`); });
    return `data:image/png;base64,${png.toString("base64")}`;
  };
  const shots = { deck: await raw("1-deck-landscape"), sermon: await raw("2-sermon-portrait"), pastor: await raw("3-pastor-portrait") };
  const grotesk = await b64(fontFile("space-grotesk", "space-grotesk-latin-wght-normal.woff2"));
  const instrument = await b64(fontFile("instrument-sans", "instrument-sans-latin-wght-normal.woff2"));

  const media = new Map<string, string>();
  const img = async (path: string, type: string) => `data:${type};base64,${await b64(path)}`;
  /** A show's view as it goes out: its ground, the photos in its boxes, the view on top. */
  async function stream(show: string, file: string, w: number, style = "") {
    const id = `${show}-${file}`;
    const rec = VIEWS[id], spec = SHOWS.find((s) => s.id === show)?.views.find((v) => v.file === file);
    if (!rec || !spec) throw new Error(`no view ${id}`);
    let boxes = "";
    for (const s of rec.slots) {
      const m = spec.media?.[s.name];
      if (!m || !FOCUS[m]) throw new Error(`no photo for ${id}/${s.name}`);
      if (!media.has(m)) media.set(m, await img(join(site, "src/assets/media", `${m}.jpg`), "image/jpeg"));
      boxes += `<div style="position:absolute;left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${s.h}px;overflow:hidden;border-radius:${s.radius}"><img src="${media.get(m)}" style="width:100%;height:100%;object-fit:cover;object-position:${FOCUS[m]}"></div>`;
    }
    const overlay = await img(join(site, "src/assets/views", `${id}.webp`), "image/webp");
    return `<div class="stream" style="width:${w}px;height:${(w * 9) / 16}px;${style}"><div style="width:1920px;height:1080px;transform:scale(${w / 1920});transform-origin:0 0;position:relative;background:${rec.ground}">${boxes}<img src="${overlay}" style="position:absolute;inset:0;width:1920px;height:1080px"></div></div>`;
  }

  /** An iPhone around a capture: the screen at (x, y), w × h; sideways = the top of the phone on the left. */
  function phone(x: number, y: number, w: number, h: number, src: string, sideways = false) {
    const s = Math.min(w, h), rim = 0.014 * s, bezel = 0.03 * s, radius = 0.13 * s, t = rim * 0.9;
    const along = (sideways ? w : h) + 2 * (bezel + rim);
    const btn = (side: number, from: number, len: number) => sideways
      ? `<i class="btn" style="${side < 0 ? "bottom" : "top"}:${-t}px;left:${from * along}px;height:${t}px;width:${len * along}px"></i>`
      : `<i class="btn" style="${side < 0 ? "left" : "right"}:${-t}px;top:${from * along}px;width:${t}px;height:${len * along}px"></i>`;
    return `<div class="rim" style="left:${x - rim - bezel}px;top:${y - rim - bezel}px;padding:${rim}px;border-radius:${radius + bezel + rim}px">
      <div class="bezel" style="padding:${bezel}px;border-radius:${radius + bezel}px"><img src="${src}" style="display:block;width:${w}px;height:${h}px;border-radius:${radius}px"></div>
      ${btn(-1, 0.17, 0.05)}${btn(-1, 0.25, 0.085)}${btn(-1, 0.355, 0.085)}${btn(1, 0.27, 0.13)}</div>`;
  }

  const head = (a: string, b: string, sub: string) =>
    `<header><h1>${a}<br><span>${b}</span></h1><p>${sub}</p></header>`;
  const foot = (text: string, top = 896) => `<p class="foot" style="top:${top}px">${text}</p>`;
  const live = (x: number, y: number) => `<span class="live" style="left:${x}px;top:${y}px">LIVE</span>`;

  // 2: the deck sideways under the stream; the tap on Both hosts (where it sits in the capture).
  const deck = { x: 34, y: 578, w: 372 }, deckH = (deck.w * 1320) / 2868;
  const tap = { x: deck.x + 0.606 * deck.w, y: deck.y + 0.332 * deckH };
  const streamTop = 282, streamBottom = streamTop + (360 * 9) / 16;

  const pages: Record<string, string> = {
    "1-stream": `${head("Run your stream", "from your phone.", "Tap a view. Your stream changes.")}
      ${await stream("grace", "main", 488, "left:-24px;top:214px;border-radius:10px")}${live(20, 228)}
      ${phone(122, 418, 246, (246 * 2868) / 1320, shots.sermon)}`,
    "2-switch": `${head("Quickly switch", "between views.", "Turn your phone sideways: every view is one tap.")}
      ${await stream("fullcount", "main", 360, `left:40px;top:${streamTop}px;border-radius:8px`)}${live(52, streamTop + 12)}
      <svg class="over" viewBox="0 0 ${G} 956" fill="none"><path d="M${tap.x} ${tap.y - 26} C ${tap.x + 6} ${tap.y - 70}, ${tap.x - 8} ${streamBottom + 40}, ${tap.x - 26} ${streamBottom + 14}" stroke="#ff4d4f" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 8"/>
      <path d="M${tap.x - 16} ${streamBottom + 19} L ${tap.x - 27} ${streamBottom + 12} L ${tap.x - 29} ${streamBottom + 25}" stroke="#ff4d4f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      ${phone(deck.x, deck.y, deck.w, deckH, shots.deck, true)}
      <span class="tap" style="left:${tap.x - 19}px;top:${tap.y - 19}px"></span>
      ${foot("Tap Both hosts, and the stream cuts to both of them.", 820)}`,
    "3-mac": `${head("Plug into your Mac.", "OBS does the rest.", "One USB-C cable, or your Wi-Fi.")}
      <div class="lid"><div class="glass">${await stream("grace", "live", 374, "left:0;top:0")}<i class="notch"></i></div></div><div class="base"><i></i></div>
      <svg class="over" viewBox="0 0 ${G} 956" fill="none"><path d="M60 492 C 60 640, 150 860, 300 884" stroke="#3a3c44" stroke-width="6" stroke-linecap="round"/></svg>
      ${phone(242, 512, 158, (158 * 2868) / 1320, shots.pastor)}
      <div class="chips"><span>${icon.usb}USB-C</span><span>${icon.wifi}Wi-Fi</span><span><b></b>OBS</span></div>
      ${foot("ViewSwitcher for Mac is free.")}`,
    "4-looks": `${head("A look for every", "kind of show.", "Free template sets, in your colors.")}
      <div class="grid">${(await Promise.all([
        ["grace", "main", "Church"], ["fullcount", "main", "Sports podcast"], ["kitchen", "main", "Cooking"],
        ["nova", "main", "Gaming"], ["remi", "main", "Travel"], ["riverside", "main", "Live events"],
      ].map(async ([show, file, name]) => `<figure>${await stream(show!, file!, 193, "position:relative;border-radius:8px")}<figcaption>${name}</figcaption></figure>`))).join("")}</div>
      ${foot("Or describe your own and let AI build it.")}`,
  };

  const css = `
    @font-face { font-family: "Space Grotesk"; font-weight: 300 700; src: url(data:font/woff2;base64,${grotesk}) format("woff2"); }
    @font-face { font-family: "Instrument Sans"; font-weight: 400 700; src: url(data:font/woff2;base64,${instrument}) format("woff2"); }
    * { box-sizing: border-box; }
    html, body { margin: 0; overflow: hidden; background: #0b0c0f; }
    .page { position: relative; width: ${G}px; height: 956px; overflow: hidden; transform-origin: 0 0; color: #f4f5f7; font-family: "Instrument Sans", sans-serif; }
    header { position: absolute; left: 0; top: 54px; width: ${G}px; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; }
    h1 { margin: 0; font: 700 42px/1.02 "Space Grotesk", sans-serif; letter-spacing: -0.03em; }
    h1 span { color: #ff4d4f; }
    header p { margin: 0; font-size: 16px; color: #a3a8b5; }
    .foot { position: absolute; left: 0; width: ${G}px; margin: 0; text-align: center; font-size: 14px; color: #7d8290; }
    .stream { position: absolute; overflow: hidden; box-shadow: 0 0 0 1px #ffffff14, 0 30px 60px -20px rgba(0, 0, 0, .8); }
    .live { position: absolute; display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 6px; background: #ff4d4f; color: #fff; font-size: 10px; font-weight: 700; letter-spacing: .18em; }
    .rim { position: absolute; background: linear-gradient(135deg, #6b6f7a 0%, #2a2c33 18%, #4d515b 42%, #24262c 62%, #5d616b 86%, #33363d 100%);
      box-shadow: 0 30px 70px rgba(0, 0, 0, .6), 0 0 0 .5px rgba(255, 255, 255, .08); }
    .bezel { background: #050506; box-shadow: inset 0 0 0 .6px #1b1c20; }
    .btn { position: absolute; background: linear-gradient(90deg, #3c3f47, #6b6f7a, #3c3f47); border-radius: 1px; }
    .over { position: absolute; left: 0; top: 0; width: ${G}px; height: 956px; }
    .tap { position: absolute; width: 38px; height: 38px; border-radius: 50%; background: rgba(255, 255, 255, .28); box-shadow: 0 0 0 2px rgba(255, 255, 255, .85), 0 0 0 10px rgba(255, 255, 255, .12); }
    .lid { position: absolute; left: 24px; top: 236px; width: 392px; height: 245px; padding: 2px; border-radius: 16px 16px 3px 3px;
      background: linear-gradient(180deg, #8d9099, #50535b); box-shadow: 0 30px 60px -20px rgba(0, 0, 0, .8); }
    .glass { position: relative; width: 100%; height: 100%; padding: 7px 7px 10px; border-radius: 14px 14px 2px 2px; background: #050506; display: flex; align-items: center; }
    .glass .stream { position: relative; box-shadow: none; border-radius: 3px; }
    .notch { position: absolute; left: 50%; top: 0; width: 44px; height: 7px; margin-left: -22px; border-radius: 0 0 4px 4px; background: #050506; }
    .base { position: absolute; left: 4px; top: 481px; width: 432px; height: 13px; border-radius: 1px 1px 12px 12px;
      background: linear-gradient(180deg, #a3a6ae 0%, #6e717a 35%, #3e4047 100%); box-shadow: 0 18px 30px -10px rgba(0, 0, 0, .8); }
    .base i { position: absolute; left: 50%; top: 0; width: 66px; height: 4px; margin-left: -33px; border-radius: 0 0 5px 5px; background: #55585f; }
    .chips { position: absolute; left: 24px; top: 568px; display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
    .chips span { display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 14px; border-radius: 999px; background: #1c1f27; font-size: 14px; font-weight: 600; }
    .chips svg { width: 14px; height: 14px; }
    .chips b { width: 8px; height: 8px; border-radius: 50%; background: #ff4d4f; }
    .grid { position: absolute; left: 20px; top: 222px; width: 400px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px 14px; }
    .grid figure { margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .grid figcaption { font-size: 15px; font-weight: 600; }`;

  const canvases = [{ W: 1320, H: 2868, out: dir }, { W: 1206, H: 2622, out: `${dir}-6.3` }];
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    for (const { W, H, out } of canvases) {
      await mkdir(out, { recursive: true });
      for (const f of (await readdir(out)).filter((f) => f.endsWith(".png"))) await rm(join(out, f)); // this set only
      for (const [name, body] of Object.entries(pages)) {
        const p = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
        await p.setContent(`<!doctype html><meta charset="utf-8"><style>${css} html, body { width: ${W}px; height: ${H}px; }</style><div class="page" style="transform:scale(${W / G})">${body}</div>`);
        await p.evaluate(() => document.fonts.ready);
        await p.waitForFunction(() => [...document.images].every((i) => i.complete));
        await p.waitForTimeout(150);
        await p.screenshot({ path: join(out, `${name}.png`), type: "png" });
        await p.close();
        console.log(`framed ${out.split("/").slice(-1)[0]}/${name}.png (${W}×${H})`);
      }
    }
  } finally {
    await browser.close();
  }
}

const icon = {
  usb: `<svg viewBox="0 0 24 24" fill="none" stroke="#f4f5f7" stroke-width="2.2" stroke-linecap="round"><path d="M12 3v10M8 7h8v6a4 4 0 0 1-8 0zM12 17v4"/></svg>`,
  wifi: `<svg viewBox="0 0 24 24" fill="none" stroke="#f4f5f7" stroke-width="2.2" stroke-linecap="round"><path d="M3 9a14 14 0 0 1 18 0M6.5 12.5a9 9 0 0 1 11 0M10 16a4 4 0 0 1 4 0"/><circle cx="12" cy="19" r="0.8" fill="#f4f5f7"/></svg>`,
};
