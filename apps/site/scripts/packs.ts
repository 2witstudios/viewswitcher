// The template packs the site serves: one .zip per example show at /packs/<id>.zip.
//
//   bun scripts/packs.ts            (runs before astro build; see package.json)
//
// Built from the same source as the app's export, `bun run packs:export` (@viewswitcher/packs):
// This only calls it. Each zip is then read back and checked again with the shared validator
// (the one installs use), so a pack that wouldn't install fails the site build instead of someone's Mac.
// The zips are build output: public/packs/ is gitignored.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { listZip, readZipEntrySync, SHOWS, showPacks, zipPack } from "@viewswitcher/packs";
import { checkPack, isTextFile, planPack } from "@viewswitcher/shared";

const site = resolve(import.meta.dir, "..");
const out = join(site, "public/packs");

/** A zip as the switcher would see it: planned, read, and checked; anything off is an error. */
export function verifyZip(id: string, zip: Uint8Array): { views: string[]; files: number } {
  const entries = listZip(zip);
  const plan = planPack(entries.map((e) => ({ path: e.name, size: e.size, type: e.type })));
  if (!plan.ok) throw new Error(`${id}.zip: ${plan.error}`);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const texts: Record<string, string> = {};
  for (const f of plan.files) if (isTextFile(f.path)) texts[f.path] = new TextDecoder().decode(readZipEntrySync(zip, byName.get(f.from)!));
  const report = checkPack(plan.files, texts);
  if (!report.ok) throw new Error(`${id}.zip: ${report.error}`);
  if (report.warnings.length) throw new Error(`${id}.zip: ${report.warnings.join("; ")}`);
  const manifest = JSON.parse(texts["pack.json"]!) as { id: string; views: string[] };
  const show = SHOWS.find((s) => s.id === id);
  if (manifest.id !== id || !show || manifest.views.join() !== show.views.map((v) => v.file).join()) throw new Error(`${id}.zip: its views don't match @viewswitcher/packs' shows.ts`);
  return { views: manifest.views, files: plan.files.length };
}

if (import.meta.main) {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const packs = await showPacks();
  if (packs.length !== SHOWS.length) throw new Error(`expected ${SHOWS.length} packs, got ${packs.length}`);
  for (const { id, files } of packs) {
    const zip = zipPack(id, files);
    const { views, files: n } = verifyZip(id, zip);
    await writeFile(join(out, `${id}.zip`), zip);
    console.log(`packs: /packs/${id}.zip (${views.length} views, ${n} files, ${(zip.length / 1024).toFixed(0)} KB) checked`);
  }
}
