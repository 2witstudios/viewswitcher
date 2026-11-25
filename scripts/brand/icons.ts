// Generates every icon the apps show, from the one logo in apps/site/src/lib/brand.ts (the V of five
// screens stepping down to the one on air). No hand-exported files: change the V there, rerun this.
//   bun run brand:icons     (from the repo root; needs `bun install` for sharp)
//
// 1. Mac app icon (apps/apple/Mac/Assets.xcassets/AppIcon.appiconset, 16–1024): the macOS icon grid, an
//    824 px rounded tile centred on the 1024 canvas with the standard drop shadow, so it sits right in the
//    Dock. A graphite tile with the V in white and the on-air screen red: it matches the switcher's dark
//    UI, the iPad and the site, and at 16 px light screens on a dark tile still read as a V where graphite
//    screens on a light tile go grey and fuzzy. Small sizes (≤ 64 px) draw the V larger in the tile.
// 2. iPad app icon (apps/apple/iPad/Assets.xcassets/AppIcon.appiconset): the same tile full bleed and
//    opaque, no corners (iOS masks it); the 1024 App Store icon has no alpha channel.
// 3. Menu bar (StatusIcon, StatusIconLive imagesets): the V as a black template image (macOS tints it for
//    light and dark bars), 20×16 pt with @2x. On air, the whole V turns red, as the old mark did.
// 4. The switcher (apps/web/public): icon.svg (tab icon: graphite screens on light tabs, white on dark),
//    mark.svg (the sidebar's V, white for the dark UI), icon-180.png (iPad/iPhone home screen),
//    icon-512.png and app-icon.svg (the web manifest). The iPad connector page's icon.svg too.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { iconBody, faviconSvg, vRects, V, LIVE } from "../../apps/site/src/lib/brand";

const repo = resolve(import.meta.dir, "../..");
// sharp is the site's dependency (it renders the site's icons too); load it from there.
const sharp: typeof import("sharp") = createRequire(join(repo, "apps/site/package.json"))("sharp");

const INK = "#f4f5f7"; // the V's screens on the graphite tile
const svgDoc = (w: number, h: number, vb: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb}">${body}</svg>`;
const png = (svg: string) => sharp(Buffer.from(svg), { density: 72 }).png({ compressionLevel: 9 });
/** A tile icon as a PNG, dithered (a fixed seed, so a rerun writes the same bytes) so the ground's
 *  gradient has no 8-bit bands; opaque drops the alpha channel (iOS icons). */
const tilePng = async (svg: string, file: string, opaque = false) => {
  const { data, info } = await sharp(Buffer.from(svg), { density: 72 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let seed = 0x9e3779b9;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const n = Math.round((rand() + rand() - 1) * 1.5);
    for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, data[i + c]! + n));
  }
  let img = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  if (opaque) img = img.removeAlpha();
  await img.png({ compressionLevel: 9 }).toFile(file);
};

/** The V centred in a box of `w` units, `fill` of its width (its own aspect, centred vertically too). */
const vIn = (size: number, fill: number, ink: string, live: string, cx = size / 2, cy = size / 2) => {
  const s = (size * fill) / V.w;
  return `<g transform="translate(${cx - (V.w * s) / 2} ${cy - (V.h * s) / 2}) scale(${s})">${vRects(ink, live)}</g>`;
};

/** The graphite ground: a little lighter at the top, like light falling on it. */
const ground = (id: string, y0: number, y1: number) =>
  `<linearGradient id="${id}" x1="0" y1="${y0}" x2="0" y2="${y1}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#272a31"/><stop offset="1" stop-color="#0b0c0f"/></linearGradient>`;

