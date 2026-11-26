// Installing template packs. A pack arrives as a .zip or a dropped folder's files.
//
// 1. stage: list it, check every path and size before anything is written (planPack), unpack it into
//    <org>/.viewswitcher/staging/<token>/raw (inside the org, so preview paths start with its id), check what it is (checkPack), and write a preview
//    copy, filled in for the org, that the switcher shows as covers before anyone says Install.
// 2. install: fill the raw copy in for the org into staging/<token>/final, then rename that folder to
//    <org>/templates/<set>. Nothing reaches the org until that one rename, so a failed install (or a
//    bad pack) leaves nothing behind.
// 3. remove a set: delete its folder, unless scenes made from it still use its theme and pictures:
//    then only its views and pack.json go, so those scenes keep their look.
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { checkPack, fillPlaceholders, installedPath, isTextFile, libraryUrl, PACK_LIMITS, placeholderVars, planPack, readTitle } from "@viewswitcher/shared";
import type { PackEntry, PackFile, PackManifest, StagedPack } from "@viewswitcher/shared";
import { writeAtomic } from "./atomic";
import { exists, readOrg } from "./library";
import { resolveInLibrary, STAGING, STAGING_TOKEN } from "./library/contain";
import { limit } from "./limit";
import { inside, PathError, plainName } from "./paths";
import { listZip, readZipEntry, walkFiles, ZipError } from "@viewswitcher/packs";

/** A pack that can't be installed: the message says why, in plain words. */
export class PackError extends Error {}

/** Staged packs nobody installed or cancelled are cleared after this. */
const STAGE_TTL_MS = 60 * 60 * 1000;

export type PackSource = { zip: Uint8Array } | { files: { path: string; data: Blob }[] };

type StageMeta = { org: string; set: string; manifest: PackManifest; files: string[]; created: number };

const tokenOk = (t: unknown): t is string => typeof t === "string" && STAGING_TOKEN.test(t);
const stageDir = (libraryRoot: string, orgId: string, token: string) => inside(libraryRoot, `${plainName(orgId)}/${STAGING}/${token}`);

/** A filesystem error, without the absolute path Node puts in its message (AGENTS.md: none in responses). */
function plainFsError(e: unknown, doing: string): Error {
  if (e instanceof PackError || e instanceof PathError) return e;
  const code = (e as { code?: string })?.code;
  return new PackError(`${doing} failed${code ? ` (${code})` : ""}. Nothing was installed; try again.`);
}

/** The placeholders for `org`, with {{PACK}} pointing at `packUrl`. */
const varsFor = async (libraryRoot: string, orgId: string, packUrl: string) => placeholderVars(await readOrg(libraryRoot, orgId), packUrl);

/** A set folder name the org doesn't have yet (a set someone removed but scenes still use counts as taken). */
async function freeSet(orgDir: string, id: string) {
  let name = id, n = 2;
  while (await exists(join(orgDir, "templates", name))) name = `${id}-${n++}`;
  return plainName(name);
}

/** Copy `raw` to `dest` with every text file filled in. */
async function fillCopy(raw: string, dest: string, files: string[], vars: ReturnType<typeof placeholderVars>) {
  for (const f of files) {
    const from = inside(raw, f);
    const to = inside(dest, installedPath(f));
    await mkdir(dirname(to), { recursive: true });
    if (isTextFile(f)) await writeFile(to, fillPlaceholders(f, await readFile(from, "utf8"), vars), { flag: "wx" });
    else await writeFile(to, new Uint8Array(await readFile(from)), { flag: "wx" });
  }
}

/** Clear staged packs older than an hour (a closed tab never cancels its own). */
export async function sweepStaging(libraryRoot: string) {
  const now = Date.now();
  for (const org of await readdir(libraryRoot).catch(() => [] as string[])) {
    if (org.startsWith(".")) continue;
    const dir = join(libraryRoot, org, STAGING);
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      const s = await stat(join(dir, name)).catch(() => null);
      if (s && now - s.mtimeMs > STAGE_TTL_MS) await rm(join(dir, name), { recursive: true, force: true });
    }
  }
}

