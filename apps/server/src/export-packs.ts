// Export the starter kit and the site's six example shows as template packs (EDIT-27, EDIT-29): the
// format proven on real sets of views, and the app's built-in template sets for any org.
//
//   bun run packs:export [out-dir]      (default: dist/packs → <id>/ and <id>.zip for each)
//
// Both link their shared files as /library/{{ORG_ID}}/templates/_shared/…, because they're copied in
// as an org's own templates. In a pack they're the set's own: {{PACK}}/_shared/….
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

type Manifest = { id: string; name: string; description: string; version?: string; author?: string };
const relink = (t: string) => t.replaceAll("/library/{{ORG_ID}}/templates/", "{{PACK}}/");

/**
 * A pack from views (name → html, in order) and _shared files (path → bytes or text), relinked to
 * {{PACK}} and checked with the same validator installs use: an export that wouldn't install, or
 * that warns, fails here rather than on someone's Mac.
 */
export function buildPack(m: Manifest, views: [string, string][], shared: [string, Uint8Array | string][]): PackFileOut[] {
  const enc = new TextEncoder();
  const files: PackFileOut[] = [];
  const texts: Record<string, string> = {};
  const add = (path: string, data: Uint8Array | string) => {
    const text = typeof data === "string" ? relink(data) : null;
    const bytes = text !== null ? enc.encode(text) : (data as Uint8Array);
    files.push({ path, data: bytes });
    if (PACK_TEXT.test(path)) texts[path] = text ?? new TextDecoder().decode(bytes);
  };
  for (const [v, html] of views) add(`templates/${v}.html`, html);
  for (const [f, data] of shared) add(`_shared/${f}`, data);
  const used = new Set<string>();
  for (const t of Object.values(texts)) for (const x of t.matchAll(/\{\{([A-Z_]+)\}\}/g)) used.add(x[1]!);
  const manifest = {
    format: 1, id: m.id, name: m.name, version: m.version ?? "1.0.0", description: m.description, author: m.author ?? "ViewSwitcher",
    views: views.map(([v]) => v),
    placeholders: PACK_PLACEHOLDERS.filter((p) => used.has(p)),
  };
  files.unshift({ path: "pack.json", data: enc.encode(JSON.stringify(manifest, null, 2) + "\n") });
  texts["pack.json"] = JSON.stringify(manifest);
  const plan = planPack(files.map((f) => ({ path: f.path, size: f.data.length, type: "file" })));
  if (!plan.ok) throw new Error(`${m.id} pack: ${plan.error}`);
  const report = checkPack(plan.files, texts);
  if (!report.ok) throw new Error(`${m.id} pack: ${report.error}`);
  if (report.warnings.length) throw new Error(`${m.id} pack: ${report.warnings.join("; ")}`);
  return files;
}

/** _shared/ files of a folder, text as text (so it's relinked), everything else as bytes. */
async function sharedOf(dir: string, skip: string[] = []): Promise<[string, Uint8Array | string][]> {
  const out: [string, Uint8Array | string][] = [];
  for (const f of await walk(dir)) {
    if (skip.includes(f)) continue;
    out.push([f, PACK_TEXT.test(f) ? await readFile(join(dir, f), "utf8") : new Uint8Array(await readFile(join(dir, f)))]);
  }
  return out;
}

/** The starter kit (apps/server/starter) as a pack. */
export async function starterPack(starter: string, version = "1.0.0"): Promise<PackFileOut[]> {
  const tpl = join(starter, "templates");
  const names = (await readdir(tpl)).filter((f) => f.endsWith(".html")).map((f) => f.slice(0, -5));
  const order: string[] = JSON.parse(await readFile(join(tpl, "_shared/order.json"), "utf8").catch(() => "{}")).order ?? [];
  names.sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999) || a.localeCompare(b));
  const views: [string, string][] = await Promise.all(names.map(async (v) => [v, await readFile(join(tpl, `${v}.html`), "utf8")] as [string, string]));
  return buildPack(
    { id: "starter", name: "Starter", version, description: "ViewSwitcher's neutral views (starting soon, teaching, whiteboard, be right back, ending) in the org's own name and colors." },
    views,
    await sharedOf(join(tpl, "_shared"), ["order.json"]), // the pack's order is pack.json's views
  );
}

