// What the template pages (/templates, /templates/<set>) say about each set, from the same sources the
// packs are built from: packages/packs (src/shows.ts and shows/<id>/theme.css, its fonts) and CREDITS.md (photos).
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseCredits, fontsFromCss, type Credit } from "./credits";
import credits from "../../CREDITS.md?raw";
import { SHOWS, type Show } from "@viewswitcher/packs/shows";

// Vite needs the glob written out: packages/packs/shows/<id>/theme.css.
const themes = import.meta.glob<string>("../../../../packages/packs/shows/*/theme.css", { query: "?raw", import: "default", eager: true });

const CREDITS = parseCredits(credits);

/** The fonts a set loads from Google Fonts, from its theme.css. */
export function fontsOf(id: string): string[] {
  const css = Object.entries(themes).find(([path]) => path.endsWith(`/shows/${id}/theme.css`))?.[1];
  if (css === undefined) throw new Error(`packages/packs/shows/${id}/theme.css is missing`);
  return fontsFromCss(css);
}

/** The photos a set's previews use, each with its credit. */
export function creditsOf(show: Show): Credit[] {
  const names = [...new Set(show.views.flatMap((v) => Object.values(v.media ?? {})))];
  return names.map((n) => {
    const c = CREDITS[n];
    if (!c) throw new Error(`CREDITS.md has no row for src/assets/media/${n}`);
    return c;
  });
}

/** The pack's URL and, once scripts/packs.ts has built it, its size. */
export function packOf(show: Show): { href: string; kb: number | null } {
  const href = `/packs/${show.id}.zip`;
  const file = join(process.cwd(), "public", href); // astro build runs in apps/site, after scripts/packs.ts
  return { href, kb: existsSync(file) ? Math.max(1, Math.round(statSync(file).size / 1024)) : null };
}

export const setPath = (show: Show) => `/templates/${show.slug}`;
export const related = (show: Show) => SHOWS.filter((s) => s.id !== show.id);
