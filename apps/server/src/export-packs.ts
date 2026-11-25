// Export the starter kit as a style pack (EDIT-27): the format proven on a real set of views, and the
// first pack anyone can install into an org that already has its own templates.
//
//   bun run packs:export [out-dir]      (default: dist/packs → starter/ and starter.zip)
//
// The starter links its shared files as /library/{{ORG_ID}}/templates/_shared/…, because it's copied
// in as the org's own templates. In a pack they're the set's own: {{PACK}}/_shared/….
// The site's example styles (apps/site/scripts/library.ts) export the same way once they land.
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { checkPack, PACK_PLACEHOLDERS, PACK_TEXT, planPack } from "@viewswitcher/shared";
import { writeZip } from "./zip";

export type PackFileOut = { path: string; data: Uint8Array };

async function walk(dir: string, base = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(join(dir, e.name), rel)));
    else out.push(rel);
  }
  return out.sort();
}

/** The starter kit (apps/server/starter) as a pack's files, checked with the same validator installs use. */
export async function starterPack(starter: string, version = "1.0.0"): Promise<PackFileOut[]> {
  const enc = new TextEncoder();
  const files: PackFileOut[] = [];
  const texts: Record<string, string> = {};
  const add = (path: string, data: Uint8Array | string) => {
    const bytes = typeof data === "string" ? enc.encode(data) : data;
    files.push({ path, data: bytes });
    if (PACK_TEXT.test(path)) texts[path] = new TextDecoder().decode(bytes);
  };
  const relink = (t: string) => t.replaceAll("/library/{{ORG_ID}}/templates/", "{{PACK}}/");

  const tpl = join(starter, "templates");
  const views = (await readdir(tpl)).filter((f) => f.endsWith(".html")).map((f) => f.slice(0, -5));
  const order: string[] = JSON.parse(await readFile(join(tpl, "_shared/order.json"), "utf8").catch(() => "{}")).order ?? [];
  views.sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999) || a.localeCompare(b));
  for (const v of views) add(`templates/${v}.html`, relink(await readFile(join(tpl, `${v}.html`), "utf8")));
  for (const f of await walk(join(tpl, "_shared"))) {
    if (f === "order.json") continue; // the pack's order is pack.json's views
    const abs = join(tpl, "_shared", f);
    add(`_shared/${f}`, PACK_TEXT.test(f) ? relink(await readFile(abs, "utf8")) : new Uint8Array(await readFile(abs)));
  }
  const used = new Set<string>();
  for (const t of Object.values(texts)) for (const m of t.matchAll(/\{\{([A-Z_]+)\}\}/g)) used.add(m[1]!);
  const manifest = {
    format: 1,
    id: "starter",
    name: "Starter",
    version,
    description: "ViewSwitcher's neutral views (starting soon, teaching, whiteboard, be right back, ending) in the org's own name and colors.",
    author: "ViewSwitcher",
    views,
    placeholders: PACK_PLACEHOLDERS.filter((p) => used.has(p)),
  };
  files.unshift({ path: "pack.json", data: enc.encode(JSON.stringify(manifest, null, 2) + "\n") });
  texts["pack.json"] = JSON.stringify(manifest);

  // Proven on the real validator: an export that wouldn't install fails here, not on someone's Mac.
  const plan = planPack(files.map((f) => ({ path: f.path, size: f.data.length, type: "file" })));
  if (!plan.ok) throw new Error(`starter pack: ${plan.error}`);
  const report = checkPack(plan.files, texts);
  if (!report.ok) throw new Error(`starter pack: ${report.error}`);
  if (report.warnings.length) throw new Error(`starter pack: ${report.warnings.join("; ")}`);
  return files;
}

/** A pack's files as a zip with one wrapping folder, the way Finder's Compress makes one. */
export const zipPack = (id: string, files: PackFileOut[]) => writeZip(files.map((f) => ({ name: `${id}/${f.path}`, data: f.data })));

if (import.meta.main) {
  const repo = resolve(import.meta.dir, "../../..");
  const out = resolve(process.argv[2] ?? join(repo, "dist/packs"));
  const files = await starterPack(join(repo, "apps/server/starter"));
  const dir = join(out, "starter");
  await rm(dir, { recursive: true, force: true });
  for (const f of files) {
    await mkdir(dirname(join(dir, f.path)), { recursive: true });
    await writeFile(join(dir, f.path), f.data);
  }
  await writeFile(join(out, "starter.zip"), zipPack("starter", files));
  console.log(`wrote ${dir}/ and ${join(out, "starter.zip")} (${files.length} files)`);
}
