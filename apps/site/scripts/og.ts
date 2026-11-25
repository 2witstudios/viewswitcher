// Generates the icons, the brand kit and a social card per page, all from the logo in src/lib/brand.ts.
//   bun run og        (from apps/site; after `bun run shots` when the views changed)
//
// 1. Icons: public/favicon.svg (light and dark tabs), favicon.ico (32 px), apple-touch-icon.png.
// 2. Brand kit, public/brand/: the logo for light and dark grounds, the V on its own, the app-icon tile,
//    a profile picture, an X header and a YouTube banner (its text inside YouTube's 1546×423 safe area).
// 3. Social cards: builds the site, opens every page and copies its hero (eyebrow, headline, lede and
//    the picture above the first section) into a 1200×630 card, public/og/<page>.jpg. The card mirrors
//    the hero, so retyping a hero and rerunning this is all a card ever needs. src/data/og.json maps each
//    path to its card and alt text for Base.astro; a page without a card gets the home page's.
import { chromium, type Page } from "playwright-core";
import sharp from "sharp";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { LOGO, logoBody, logoSvg, logoViewBox, iconBody, tileSvg, faviconSvg, LIVE } from "../src/lib/brand";
import { descriptor } from "../src/site.config";

const site = resolve(import.meta.dir, "..");
const pub = join(site, "public");
const b64 = async (p: string) => (await readFile(p)).toString("base64");
const font = (pkg: string, file: string) => b64(join(site, "node_modules/@fontsource-variable", pkg, "files", file));
const png = (svg: string) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 });

// ---- 1. icons
await writeFile(join(pub, "favicon.svg"), faviconSvg());
await png(tileSvg(180, "#0b0c0f", 0.2)).toFile(join(pub, "apple-touch-icon.png"));
// favicon.ico: a single 32×32 PNG wrapped in an ICO header
const png32 = await png(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24">${iconBody("#16181e")}</svg>`).toBuffer();
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico.writeUInt8(32, 6); ico.writeUInt8(32, 7); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png32.length, 14); ico.writeUInt32LE(22, 18);
await writeFile(join(pub, "favicon.ico"), new Uint8Array(Buffer.concat([ico, png32])));

