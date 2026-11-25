// The scenes skill as a download (SITE-27): /skills/viewswitcher-scenes.zip, for Claude's skill upload.
//
//   bun scripts/skill.ts            (runs before astro build; see package.json)
//
// Zipped from the same folder the Mac app puts in every library (apps/server/library-kit/skills/), so
// the download never drifts from it. The format is what Claude's upload asks for (Customize > Skills >
// Upload a skill): the skill's folder at the root of the zip, named as SKILL.md's `name`, with SKILL.md
// in it. The zip is read back and checked, so one that wouldn't upload fails the build. Build output:
// public/skills/ is gitignored.
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { listZip, readZipEntry, storedZip } from "../../server/src/zip";

const site = resolve(import.meta.dir, "..");
export const SKILL_DIR = resolve(site, "../server/library-kit/skills/viewswitcher-scenes");
const out = join(site, "public/skills");

type File = { name: string; data: Uint8Array };

/** Every file in the skill folder, named `<folder>/<path>`; dotfiles (.DS_Store) are left out. */
export async function skillFiles(dir: string): Promise<File[]> {
  const folder = basename(dir);
  const paths = await readdir(dir, { recursive: true });
  const files: File[] = [];
  for (const path of paths) {
    const abs = join(dir, path);
    if (!(await stat(abs)).isFile()) continue;
    const rel = relative(dir, abs).split(sep);
    if (rel.some((part) => part.startsWith("."))) continue;
    files.push({ name: [folder, ...rel].join("/"), data: new Uint8Array(await readFile(abs)) });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export const skillZip = (files: File[]) => storedZip(files);

/** SKILL.md's frontmatter: the single-line `name:` and `description:` fields. */
function frontmatter(text: string): { name?: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) throw new Error("SKILL.md has no frontmatter");
  const field = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, "m").exec(m[1]!)?.[1]?.trim();
  return { name: field("name"), description: field("description") };
}

/**
 * A zip as Claude's upload sees it: one folder at the root, SKILL.md in it, the folder named as the
 * skill. Limits from the Agent Skills spec (agentskills.io/specification): name up to 64 characters,
 * lowercase letters, digits and hyphens; description non-empty, up to 1024.
 */
export function verifySkillZip(zip: Uint8Array): { name: string; files: number } {
  const entries = listZip(zip).filter((e) => e.type === "file");
  const roots = new Set(entries.map((e) => (e.name.includes("/") ? e.name.split("/")[0]! : "")));
  if (roots.has("")) throw new Error("skill zip: files must be inside the skill's folder, not at the root");
  if (roots.size !== 1) throw new Error(`skill zip: one folder at the root, not ${roots.size}`);
  const [folder] = roots;
  const skill = entries.find((e) => e.name === `${folder}/SKILL.md`);
  if (!skill) throw new Error(`skill zip: no ${folder}/SKILL.md`);
  const { name, description } = frontmatter(new TextDecoder().decode(readZipEntry(zip, skill)));
  if (!name || name !== folder) throw new Error(`skill zip: the folder "${folder}" must match the skill's name "${name ?? ""}"`);
  if (name.length > 64 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) throw new Error(`skill zip: "${name}" isn't a valid skill name`);
  if (!description || description.length > 1024) throw new Error(`skill zip: the description must be 1 to 1024 characters (it's ${description?.length ?? 0})`);
  return { name, files: entries.length };
}

if (import.meta.main) {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const zip = skillZip(await skillFiles(SKILL_DIR));
  const { name, files } = verifySkillZip(zip);
  await writeFile(join(out, `${name}.zip`), zip);
  console.log(`skill: /skills/${name}.zip (${files} files, ${(zip.length / 1024).toFixed(0)} KB) checked`);
}
