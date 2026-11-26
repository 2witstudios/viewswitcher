// The app's built-in template packs: the neutral starter set and the site's six example shows,
// generic, so each installs filled with the org's name and colors. They come from the same source
// as the site's renders and downloads (@viewswitcher/packs):
//
// - the Mac app ships them prebuilt (`bun run packs:export` into Contents/Resources/packs, at
//   VIEWSWITCHER_PACKS): one folder per pack, as packs:export writes them;
// - a source run (no VIEWSWITCHER_PACKS) builds them from the repo when they're first asked for.
//
// They install through the same path as a dropped pack (packs.ts: stage, preview, install), as their
// own template set.
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { type PackFileOut, SHOWS, showPacks, starterPack, walkFiles } from "@viewswitcher/packs";
import { type BuiltinPack, readManifest } from "@viewswitcher/shared";

/** A built-in pack with its files: what /api/packs/builtin lists (BuiltinPack), and what it installs. */
export type BuiltinPackFiles = BuiltinPack & { files: PackFileOut[] };

function describe(id: string, files: PackFileOut[]): BuiltinPackFiles | null {
  const pack = files.find((f) => f.path === "pack.json");
  const m = pack && readManifest(new TextDecoder().decode(pack.data));
  if (!m?.ok) return null;
  return { id, name: m.manifest.name, description: m.manifest.description, views: m.manifest.views, files };
}

/** Prebuilt packs: `<dir>/<id>/pack.json` and the rest, as packs:export writes them. */
export async function readBuiltins(dir: string): Promise<BuiltinPackFiles[]> {
  const out: BuiltinPackFiles[] = [];
  for (const id of (await readdir(dir)).sort()) {
    const d = join(dir, id);
    if (id.startsWith(".") || !(await stat(d)).isDirectory()) continue;
    const files = await Promise.all((await walkFiles(d)).map(async (p) => ({ path: p, data: new Uint8Array(await readFile(join(d, p))) })));
    const b = describe(id, files);
    if (b) out.push(b);
  }
  return order(out);
}

/** From the repo's sources: the starter kit (at `starter`) and the example shows. */
export async function buildBuiltins(starter: string, onError: (id: string, e: Error) => void = () => {}): Promise<BuiltinPackFiles[]> {
  // Each pack on its own: one that won't build is left out (and reported), never the rest.
  const packs: { id: string; files: PackFileOut[] }[] = [];
  await starterPack(starter).then((files) => packs.push({ id: "starter", files }), (e) => onError("starter", e as Error));
  packs.push(...(await showPacks(onError).catch((e) => (onError("shows", e as Error), []))));
  return order(packs.map((p) => describe(p.id, p.files)).filter((b): b is BuiltinPackFiles => !!b));
}

/** Starter first, then the shows in the site's order. */
const ORDER = ["starter", ...SHOWS.map((s) => s.id)];
const order = (packs: BuiltinPackFiles[]) => packs.sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99) || a.id.localeCompare(b.id));

/** The files of a built-in pack as stagePack takes a dropped folder's. */
export const asDropped = (b: BuiltinPackFiles) => b.files.map((f) => ({ path: f.path, data: new File([f.data], f.path.split("/").pop()!) }));
