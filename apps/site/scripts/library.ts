// Builds the site's scratch library: the six made-up shows, each an org folder (from the starter kit's
// org.json and brand files) whose templates are that show's own style from scripts/shows/<id>/.
// It is written OUTSIDE the repo (default $TMPDIR/viewswitcher-site-library); only the rendered images
// enter the repo. Never point this at ~/ViewSwitcher Library.
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { SHOWS, type Show } from "../src/data/shows";

const starter = resolve(import.meta.dir, "../../server/starter");
const styles = resolve(import.meta.dir, "shows");
export const LIBRARY = resolve(process.env.SHOTS_LIBRARY ?? join(tmpdir(), "viewswitcher-site-library"));

function fill(text: string, s: Show): string {
  return text
    .replaceAll("{{ORG_ID}}", s.id).replaceAll("{{ORG_NAME}}", s.name).replaceAll("{{ORG_INITIAL}}", s.initial)
    .replaceAll("{{ACCENT}}", s.accent).replaceAll("{{GROUND}}", s.ground);
}

export async function buildLibrary(only?: string[]): Promise<string> {
  if (LIBRARY.includes("ViewSwitcher Library")) throw new Error("never write into the real library");
  await rm(LIBRARY, { recursive: true, force: true });
  for (const s of SHOWS.filter((x) => !only || only.includes(x.id))) {
    const dir = join(LIBRARY, s.id);
    const templates = join(dir, "templates");
    // The org's own files (org.json, BRAND.md, the mark) come from the starter; its views don't.
    await cp(starter, dir, { recursive: true });
    for (const f of await readdir(templates)) if (f.endsWith(".html")) await rm(join(templates, f));
    await rm(join(templates, "_shared/theme.css"));
    await rm(join(templates, "_shared/scene.js"));
    await cp(join(styles, "_shared"), join(templates, "_shared"), { recursive: true });
    await cp(join(styles, s.id, "theme.css"), join(templates, "_shared/theme.css"));
    const views = (await readdir(join(styles, s.id))).filter((f) => f.endsWith(".html"));
    for (const v of s.views) if (!views.includes(`${v.file}.html`)) throw new Error(`${s.id}: scripts/shows/${s.id}/${v.file}.html is missing`);
    for (const f of views) await cp(join(styles, s.id, f), join(templates, f));
    await writeFile(join(templates, "_shared/order.json"), JSON.stringify({ order: s.views.map((v) => v.file) }) + "\n");
    for (const f of ["org.json", "BRAND.md", "templates/_shared/brand/mark.svg", ...views.map((v) => `templates/${v}`)]) {
      const p = join(dir, f);
      await writeFile(p, fill(await readFile(p, "utf8"), s));
    }
    await mkdir(join(dir, "projects"), { recursive: true });
  }
  return LIBRARY;
}

if (import.meta.main) console.log(`wrote ${await buildLibrary()}`);
