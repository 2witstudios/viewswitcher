// Builds the site's scratch library: four made-up shows, each the starter kit
// (apps/server/starter) restyled with its own colors, type and titles, plus two layouts
// the starter doesn't have yet (a talking head and a two-person interview).
// It is written OUTSIDE the repo (default $TMPDIR/viewswitcher-site-library); only the
// rendered images enter the repo. Never point this at ~/ViewSwitcher Library.
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { SHOWS, type Show } from "../src/data/shows";

const starter = resolve(import.meta.dir, "../../server/starter");
export const LIBRARY = resolve(process.env.SHOTS_LIBRARY ?? join(tmpdir(), "viewswitcher-site-library"));

const font = (f: string) => f.replace(/ /g, "+");

/** The starter's theme with this show's tokens and fonts. */
function theme(css: string, s: Show): string {
  const t = s.theme;
  const fonts = `@import url("https://fonts.googleapis.com/css2?family=${font(t.display)}:wght@500;600;700&family=${font(t.body)}:wght@400..700&display=swap");`;
  return css
    .replace(/@import url\([^)]*\);/, fonts)
    .replace(/--panel: [^;]+;/, `--panel: ${t.panel};`)
    .replace(/--line: [^;]+;/, `--line: ${t.line};`)
    .replace(/--on-accent: [^;]+;/, `--on-accent: ${t.onAccent};`)
    .replace(/--text: [^;]+;/, `--text: ${t.text};`)
    .replace(/--muted: [^;]+;/, `--muted: ${t.muted};`)
    .replace(/--quiet: [^;]+;/, `--quiet: ${t.muted};`)
    .replace(/--display: [^;]+;/, `--display: "${t.display}", "Helvetica Neue", sans-serif;`)
    .replace(/--body: [^;]+;/, `--body: "${t.body}", system-ui, sans-serif;`)
    + (t.displayWeight ? `\n.display { font-weight: ${t.displayWeight}; letter-spacing: -0.02em; }\n` : "");
}

const head = (title: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<link rel="stylesheet" href="/library/{{ORG_ID}}/templates/_shared/theme.css">
</head>
<body>
<main class="scene">`;
const foot = `</main>
<script src="/library/{{ORG_ID}}/templates/_shared/scene.js"></script>
</body>
</html>
`;

/** A talking head: the camera fills the frame, with a name and today's title in a lower third. */
const talkingHead = `${head("Talking head")}
  <div class="slot square" data-slot="Camera" style="left: 0; top: 0; width: 1920px; height: 1080px"></div>
  <section class="abs panel" style="left: 72px; bottom: 72px; width: 1010px; box-sizing: border-box; padding: 30px 40px; display: flex; align-items: center; gap: 30px">
    <img src="/library/{{ORG_ID}}/templates/_shared/brand/mark.svg" alt="" width="76" height="76">
    <div style="display: flex; flex-direction: column; gap: 10px; min-width: 0">
      <span class="kicker" style="font-size: 16px">{{HOST}}</span>
      <h2 class="display" style="font-size: 52px; line-height: 1.02">{{TOPIC}}</h2>
    </div>
  </section>
${foot}`;

/** Two people side by side, each named, with the show and today's title below. */
const interview = `${head("Interview")}
  <div class="slot" data-slot="Camera" style="left: 40px; top: 40px; width: 908px; height: 796px"></div>
  <div class="slot" data-slot="Guest" style="left: 972px; top: 40px; width: 908px; height: 796px"></div>
  <span class="abs chip" style="left: 72px; top: 764px; background: var(--panel); color: var(--text); letter-spacing: 0.04em; font-size: 20px; height: 46px">{{HOST}}</span>
  <span class="abs chip" style="left: 1004px; top: 764px; background: var(--panel); color: var(--text); letter-spacing: 0.04em; font-size: 20px; height: 46px">{{GUEST}}</span>
  <footer class="abs panel" style="left: 40px; top: 860px; width: 1840px; height: 180px; box-sizing: border-box; padding: 0 44px; display: flex; align-items: center; gap: 36px">
    <img src="/library/{{ORG_ID}}/templates/_shared/brand/mark.svg" alt="" width="80" height="80">
    <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px">
      <span class="kicker" style="font-size: 17px">{{ORG_NAME}}</span>
      <h2 class="display" style="font-size: 58px; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{{TOPIC}}</h2>
    </div>
    <span class="chip"><span class="dot" style="width: 10px; height: 10px; background: var(--on-accent)"></span>LIVE</span>
  </footer>
${foot}`;

function fill(html: string, s: Show): string {
  const t = s.text;
  const swaps: [string | RegExp, string][] = [
    ["Today's topic goes here", t.upNext],
    [">Today's topic<", `>${t.topic}<`],
    ["Key point, link or question for chat.", t.note],
    ["Next time: the next topic goes here", t.nextTime],
    ["Starting soon.", t.starting],
    ["Grab a drink. We'll be back in a minute.", t.brb],
    [/\{\{TOPIC\}\}/g, t.topic],
    [/\{\{HOST\}\}/g, t.host],
    [/\{\{GUEST\}\}/g, t.guest],
    [/\{\{ORG_ID\}\}/g, s.id],
    [/\{\{ORG_NAME\}\}/g, s.name],
    [/\{\{ORG_INITIAL\}\}/g, s.initial],
    [/\{\{ACCENT\}\}/g, s.accent],
    [/\{\{GROUND\}\}/g, s.ground],
  ];
  for (const [from, to] of swaps) html = html.replaceAll(from as string, to);
  return html;
}

export async function buildLibrary(): Promise<string> {
  if (LIBRARY.includes("ViewSwitcher Library")) throw new Error("never write into the real library");
  await rm(LIBRARY, { recursive: true, force: true });
  for (const s of SHOWS) {
    const dir = join(LIBRARY, s.id);
    await cp(starter, dir, { recursive: true });
    await writeFile(join(dir, "templates/talking-head.html"), talkingHead);
    await writeFile(join(dir, "templates/interview.html"), interview);
    const css = join(dir, "templates/_shared/theme.css");
    await writeFile(css, theme(await readFile(css, "utf8"), s));
    // The mark's letter in the show's own on-accent color.
    const mark = join(dir, "templates/_shared/brand/mark.svg");
    await writeFile(mark, (await readFile(mark, "utf8")).replace('fill="{{GROUND}}"', `fill="${s.theme.onAccent}"`).replace("Space Grotesk", s.theme.display));
    for (const f of ["org.json", "BRAND.md", "templates/_shared/theme.css", "templates/_shared/brand/mark.svg",
      ...(await readdir(join(dir, "templates"))).filter((n) => n.endsWith(".html")).map((n) => `templates/${n}`)]) {
      const p = join(dir, f);
      await writeFile(p, fill(await readFile(p, "utf8"), s));
    }
    await mkdir(join(dir, "projects"), { recursive: true });
  }
  return LIBRARY;
}

if (import.meta.main) console.log(`wrote ${await buildLibrary()}`);
