// Renders real scenes from a copy of the ViewSwitcher library into the site's images.
//
//   bun run shots                         (from apps/site)
//
// It starts the switcher server on PORT 7432 with OBS offline, no USB bridge and
// VIEWSWITCHER_LIBRARY pointing at a COPY of the library, kept outside the repo so org scene
// content can never be committed (default: $TMPDIR/viewswitcher-shots-library; override with SHOTS_LIBRARY). If something already answers on 7432 it uses that.
// Each scene is opened at 1920×1080 in preview mode (ground painted), with the dashed slot
// labels hidden; the site draws its own Camera/Screen/iPad stand-ins over the slot boxes,
// whose rectangles are written to src/data/scenes.json. Only rendered images enter the repo.
import { chromium } from "playwright-core";
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { SCENES } from "../src/data/scene-list";

const site = resolve(import.meta.dir, "..");
const repo = resolve(site, "../..");
const port = Number(process.env.SHOTS_PORT ?? 7432);
const base = `http://127.0.0.1:${port}`;
const library = resolve(process.env.SHOTS_LIBRARY ?? join(tmpdir(), "viewswitcher-shots-library"));

if (port === 7420) throw new Error("7420 is the live switcher; use another port");

async function up(): Promise<boolean> {
  try { await fetch(base); return true; } catch { return false; }
}

let server: ReturnType<typeof Bun.spawn> | undefined;
if (!(await up())) {
  if (!(await Bun.file(join(library, "daisy/org.json")).exists()))
    throw new Error(`No library copy at ${library}. Copy it first: cp -R "$HOME/ViewSwitcher Library" ${library}`);
  server = Bun.spawn(["bun", join(repo, "apps/server/src/index.ts")], {
    env: { ...process.env, PORT: String(port), OBS_URL: "ws://127.0.0.1:1", VIEWSWITCHER_USB: "0", VIEWSWITCHER_LIBRARY: library },
    stdout: "ignore", stderr: "inherit",
  });
  for (let i = 0; i < 50 && !(await up()); i++) await Bun.sleep(200);
  if (!(await up())) throw new Error(`server did not start on ${port}`);
}

const HIDE_LABELS = `.preview .slot { background: transparent !important; } .preview .slot::before { display: none !important; }`;

type Slot = { name: string; x: number; y: number; w: number; h: number; round: boolean };
const out: Record<string, { slots: Slot[] }> = {};

const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await mkdir(join(site, "src/assets/scenes"), { recursive: true });
  for (const scene of SCENES) {
    const res = await page.goto(`${base}/library/${scene.path}?preview`, { waitUntil: "networkidle" });
    if (!res?.ok()) throw new Error(`${scene.path}: HTTP ${res?.status()}`);
    await page.addStyleTag({ content: HIDE_LABELS });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const slots = await page.$$eval("[data-slot]", (els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      const radius = getComputedStyle(el).getPropertyValue("--radius").trim();
      return { name: (el as HTMLElement).dataset.slot!, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), round: radius === "50%" };
    }));
    const png = await page.screenshot({ type: "png" });
    const file = join(site, "src/assets/scenes", `${scene.id}.webp`);
    await sharp(png).webp({ quality: 88, effort: 6 }).toFile(file);
    out[scene.id] = { slots };
    console.log(`${scene.id.padEnd(22)} ${scene.path}  slots: ${slots.map((s) => s.name).join(", ") || "none"}`);
  }
} finally {
  await browser.close();
  server?.kill();
}

await writeFile(join(site, "src/data/scenes.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${Object.keys(out).length} scenes`);
