// Real screenshots of the switcher for the site's guides (/setup, /ipad, /church-livestream) and How it works.
//
//   bun scripts/app-shots.ts            (from apps/site)
//
// Starts the switcher on SHOTS_PORT (default 7434) with OBS offline and no USB bridge, against the
// site's scratch library (scripts/library.ts, outside the repo). Makes Grace Community a "Sunday Live"
// project with a dated stream, puts the sermon on air, does the same for a Full Count episode, and saves
// the screens to src/assets/app/*.webp.
// Nothing is staged: what's shown is the app as it runs with OBS closed (camera boxes stay empty).
import { chromium } from "playwright-core";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildLibrary } from "./library";

const site = resolve(import.meta.dir, "..");
const repo = resolve(site, "../..");
const port = Number(process.env.SHOTS_PORT ?? 7434);
const base = `http://127.0.0.1:${port}`;
if (port === 7420) throw new Error("7420 is the live switcher; use another port");
const up = async () => { try { await fetch(base, { signal: AbortSignal.timeout(1000) }); return true; } catch { return false; } };
if (await up()) throw new Error(`something already answers on ${port}; stop it or set SHOTS_PORT`);

const library = await buildLibrary(["grace", "fullcount"]);
const server = Bun.spawn(["bun", join(repo, "apps/server/src/index.ts")], {
  env: { ...process.env, PORT: String(port), OBS_URL: "ws://127.0.0.1:1", VIEWSWITCHER_USB: "0", VIEWSWITCHER_LIBRARY: library },
  stdout: "ignore", stderr: "inherit",
});
for (let i = 0; i < 50 && server.exitCode === null && !(await up()); i++) await Bun.sleep(200);
if (server.exitCode !== null || !(await up())) { server.kill(); throw new Error(`server did not start on ${port}`); }

const post = async (path: string, body: unknown) => {
  const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${await r.text()}`);
  return r.json();
};

const out = join(site, "src/assets/app");
await mkdir(out, { recursive: true });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const { projectId } = await post("/api/projects", { org: "grace", name: "Sunday Live", templates: ["starting-soon", "live", "main", "brb", "ending"] });
  const { streamId } = await post("/api/streams", { org: "grace", projectId, name: "Romans 12", date: "2026-11-29" });
  const sermon = `grace/projects/${projectId}/scenes/main.html`;
  await post("/api/onair", { path: sermon, label: "Sermon", projectId, streamId });

  browser = await chromium.launch({ channel: "chrome" });
  // The Mac app's window: the switcher says ViewSwitcher-Mac in its user agent there.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) ViewSwitcher-Mac/1.0.0" });
  const save = async (name: string, clip?: { x: number; y: number; width: number; height: number }) => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
    const png = await page.screenshot({ type: "png", clip });
    await sharp(png).resize({ width: 2000, withoutEnlargement: true }).webp({ quality: 86, effort: 6 }).toFile(join(out, `${name}.webp`));
    console.log(`wrote src/assets/app/${name}.webp`);
  };
  const stream = `/grace/p/${projectId}/${streamId}`;
  await page.goto(base + stream, { waitUntil: "networkidle" });
  await save("connect-obs", { x: 0, y: 0, width: 1440, height: 300 });
  await page.getByRole("button", { name: "Not now" }).click();
  await save("switcher");
  await page.goto(`${base}/grace/edit?path=${encodeURIComponent(sermon)}`, { waitUntil: "networkidle" });
  await save("editor");

  // How it works, step 2: this week's Full Count stream, with the both-hosts view on air.
  const fc = await post("/api/projects", { org: "fullcount", name: "Full Count", templates: ["starting-soon", "live", "main", "brb", "ending"] });
  const ep = await post("/api/streams", { org: "fullcount", projectId: fc.projectId, name: "Ep. 112 · Trade deadline", date: "2026-11-27" });
  await post("/api/onair", { path: `fullcount/projects/${fc.projectId}/scenes/main.html`, label: "Both hosts", projectId: fc.projectId, streamId: ep.streamId });
  await page.goto(`${base}/fullcount/p/${fc.projectId}/${ep.streamId}`, { waitUntil: "networkidle" });
  if (await page.getByRole("button", { name: "Not now" }).count()) await page.getByRole("button", { name: "Not now" }).click();
  await save("stream-fullcount");
} finally {
  await browser?.close();
  server.kill();
}