type SiteShow = { id: string; name: string; initial: string; kind: string; accent: string; ground: string; blurb: string; views: { file: string }[] };

const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Show content a site view may mark for the site's renders only (apps/site/scripts/library.ts fills
 * them with the show's data); a pack gets this generic sample text instead, which people retype.
 */
export const SITE_SAMPLES: Record<string, string> = { EPISODE: "Episode title" };

/**
 * A site show's view, made generic (EDIT-29): the show's name becomes {{ORG_NAME}} (as typed, run
 * together over a <br>, or in capitals, which keep their look), its <title> loses the show's name
 * (the cover reads "Pregame", not "Full Count · Pregame"), and show-only content marked with a
 * SITE_SAMPLES placeholder ({{EPISODE}}) becomes generic sample text.
 */
export function genericView(html: string, show: SiteShow): string {
  let out = html.replace(new RegExp(`<title>\\s*${esc(show.name)}\\s*·\\s*`), "<title>");
  for (const [k, v] of Object.entries(SITE_SAMPLES)) out = out.replaceAll(`{{${k}}}`, v);
  // The name as its words, however they're spaced or broken: "Full<br>Count", "Roam with<br/>Remi".
  const gap = String.raw`(?:\s|&nbsp;|&#160;|<br\s*/?>)+`;
  const words = show.name.split(/\s+/).map((w) => esc(w).replace(/&/g, "(?:&|&amp;)")).join(gap);
  const upper = show.name.toUpperCase();
  if (upper !== show.name) {
    const caps = upper.split(/\s+/).map((w) => esc(w).replace(/&/g, "(?:&|&amp;)")).join(gap);
    // In capitals, as the whole text of an element (or beside other capitals: "ROAM WITH REMI · DAY 4"):
    // the element keeps the look with text-transform on itself, so it stays one piece of plain text
    // people can retype. Never on a void element (<br>, <img>…): that falls through to a span.
    const notVoid = "(?!(?:area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)\\b)";
    out = out.replace(new RegExp(`<${notVoid}([a-z][\\w-]*)([^>]*)>([^<]*?)${caps}([^<]*)`, "g"), (m: string, tag: string, attrs: string, before: string, after: string) => {
      if (/[a-z]/.test(before + after)) return m; // lower-case text beside it would turn capitals too: a span instead
      const q = /\sstyle=(["'])(.*?)\1/.exec(attrs);
      const styled = q
        ? attrs.replace(q[0], () => ` style=${q[1]}${q[2]!.replace(/;?\s*$/, "")}; text-transform: uppercase${q[1]}`)
        : `${attrs} style="text-transform: uppercase"`;
      return `<${tag}${styled}>${before}{{ORG_NAME}}${after}`;
    });
    // Inside a tag (an alt, a title, a data- value): the plain name, no markup.
    out = out.replace(new RegExp(`${caps}(?=[^<]*>)`, "g"), "{{ORG_NAME}}");
    // Anywhere else in text (after other markup, beside lower-case words): a span keeps the look.
    out = out.replace(new RegExp(caps, "g"), `<span style="text-transform: uppercase">{{ORG_NAME}}</span>`);
  }
  out = out.replace(new RegExp(words, "g"), "{{ORG_NAME}}");
  // Fail rather than ship another show's branding: compare as people read it, in any case and spacing.
  // Tags become their attribute values, so a name left in an alt or a title counts too.
  const read = (t: string) =>
    t.replace(/<[^>]*>/g, (tag) => ` ${tag.replace(/^<\/?\S+|\/?>$/g, "")} `).replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").toLowerCase();
  if (read(out).includes(read(show.name))) throw new Error(`${show.id}: the show's name is still in a view`);
  return out;
}

/**
 * A site show's theme, made generic: its ground and every variable set to its accent become
 * {{GROUND}} and {{ACCENT}}. Other palette colors stay: they're the look (a panel that happens to
 * share the show's ground keeps it, as a paper ground does: Remi and Kitchen keep theirs in
 * --paper-ground, since an org's dark ground under dark ink wouldn't read).
 */
export function genericTheme(css: string, show: SiteShow): string {
  // Lookbehinds: a match mustn't use up the ";" the next declaration starts after (compact CSS).
  const ground = new RegExp(`(?<=^|[;{\\s])--ground:\\s*${esc(show.ground)};`, "i");
  const accent = new RegExp(`(?<=^|[;{\\s])(--[\\w-]+:\\s*)${esc(show.accent)};`, "gi");
  if (!ground.test(css) || !new RegExp(accent.source, "i").test(css)) throw new Error(`${show.id}: theme.css has no --ground ${show.ground} or no variable set to the accent ${show.accent}`);
  const paper = /\.ground\.paper\s*\{[^}]*var\(--ground\)/.test(css);
  let out = css.replace(ground, paper ? `--ground: {{GROUND}};\n  --paper-ground: ${show.ground};` : "--ground: {{GROUND}};");
  if (paper) out = out.replace(/(\.ground\.paper\s*\{[^}]*)var\(--ground\)/, "$1var(--paper-ground)");
  return out.replace(accent, "$1{{ACCENT}};");
}

/**
 * The site's example shows (apps/site/scripts/shows/<id>/, listed in apps/site/src/data/shows.ts) as
 * template packs, one each, generic: filled with the installing org's name and colors. The site's own
 * renders fill the same placeholders with the show's (apps/site/scripts/library.ts). Its views in the
 * site's order, its theme.css, and the shared base.css and view.js.
 */
export async function sitePacks(site: string, onError?: (id: string, e: Error) => void): Promise<{ id: string; files: PackFileOut[] }[]> {
  const { SHOWS } = (await import(join(site, "src/data/shows.ts"))) as { SHOWS: SiteShow[] };
  const styles = join(site, "scripts/shows");
  const common = await sharedOf(join(styles, "_shared"));
  const out = [];
  for (const s of SHOWS) {
    try {
      const views: [string, string][] = await Promise.all(s.views.map(async (v) => [v.file, genericView(await readFile(join(styles, s.id, `${v.file}.html`), "utf8"), s)] as [string, string]));
      const theme = genericTheme(await readFile(join(styles, s.id, "theme.css"), "utf8"), s);
      const id = s.id.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      out.push({ id, files: buildPack({ id, name: s.name, description: `${s.kind} templates, from viewswitcher.com's examples. ${s.blurb}` }, views, [...common, ["theme.css", theme]]) });
    } catch (e) {
      // packs:export and the site build fail on any bad show; the app (onError) skips just that one.
      if (!onError) throw e;
      onError(s.id, e as Error);
    }
  }
  return out;
}

/** A pack's files as a zip with one wrapping folder, the way Finder's Compress makes one. */
export const zipPack = (id: string, files: PackFileOut[]) => writeZip(files.map((f) => ({ name: `${id}/${f.path}`, data: f.data })));

if (import.meta.main) {
  const repo = resolve(import.meta.dir, "../../..");
  const out = resolve(process.argv[2] ?? join(repo, "dist/packs"));
  const packs = [{ id: "starter", files: await starterPack(join(repo, "apps/server/starter")) }, ...(await sitePacks(join(repo, "apps/site")))];
  for (const { id, files } of packs) {
    const dir = join(out, id);
    await rm(dir, { recursive: true, force: true });
    for (const f of files) {
      await mkdir(dirname(join(dir, f.path)), { recursive: true });
      await writeFile(join(dir, f.path), f.data);
    }
    await writeFile(join(out, `${id}.zip`), zipPack(id, files));
    console.log(`wrote ${join(out, `${id}.zip`)} (${files.length} files)`);
  }
}