export async function stagePack(libraryRoot: string, orgId: string, source: PackSource, starterScript: string | null): Promise<StagedPack> {
  const orgDir = inside(libraryRoot, plainName(orgId));
  if (!(await exists(join(orgDir, "org.json")))) throw new PathError("That org doesn't exist");
  await sweepStaging(libraryRoot);

  // 1. What's in it, before anything is unpacked or written.
  let entries: PackEntry[];
  let read: (from: string) => Promise<Uint8Array>;
  if ("zip" in source) {
    if (source.zip.length > PACK_LIMITS.zipBytes) throw new PackError(`It's over ${PACK_LIMITS.zipBytes / 1024 / 1024} MB`);
    let list;
    try {
      list = listZip(source.zip);
    } catch (e) {
      throw new PackError(e instanceof ZipError ? e.message : "It isn't a zip file");
    }
    entries = list.map((e) => ({ path: e.name, size: e.size, type: e.type }));
    const byName = new Map(list.map((e) => [e.name, e]));
    read = async (from) => {
      try {
        return await readZipEntry(source.zip, byName.get(from)!);
      } catch (e) {
        throw new PackError(e instanceof ZipError ? e.message : `Couldn't unpack "${from}"`);
      }
    };
  } else {
    entries = source.files.map((f) => ({ path: f.path, size: f.data.size, type: "file" as const }));
    const byPath = new Map(source.files.map((f) => [f.path, f.data]));
    read = async (from) => new Uint8Array(await byPath.get(from)!.arrayBuffer());
  }
  const plan = planPack(entries);
  if (!plan.ok) throw new PackError(plan.error);

  // 2. Unpack into staging (only the planned files, each checked to land inside it once more).
  const token = randomBytes(12).toString("hex");
  const dir = stageDir(libraryRoot, orgId, token);
  const raw = join(dir, "raw");
  try {
    const texts: Record<string, string> = {};
    let bytes = 0;
    for (const f of plan.files) {
      const data = await read(f.from);
      if (data.length !== f.size) throw new PackError(`"${f.path}" isn't the size it says`);
      bytes += data.length;
      const to = inside(raw, f.path);
      await mkdir(dirname(to), { recursive: true });
      await writeFile(to, data, { flag: "wx" });
      if (isTextFile(f.path)) texts[f.path] = new TextDecoder().decode(data);
    }

    // 3. Is it a pack?
    const report = checkPack(plan.files, texts);
    if (!report.ok) throw new PackError(report.error);
    const set = await freeSet(orgDir, report.manifest.id);
    const files = plan.files.map((f: PackFile) => f.path);

    // 4. A preview copy for the covers, filled in for this org.
    const previewRel = `${plainName(orgId)}/${STAGING}/${token}/preview`;
    const previewVars = await varsFor(libraryRoot, orgId, libraryUrl(previewRel));
    await fillCopy(raw, join(dir, "preview"), files, previewVars);
    // A cover's caption is the filled view's title, as the cover above it shows it ("Daisy Debate · Live").
    const label = (v: { file: string; name: string }) => readTitle(fillPlaceholders(v.file, texts[v.file] ?? "", previewVars)) ?? v.name.replace(/-/g, " ");
    const views = report.views.map((v) => ({ name: v.name, label: label(v), path: `${previewRel}/${installedPath(v.file)}` }));
    const sceneJs = texts["_shared/scene.js"];
    const standard = sceneJs !== undefined && starterScript !== null && hash(sceneJs) === hash(starterScript);
    const meta: StageMeta = { org: orgId, set, manifest: report.manifest, files, created: Date.now() };
    await writeAtomic(join(dir, "meta.json"), JSON.stringify(meta));
    return {
      token, set, manifest: report.manifest, views,
      transition: report.transition ? `${previewRel}/${report.transition}` : null,
      scripts: { ...report.scripts, standard },
      warnings: plan.skipped ? [...report.warnings, `Left out ${plan.skipped} hidden or system file${plan.skipped === 1 ? "" : "s"} (like .DS_Store)`] : report.warnings,
      files: files.length,
      bytes,
    };
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw plainFsError(e, "Unpacking it");
  }
}

const hash = (s: string) => createHash("sha256").update(s.replace(/\r\n/g, "\n").trim()).digest("hex");

