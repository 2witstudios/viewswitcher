// Pure helpers for the template pages: photo credits from CREDITS.md and fonts from a theme.css.

export type Credit = { file: string; photo: string; photoUrl: string; by: string; byUrl: string; license: string };

/** The Google Fonts families a stylesheet imports. */
export function fontsFromCss(css: string): string[] {
  const out = new Set<string>();
  for (const m of css.matchAll(/family=([^:&"';)]+)/g)) out.add(decodeURIComponent(m[1]!).replace(/\+/g, " "));
  return [...out];
}

/** CREDITS.md's photo rows, by media name (src/assets/media/<name>.jpg). */
export function parseCredits(md: string): Record<string, Credit> {
  const link = (cell: string) => cell.match(/^\[(.+)\]\((.+)\)$/);
  const out: Record<string, Credit> = {};
  for (const line of md.split("\n")) {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    const m = cells[0]?.match(/^src\/assets\/media\/([\w-]+)\.(jpg|webp)$/);
    if (!m || cells.length < 5) continue;
    const photo = link(cells[2]!), by = link(cells[3]!);
    if (!photo || !by) throw new Error(`CREDITS.md: can't read the row for ${m[1]}`);
    out[m[1]!] = { file: m[1]!, photo: photo[1]!, photoUrl: photo[2]!, by: by[1]!, byUrl: by[2]!, license: cells[4]! };
  }
  return out;
}
