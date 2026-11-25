// The app's built-in template packs (EDIT-29): the neutral starter set and the site's six example
// shows, generic, so each installs filled with the org's name and colors. They come from the same
// source as the site's renders and downloads (export-packs.ts):
//
// - the Mac app ships them prebuilt (`bun run packs:export` into Contents/Resources/packs, at
//   VIEWSWITCHER_PACKS): one folder per pack, as packs:export writes them;
// - a source run (no VIEWSWITCHER_PACKS) builds them from the repo when the server starts.
//
// They install through the same path as a dropped pack (packs.ts: stage, preview, install), as their
// own template set.
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { readManifest } from "@viewswitcher/shared";
import { type PackFileOut, sitePacks, starterPack } from "./export-packs";

export type BuiltinPack = { id: string; name: string; description: string; views: string[]; files: PackFileOut[] };

async function walk(dir: string, base = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(join(dir, e.name), rel)));
    else if (e.isFile()) out.push(rel);
  }
  return out.sort();
}

function describe(id: string, files: PackFileOut[]): BuiltinPack | null {
  const pack = files.find((f) => f.path === "pack.json");
  const m = pack && readManifest(new TextDecoder().decode(pack.data));
  if (!m?.ok) return null;
  return { id, name: m.manifest.name, description: m.manifest.description, views: m.manifest.views, files };
}

/** Prebuilt packs: `<dir>/<id>/pack.json` and the rest, as packs:export writes them. */
export async function readBuiltins(dir: string): Promise<BuiltinPack[]> {
  const out: BuiltinPack[] = [];
  for (const id of (await readdir(dir)).sort()) {
    const d = join(dir, id);
    if (id.startsWith(".") || !(await stat(d)).isDirectory()) continue;
    const files = await Promise.all((await walk(d)).map(async (p) => ({ path: p, data: new Uint8Array(await readFile(join(d, p))) })));
    const b = describe(id, files);
    if (b) out.push(b);
  }
  return order(out);
}

/** From the repo's sources: the starter kit, and the site's shows when the site is there. */
export async function buildBuiltins(starter: string, site: string | null): Promise<BuiltinPack[]> {
  const packs = [{ id: "starter", files: await starterPack(starter) }];
  if (site) packs.push(...(await sitePacks(site)));
  return order(packs.map((p) => describe(p.id, p.files)).filter((b): b is BuiltinPack => !!b));
}

/** Starter first, then the site's order. */
const SITE_ORDER = ["starter", "fullcount", "nova", "grace", "remi", "riverside", "kitchen"];
const order = (packs: BuiltinPack[]) => packs.sort((a, b) => (SITE_ORDER.indexOf(a.id) + 1 || 99) - (SITE_ORDER.indexOf(b.id) + 1 || 99) || a.id.localeCompare(b.id));

/** The files of a built-in pack as stagePack takes a dropped folder's. */
export const asDropped = (b: BuiltinPack) => b.files.map((f) => ({ path: f.path, data: new File([f.data], f.path.split("/").pop()!) }));