/** Install a staged pack into its org as templates/<set>/. Returns the set's folder name. */
export async function installPack(libraryRoot: string, orgId: string, token: unknown): Promise<{ set: string }> {
  if (!tokenOk(token)) throw new PackError("That pack isn't ready to install any more. Drop it again.");
  const dir = stageDir(libraryRoot, orgId, token);
  const meta = await readFile(join(dir, "meta.json"), "utf8").then((t) => JSON.parse(t) as StageMeta, () => null);
  if (!meta) throw new PackError("That pack isn't ready to install any more. Drop it again.");
  if (meta.org !== orgId) throw new PackError("That pack was checked for another org. Drop it again here.");
  const orgDir = inside(libraryRoot, plainName(orgId));
  const final = join(dir, "final");
  try {
    const set = await freeSet(orgDir, meta.manifest.id);
    // Where the set goes must really be in the library: templates/ may be a link to somewhere else.
    await resolveInLibrary(libraryRoot, `${plainName(orgId)}/templates/${set}`, { forWrite: true });
    await rm(final, { recursive: true, force: true });
    await fillCopy(join(dir, "raw"), final, meta.files, await varsFor(libraryRoot, orgId, libraryUrl(`${orgId}/templates/${set}`)));
    await mkdir(join(orgDir, "templates"), { recursive: true });
    // Claim the name first: mkdir without recursive fails if the folder appeared meanwhile (two
    // installs at once, an agent), where rename alone would quietly replace an empty one.
    const target = inside(orgDir, `templates/${set}`);
    try {
      await mkdir(target);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new PackError("A set with that name just appeared. Drop the pack again.");
      throw plainFsError(e, "Installing it");
    }
    // The one step that fills the org: atomic, onto the empty folder just claimed.
    await rename(final, target).catch(async (e) => {
      await rmdir(target).catch(() => {}); // only if still empty: never someone else's files
      throw e;
    });
    return { set };
  } catch (e) {
    throw plainFsError(e, "Installing it");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function cancelPack(libraryRoot: string, orgId: string, token: unknown) {
  if (tokenOk(token)) await rm(stageDir(libraryRoot, orgId, token), { recursive: true, force: true });
}

/** Library-relative paths of the org's project scenes that link the set's files. */
async function scenesUsing(orgDir: string, orgId: string, set: string): Promise<number> {
  // As written by hand or by the switcher: plain, or with each segment encoded (libraryUrl).
  const needle = `/library/${orgId}/templates/${set}/`;
  const encoded = `${libraryUrl(`${orgId}/templates/${set}`)}/`;
  const projects = join(orgDir, "projects");
  const read = limit(16); // scenes can be megabytes: read side by side, but not all at once
  // Linked scenes too: a scene that is a link still uses the set through it.
  const scenes = (await walkFiles(projects, { links: true }).catch(() => [] as string[])).filter((rel) => rel.endsWith(".html"));
  const uses = await Promise.all(scenes.map((rel) => read(() => readFile(join(projects, rel), "utf8").catch(() => "")).then((t) => t.includes(needle) || t.includes(encoded))));
  return uses.filter(Boolean).length;
}

/**
 * Remove a template set. Scenes already made from it are never touched: if any use its theme or
 * pictures, those files stay (its views and pack.json go, so it leaves Templates) and `kept` says how many.
 */
export async function removeSet(libraryRoot: string, orgId: string, set: string): Promise<{ kept: number }> {
  const orgDir = inside(libraryRoot, plainName(orgId));
  const dir = inside(orgDir, `templates/${plainName(set)}`);
  // What it deletes must really be in the library, not wherever a linked templates/ leads.
  await resolveInLibrary(libraryRoot, `${plainName(orgId)}/templates/${plainName(set)}`, { forWrite: true });
  if (!(await exists(join(dir, "pack.json")))) throw new PathError("That isn't an installed template set");
  const kept = await scenesUsing(orgDir, orgId, set);
  if (kept === 0) {
    await rm(dir, { recursive: true, force: true });
    return { kept };
  }
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isFile() && (e.name.endsWith(".html") || e.name === "pack.json")) await rm(join(dir, e.name));
  }
  return { kept };
}
