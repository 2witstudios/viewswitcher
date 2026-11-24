// Renders the made-up shows' views and the screen-share contents into the site's images.
//
//   bun run shots                         (from apps/site)
//
// 1. scripts/library.ts writes the shows' scratch library (the starter kit restyled per show)
//    OUTSIDE the repo ($TMPDIR/viewswitcher-site-library, or SHOTS_LIBRARY).
// 2. The switcher server starts on SHOTS_PORT (default 7434) with OBS offline and no USB bridge.
// 3. Each view in src/data/shows.ts is opened at 1920×1080 the way OBS shows it: transparent,
//    with holes where the devices go. It's saved with its alpha as src/assets/views/<id>.webp,
//    and its device boxes and ground color go to src/data/views.json. The site stacks
//    ground → photos/screens in the boxes → the view, which is how OBS composites it.
// 4. scripts/screens/*.html (the made-up screen shares) render to src/assets/media/<name>.webp.
// Only rendered images enter the repo, never scene HTML.
import { chromium } from "playwright-core";
import sharp from "sharp";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SHOWS, viewId } from "../src/data/shows";
import { buildLibrary } from "./library";

const site = resolve(import.meta.dir, "..");
const repo = resolve(site, "../..");
const port = Number(process.env.SHOTS_PORT ?? 7434);
const base = `http://127.0.0.1:${port}`;
if (port === 7420) throw new Error("7420 is the live switcher; use another port");

async function up(): Promise<boolean> {
  try { await fetch(base, { signal: AbortSignal.timeout(1000) }); return true; } catch { return false; }
}
if (await up()) throw new Error(`something already answers on ${port}; stop it or set SHOTS_PORT`);

const library = await buildLibrary();
const server = Bun.spawn(["bun", join(repo, "apps/server/src/index.ts")], {
  env: { ...process.env, PORT: String(port), OBS_URL: "ws://127.0.0.1:1", VIEWSWITCHER_USB: "0", VIEWSWITCHER_LIBRARY: library },
  stdout: "ignore", stderr: "inherit",
});
for (let i = 0; i < 50 && server.exitCode === null && !(await up()); i++) await Bun.sleep(200);
if (server.exitCode !== null || !(await up())) { server.kill(); throw new Error(`server did not start on ${port}`); }

export type Slot = { name: string; x: number; y: number; w: number; h: number; radius: string };
const out: Record<string, { ground: string; slots: Slot[] }> = {};
const views: Record<string, Buffer> = {};
const screens: Record<string, Buffer> = {};

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const settle = async () => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
  };
  for (const show of SHOWS) for (const v of show.views) {
    const id = viewId(show.id, v.file);
    const res = await page.goto(`${base}/library/${show.id}/templates/${v.file}.html`, { waitUntil: "networkidle" });
    if (!res?.ok()) throw new Error(`${id}: HTTP ${res?.status()}`);
    // Freeze the countdown at a believable value.
    await page.evaluate(() => document.querySelectorAll("[data-countdown]").forEach((el) => { el.removeAttribute("data-countdown"); el.textContent = "4:32"; }));
    await settle();
    const slots = await page.$$eval("[data-slot]", (els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      const radius = getComputedStyle(el).getPropertyValue("--radius").trim() || "0";
      return { name: (el as HTMLElement).dataset.slot!, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), radius };
    }));
    for (const s of slots) if (!v.media?.[s.name]) throw new Error(`${id}: nothing fills its ${s.name} box (add it to media in shows.ts)`);
    const png = await page.screenshot({ type: "png", omitBackground: true });
    views[id] = await sharp(png).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toBuffer();
    out[id] = { ground: show.ground, slots };
    console.log(`${id.padEnd(28)} slots: ${slots.map((s) => s.name).join(", ") || "none"}`);
  }
  const dir = join(site, "scripts/screens");
  for (const f of (await readdir(dir)).filter((n) => n.endsWith(".html"))) {
    await page.goto(pathToFileURL(join(dir, f)).href, { waitUntil: "networkidle" });
    await settle();
    screens[f.replace(/\.html$/, "")] = await sharp(await page.screenshot({ type: "png" })).webp({ quality: 88, effort: 6 }).toBuffer();
    console.log(`screen ${f}`);
  }
} finally {
  await browser?.close();
  server.kill();
}

await mkdir(join(site, "src/assets/views"), { recursive: true });
for (const [id, webp] of Object.entries(views)) await writeFile(join(site, "src/assets/views", `${id}.webp`), new Uint8Array(webp));
for (const [id, webp] of Object.entries(screens)) await writeFile(join(site, "src/assets/media", `${id}.webp`), new Uint8Array(webp));
await writeFile(join(site, "src/data/views.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${Object.keys(out).length} views and ${Object.keys(screens).length} screens`);