// ---- 2. brand kit (vectors here; the pictures with type are rendered in the browser below)
const kit = join(pub, "brand");
await mkdir(kit, { recursive: true });
await writeFile(join(kit, "viewswitcher-logo.svg"), logoSvg("#16181e"));
await writeFile(join(kit, "viewswitcher-logo-white.svg"), logoSvg("#f4f5f7"));
await writeFile(join(kit, "viewswitcher-icon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-label="ViewSwitcher">${iconBody("#16181e")}</svg>\n`);
await png(tileSvg(1024, "#0b0c0f", 0.2)).toFile(join(kit, "viewswitcher-app-icon.png"));
await png(tileSvg(800, "#0b0c0f", 0.3)).toFile(join(kit, "viewswitcher-avatar.png"));

const fonts = `
@font-face { font-family: SG; src: url(data:font/woff2;base64,${await font("space-grotesk", "space-grotesk-latin-wght-normal.woff2")}) format("woff2"); font-weight: 300 700; }
@font-face { font-family: IS; src: url(data:font/woff2;base64,${await font("instrument-sans", "instrument-sans-latin-wght-normal.woff2")}) format("woff2"); font-weight: 400 700; }
* { box-sizing: border-box; margin: 0; }`;
const logo = (h: number, ink: string) =>
  `<svg width="${Math.round((h * LOGO.w) / LOGO.h)}" height="${h}" viewBox="${logoViewBox}" style="display:block">${logoBody(ink)}</svg>`;
/** The V on its own, large, as a picture. */
const bigV = (size: number, ink: string) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="display:block">${iconBody(ink)}</svg>`;

const banner = (w: number, h: number, safeW: number, logoH: number) => `<!doctype html><html><head><style>${fonts}
body { width: ${w}px; height: ${h}px; background: #0b0c0f; color: #f4f5f7; font-family: IS; display: grid; place-items: center; overflow: hidden; }
.safe { width: ${safeW}px; display: grid; justify-items: center; gap: ${Math.round(logoH * 0.55)}px; text-align: center; }
p { font-size: ${Math.round(logoH * 0.36)}px; color: #a3a8b5; text-wrap: balance; }
</style></head><body><div class="safe">${logo(logoH, "#f4f5f7")}<p>${descriptor}</p></div></body></html>`;

// ---- 3. social cards
async function build() {
  const p = Bun.spawn(["bun", "run", "build"], { cwd: site, stdout: "ignore", stderr: "inherit" });
  if ((await p.exited) !== 0) throw new Error("site build failed");
}
async function htmlFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory() && e.name !== "_astro" && e.name !== "packs") out.push(...(await htmlFiles(p)));
    else if (e.name.endsWith(".html") && e.name !== "404.html") out.push(p);
  }
  return out;
}
const pathOf = (file: string) => {
  const r = relative(join(site, "dist"), file).replace(/\.html$/, "");
  return r === "index" ? "/" : `/${r}`;
};
const cardName = (path: string) => (path === "/" ? "home" : path.slice(1).replaceAll("/", "-"));

type Hero = { eyebrow: string; title: string; lede: string; alt: string; picture: string | null };

/** Reads a built page's hero: the text above the first section, and the picture there if there is one. */
async function readHero(page: Page): Promise<Hero> {
  const found = await page.evaluate(async () => {
    const main = document.querySelector("main")!;
    const h1 = main.querySelector("h1")!;
    const h2 = main.querySelector("h2");
    const inHero = (el: Element) => !h2 || !!(el.compareDocumentPosition(h2) & Node.DOCUMENT_POSITION_FOLLOWING);
    const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const figure = [...main.querySelectorAll("figure")].find(inHero) ?? null;
    let target: Element | null = null;
    let alt = "";
    if (figure) {
      target = figure.querySelector(":scope > .window") ?? figure.querySelector(":scope > :not(figcaption)") ?? figure;
      alt = figure.querySelector("img[alt]:not([alt=''])")?.getAttribute("alt") ?? figure.querySelector("[role=img][aria-label]")?.getAttribute("aria-label") ?? text(figure.querySelector("figcaption"));
      target.scrollIntoView({ block: "center" });
      await Promise.all([...target.querySelectorAll("img")].map((i) => { i.loading = "eager"; return i.decode().catch(() => {}); }));
      target.setAttribute("data-og-picture", "");
    }
    const eyebrow = [...main.querySelectorAll(".eyebrow")].find((e) => e.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING);
    return { eyebrow: text(eyebrow ?? null), title: text(h1), lede: text(main.querySelector(".lede")), alt, hasPicture: !!target };
  });
  let picture: string | null = null;
  if (found.hasPicture) {
    await page.waitForTimeout(300);
    picture = (await page.locator("[data-og-picture]").screenshot({ type: "png", animations: "disabled" })).toString("base64");
  }
  return { eyebrow: found.eyebrow, title: found.title, lede: found.lede, alt: found.alt, picture };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** A lede trimmed to its first sentences, at most about three lines on the card. */
const short = (s: string, max = 150) => {
  let out = "";
  for (const sentence of s.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [s]) {
    if (out && (out + sentence).length > max) break;
    out += sentence;
  }
  return out.trim();
};

const card = (h: Hero) => `<!doctype html><html><head><style>${fonts}
body { width: 1200px; height: 630px; background: #fff; color: #16181e; font-family: IS; overflow: hidden; position: relative; }
.card { position: absolute; inset: 0; padding: 56px 60px; display: grid; grid-template-columns: ${h.picture ? "440px minmax(0, 1fr)" : "minmax(0, 1fr) 300px"}; gap: 48px; }
.copy { display: flex; flex-direction: column; min-height: 0; }
.text { margin-block: auto; display: grid; gap: 18px; }
.eyebrow { font: 600 15px/1 IS; letter-spacing: 0.16em; text-transform: uppercase; color: #5b606b; }
h1 { font: 700 var(--fs, 56px)/1.04 SG; letter-spacing: -0.035em; text-wrap: balance; }
p.lede { font-size: 22px; line-height: 1.35; color: #4b505c; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.url { font: 500 17px/1 IS; color: #5b606b; }
.pic { align-self: center; justify-self: center; display: grid; place-items: center; max-height: 518px; min-width: 0; }
.pic img { display: block; max-width: 100%; max-height: 518px; border-radius: 14px; box-shadow: 0 24px 60px -24px #0b0c0f66; }
.v { align-self: center; justify-self: center; }
.live { position: absolute; left: 0; right: 0; bottom: 0; height: 8px; background: ${LIVE}; }
</style></head><body><div class="card">
<div class="copy">${logo(30, "#16181e")}
<div class="text">${h.eyebrow ? `<p class="eyebrow">${esc(h.eyebrow)}</p>` : ""}<h1>${esc(h.title)}</h1>${h.lede ? `<p class="lede">${esc(short(h.lede))}</p>` : ""}</div>
<p class="url">viewswitcher.com</p></div>
${h.picture ? `<div class="pic"><img src="data:image/png;base64,${h.picture}" alt=""></div>` : `<div class="v">${bigV(300, "#16181e")}</div>`}
</div><div class="live"></div></body></html>`;

/** Shrinks the card's headline until it fits in its lines (four with no picture beside it, else three). */
async function fit(page: Page, lines: number) {
  await page.evaluate((lines) => {
    const h1 = document.querySelector("h1") as HTMLElement;
    for (let fs = 56; fs >= 34; fs -= 2) {
      h1.style.setProperty("--fs", `${fs}px`);
      if (h1.getBoundingClientRect().height <= fs * 1.04 * lines + 2) break;
    }
  }, lines);
}

await build();
const dist = join(site, "dist");
const server = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    for (const c of [path, `${path}.html`, join(path, "index.html")]) {
      const f = join(dist, c);
      if (f.startsWith(dist) && existsSync(f) && !(await Bun.file(f).stat()).isDirectory()) return new Response(Bun.file(f));
    }
    return new Response("not found", { status: 404 });
  },
});
const ogDir = join(pub, "og");
await rm(ogDir, { recursive: true, force: true });
await mkdir(ogDir, { recursive: true });
const manifest: Record<string, { image: string; alt: string }> = {};

const browser = await chromium.launch({ channel: "chrome" });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const shot = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  const render = async (html: string, w: number, h: number, file: string, jpeg = false) => {
    await shot.setViewportSize({ width: w, height: h });
    await shot.setContent(html, { waitUntil: "load" });
    await shot.evaluate(() => document.fonts.ready);
    return { shot, done: async () => {
      const buf = await shot.screenshot({ type: "png" });
      await (jpeg ? sharp(buf).jpeg({ quality: 86, mozjpeg: true }) : sharp(buf).png({ compressionLevel: 9 })).toFile(file);
    } };
  };

  for (const [w, h, safe, logoH, name] of [[1500, 500, 1100, 96, "viewswitcher-x-header.png"], [2560, 1440, 1400, 120, "viewswitcher-youtube-banner.png"]] as const) {
    await (await render(banner(w, h, safe, logoH), w, h, join(kit, name))).done();
  }

  for (const file of (await htmlFiles(dist)).sort()) {
    const path = pathOf(file);
    await page.goto(`http://127.0.0.1:${server.port}${path}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const hero = await readHero(page);
    const name = `${cardName(path)}.jpg`;
    const r = await render(card(hero), 1200, 630, join(ogDir, name), true);
    await fit(r.shot, hero.picture ? 3 : 4);
    await r.done();
    manifest[path] = { image: `/og/${name}`, alt: `ViewSwitcher: ${hero.title}${/[.!?]$/.test(hero.title) ? "" : "."}${hero.alt ? ` ${hero.alt}` : ""}` };
    console.log(`og/${name}  ${hero.picture ? "with picture" : "text"}  ${hero.title}`);
  }
} finally {
  await browser.close();
  server.stop(true);
}
await writeFile(join(site, "src/data/og.json"), JSON.stringify(manifest, null, 2) + "\n");
await rm(join(pub, "og.png"), { force: true });
console.log("wrote public/favicon.svg, favicon.ico, apple-touch-icon.png, public/brand/*, public/og/*.jpg, src/data/og.json");