/** Apple's continuous-corner tile (a superellipse, as in the macOS icon template), as a path. */
const squircle = (x: number, y: number, size: number, n = 5) => {
  const r = size / 2, cx = x + r, cy = y + r, pts: string[] = [];
  for (let i = 0; i < 360; i++) {
    const t = (i / 360) * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
    pts.push(`${(cx + r * Math.sign(c) * Math.abs(c) ** (2 / n)).toFixed(2)} ${(cy + r * Math.sign(s) * Math.abs(s) ** (2 / n)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
};

// ---- 1. Mac: the macOS grid on a 1024 canvas (824 tile at 100, shadow 0 10 blur 10 at 30% black).
const macIcon = (px: number) => {
  const T = 824, O = 100;
  // The V's width in the tile: 58% at Dock sizes, larger where pixels are few.
  const fill = px <= 16 ? 0.78 : px <= 32 ? 0.72 : px <= 64 ? 0.66 : 0.58;
  const path = squircle(O, O, T);
  return svgDoc(px, px, "0 0 1024 1024",
    `<defs>${ground("g", O, O + T)}<filter id="s" color-interpolation-filters="sRGB" x="-10%" y="-10%" width="120%" height="130%"><feGaussianBlur in="SourceAlpha" stdDeviation="10"/><feOffset dy="10"/><feComponentTransfer><feFuncA type="linear" slope="0.3"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>` +
    `<path d="${path}" fill="url(#g)" filter="url(#s)"/>` +
    `<path d="${path}" fill="none" stroke="#fff" stroke-opacity="0.09" stroke-width="${px <= 32 ? 0 : 4}"/>` +
    vIn(1024, (T / 1024) * fill, INK, LIVE));
};

// ---- 2. iPad (and the web's home-screen icon): full bleed, opaque; iOS rounds the corners.
const squareIcon = (px: number) =>
  svgDoc(px, px, "0 0 1024 1024", `<defs>${ground("g", 0, 1024)}</defs><rect width="1024" height="1024" fill="url(#g)"/>` + vIn(1024, 0.6, INK, LIVE));

// ---- 3. Menu bar: 20×16 pt, the V 19 pt wide.
const trayIcon = (scale: number, ink: string, live: string) =>
  svgDoc(20 * scale, 16 * scale, "0 0 20 16", vIn(20, 0.95, ink, live, 10, 8));

const mac = join(repo, "apps/apple/Mac/Assets.xcassets");
const ipad = join(repo, "apps/apple/iPad/Assets.xcassets/AppIcon.appiconset");
const web = join(repo, "apps/web/public");
const out: string[] = [];
const save = async (file: string, data: Promise<unknown> | void) => { await data; out.push(file.slice(repo.length + 1)); };

for (const px of [16, 32, 64, 128, 256, 512, 1024])
  await save(join(mac, `AppIcon.appiconset/icon-${px}.png`), tilePng(macIcon(px), join(mac, `AppIcon.appiconset/icon-${px}.png`)));

for (const px of [20, 29, 40, 58, 76, 80, 152, 167, 1024]) {
  const f = join(ipad, `AppIcon-${px}.png`);
  await save(f, tilePng(squareIcon(px), f, true));
}

for (const [set, name, ink, live] of [
  ["StatusIcon", "trayTemplate", "#000", "#000"],
  ["StatusIconLive", "trayLive", LIVE, LIVE],
] as const) {
  for (const [scale, suffix] of [[1, ""], [2, "@2x"]] as const) {
    const f = join(mac, `${set}.imageset/${name}${suffix}.png`);
    await save(f, png(trayIcon(scale, ink, live)).toFile(f));
  }
}

await mkdir(web, { recursive: true });
await save(join(web, "icon.svg"), writeFile(join(web, "icon.svg"), faviconSvg()));
await save(join(web, "mark.svg"), writeFile(join(web, "mark.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${iconBody(INK)}</svg>\n`));
await save(join(web, "app-icon.svg"), writeFile(join(web, "app-icon.svg"), squareIcon(1024).replace(/ width="1024" height="1024"/, "") + "\n"));
for (const px of [180, 512])
  await save(join(web, `icon-${px}.png`), tilePng(squareIcon(px), join(web, `icon-${px}.png`), true));
const connector = join(repo, "apps/apple/iPad/Connector/icon.svg");
await save(connector, writeFile(connector, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${iconBody(INK)}</svg>\n`));

console.log(`wrote ${out.length} files:\n  ${out.join("\n  ")}`);
