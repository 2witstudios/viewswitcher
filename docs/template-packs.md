# Template packs

A template pack is one whole template set for a show: a set of templates (starting soon, the main layouts, be right back, ending…) with their own theme, scripts, transition and pictures, in one folder or `.zip`. People install one by dropping it on the switcher's Templates page (or **Import pack…**), or pick a built-in one (**Add templates**, and when making a new show). It goes into the show (`<org>/`) as its own **template set**, filled in with the show's name and colors, beside the show's own templates.

Packs come from agents, from the app itself (the starter kit and the site's six example shows, built in: see below), as downloads on viewswitcher.com, and later from the overlay studio there. They all make this one format. It's plain HTML, CSS and a little JS, so a pack stays the source of truth after it's installed: people and agents keep editing the same files.

The validator is `packages/shared/src/template-pack.ts` (`planPack`, `readManifest`, `checkPack`), tested in `template-pack.test.ts`. Installing is `apps/server/src/packs.ts`.

## Layout

```
neon-night/                         the pack (a folder, or a .zip of it)
├─ pack.json                        required
├─ templates/<view>.html            the views: one file per name in pack.json's "views"
├─ _shared/                         the pack's own shared files
│  ├─ theme.css                     tokens and classes (see the starter kit's)
│  ├─ scene.js                      the starter kit's, or the pack's own
│  ├─ transition.html               optional: its transition, played when one of its views goes on air
│  └─ brand/…, fonts/…              pictures and fonts the theme uses
├─ assets/                          optional: pictures, video, audio, fonts the views use
├─ README.md, LICENSE               optional, installed alongside
```

A `.zip` may hold these at its top, or inside one folder (what Finder's Compress makes). `__MACOSX/`, `.DS_Store`, `Thumbs.db` and other hidden files are left out.

## pack.json

```json
{
  "format": 1,
  "id": "neon-night",
  "name": "Neon Night",
  "version": "1.0.0",
  "description": "Electric blue on black, with a scanline transition.",
  "author": "Someone",
  "views": ["starting-soon", "main", "interview", "brb", "ending"],
  "placeholders": ["ORG_NAME", "ACCENT", "GROUND", "PACK"]
}
```

| field | |
|---|---|
| `format` | `1`. Optional (1 is assumed). A pack with a higher number is refused with "made for a newer ViewSwitcher". |
| `id` | lower-case letters, numbers and dashes, up to 40. The set's folder name (`templates/<id>/`); `<id>-2`, `-3`… when the show already has one. |
| `name` | up to 60 characters. Shown as the set's heading. |
| `version` | like `1.0.0` (`1.0` and a `-beta.1` suffix are fine). |
| `description` | optional, up to 400 characters. |
| `author` | optional, up to 80 characters. |
| `views` | the views, in the order the switcher lists them. Each name is `templates/<name>.html` (lower-case letters, numbers and dashes). A view file not listed still installs, after the listed ones, with a warning. |
| `placeholders` | the placeholders the pack's files use (below). Optional; one used but not listed is still filled, with a warning. |

## Placeholders

Every `.html`, `.css`, `.js`, `.json`, `.svg`, `.md` and `.txt` file is filled in on install:

| placeholder | becomes |
|---|---|
| `{{ORG_NAME}}` | the show's name (`org.json` name) |
| `{{ORG_INITIAL}}` | its first letter, upper-case |
| `{{ORG_ID}}` | its id: the show's folder name (`<org>/`) |
| `{{ACCENT}}` | `org.json` accent |
| `{{GROUND}}` | `org.json` ground (OBS paints it behind every view) |
| `{{PACK}}` | the set's folder as a URL: `/library/<org>/templates/<set>` |

Anything else in `{{LIKE_THIS}}` stays as typed (with a warning).

Values are escaped for the file they land in: in `.html` and `.svg` they're HTML-escaped (a show named `R&B <Live>` reads as text and can't add markup), in `.json` they're escaped for a JSON string, in `.css` only `*/` is broken up (so a value can't close a comment), and elsewhere (`.js`, `.md`, `.txt`) they're as typed. So in a view, put `{{ORG_NAME}}` in text or an attribute, not inside an inline `<script>`; a script that needs the name can read it from the page. `{{ORG_NAME}}` or `{{ORG_INITIAL}}` inside an inline `<script>` or `<style>`, an `on…` attribute or a `.js` file is a warning, since a name like O'Brien or R&B can break the view there. The other placeholders are a slug, a color or a URL, which read the same anywhere.

**Link the pack's own files through `{{PACK}}`:** `{{PACK}}/_shared/theme.css`, `{{PACK}}/assets/bg.jpg`, `{{PACK}}/_shared/brand/mark.svg`. Views are installed at the set's top level, beside `_shared/`, so another view is `{{PACK}}/<view>.html`. Absolute URLs keep working when a view is copied into a project or stream, which relative ones wouldn't. A link to a pack file that isn't in the pack is a warning. A view may also link the show's own files (`/library/{{ORG_ID}}/assets/…`).

## Views

Views follow the view contract in the library's skill (`apps/server/library-kit/skills/viewswitcher-scenes/SKILL.md`): 1920 × 1080, a transparent page, `<main class="scene">`, camera boxes as `<div class="slot" data-slot="Camera">` with inline px `left/top/width/height`, text in its own small elements so people can retype it in the switcher, a short `<title>` (the cover's label), and the transition contract (`<meta name="viewswitcher:hold">`, the `play` class) for `_shared/transition.html`.

## Limits

| | |
|---|---|
| files | 400 (after junk is left out) |
| one file | 25 MB |
| all files, unpacked | 100 MB |
| the `.zip` | 60 MB |
| a path | 200 characters, 5 folders deep; names use letters, numbers, dots, dashes, spaces and `_` |
| `templates/` | `.html` only, no subfolders |
| `_shared/` | `.css`, `.js`, `transition.html`, pictures (`png jpg jpeg gif webp avif svg`), fonts (`woff woff2 ttf otf`) |
| `assets/` | pictures, fonts, video (`mp4 webm mov m4v`), audio (`mp3 wav m4a aac ogg`) |
| top level | `pack.json`, `README.md`, `LICENSE`, `LICENSE.md`, `LICENSE.txt` |

Scripts may only be in `_shared/`, so what a pack runs is in one place.

## What installing does, and refuses

1. **Before anything is written**, every entry is checked: a path that leaves the pack (`..`, an absolute path, a drive letter, a backslash), a symlink or device, a file type where it doesn't belong, two names that differ only in case, too many or too big. Any of these refuses the whole pack, with the reason in plain words.
2. The zip is read by `packages/packs/src/zip.ts`: entries are inflated one at a time and never past the size they declare (a zip bomb that lies about its sizes stops there), checked against their CRC, and encrypted entries, ZIP64 and other compression methods are refused.
3. Accepted files are unpacked into `<org>/.viewswitcher/staging/<token>/`. pack.json and the views are checked (`checkPack`). A copy filled in for the show is what the switcher shows before you install: covers of every view and the transition, what the pack runs, and any warnings.
4. **Install** fills the files in again with the set's real URL in a staging folder, then renames that folder to `<org>/templates/<set>/`. That rename is the only step that touches the show's folder, so a failed install leaves nothing behind. **Cancel** (or an hour without either) deletes the staging folder.

**Its transition.** When one of the set's views goes on air, the switcher plays the set's own `_shared/transition.html` if it has one, else the show's (`templates/_shared/transition.html`), else a blank fade. A view made from one of the set's templates in a project plays its project's transition, else the show's: it's the project's now.

**Removing a set** (Templates → Remove set) deletes its folder. If views made from it still link its files, only its templates and pack.json go: its `_shared/` and `assets/` stay so those views keep their theme and pictures, and the switcher says how many use them. Views made from it are never touched.

## Scripts and the sandbox

A pack from a stranger may contain JavaScript. Views are served from the switcher's own server, so without a sandbox a view's script could call `/api` (put anything on air, edit files, upload), open the live socket, or reach into the page around it. So every library page is sandboxed:

- Every `/library/` response, whatever its name, carries `Content-Security-Policy: sandbox allow-scripts; connect-src https: wss:; …` (`apps/server/src/scene-sandbox.ts`), and every frame the switcher shows a view in has `sandbox="allow-scripts"`. A view therefore has an opaque origin: its scripts run, but its requests say `Origin: null`, which the API and the socket refuse, it can't read anything back from the server, can't touch `parent` or `top`, can't navigate, submit forms or open windows, and `connect-src` keeps it off `http:`/`ws:` addresses, including OBS's own websocket on this Mac.
- The program page still needs a view's camera box positions and the editor's live edits. A small bridge the server adds to views it serves with `?bridge` (`apps/server/src/scene-bridge.ts`) answers over `postMessage`; the program page only listens to the frame it's showing, and all a view can tell it is where its own camera boxes are.
- The editor needs the view's DOM, so its frame is the other way round: same-origin, but none of the view's code runs. `?inert` serves it with `script-src 'none'`, no frames, objects or workers, and every `<meta` start tag renamed to `<link data-vs-meta` (wherever it is, so no refresh can navigate the frame). Only that defused copy is same-origin: any other `?inert` request is sandboxed as usual. The frame itself keeps `allow-scripts` only because WebKit won't run the editor's own listeners without it.
- What a view can still do: run scripts, load the library's scripts (classic or `type="module"`), styles and fonts, show its pictures and media, use a template's pictures as a CSS `mask` or with `crossorigin` (scripts, styles, fonts and everything under `<org>/templates/` are sent with CORS), and `fetch`/`WebSocket` to `https:`/`wss:` addresses. What it can't: `fetch` library JSON or anything over plain `http:`/`ws:`, load the show's own media (`<org>/assets/`, `<org>/projects/`) with `crossorigin` or as a mask (it isn't sent with CORS, so other websites open on the Mac can't read it), `localStorage`, cookies, `parent`/`top`, forms, pop-ups. An opaque-origin view sends no Referer, so the server can't tell a view's request from another site's: that's why CORS goes by where a file is, not who asks.

On install the switcher says what the pack runs: ViewSwitcher's standard `scene.js` (when the pack's is the starter kit's), its own script files, views and SVGs with code written into them (inline `<script>`, `on…` handlers, `javascript:` links; in an SVG any `<script>`) and scripts from other sites. The decision is recorded on the Decisions page (EDIT-26).

## Making packs

- `bun run packs:export [out-dir]` writes the starter kit and the site's six example shows (packages/packs/shows: fullcount, nova, grace, remi, riverside, kitchen) as `<id>/` and `<id>.zip` (default `dist/packs/`), each checked with the same validator, so an export that wouldn't install, or that warns, fails there.
- An agent can write a pack folder from the library skill's "Template sets and template packs" section and this page.

## Built-in template packs (EDIT-29 · EDIT-30)

The app comes with seven: **Starter** (the neutral templates every new show also gets as its own) and the six example shows from viewswitcher.com (Full Count, NOVA_PLAYS, Grace Community, Roam with Remi, Riverside Live, Saltwater Kitchen). One source feeds them, the site's renders and the site's downloads: `packages/packs` (the shows in `src/shows.ts`, their views and themes in `shows/<id>/`), written with the show's own name and colors. The server, the Mac build and the site all build from it; neither app imports the other.

- `packs:export` makes them generic (`packages/packs/src/build.ts`): in each view the show's name becomes `{{ORG_NAME}}` (however its words are spaced or broken; capitals stay capitals through `text-transform` on the element itself, so it stays plain text to retype), and `<title>` loses it ("Pregame", not "Full Count · Pregame"); in `theme.css` `--ground` and every variable set to the show's accent become `{{GROUND}}` and `{{ACCENT}}`. The rest of the palette stays, even a panel colour that happens to equal the show's ground (Full Count's navy plates): it's part of the template set, and another show's ground could put white text on a light plate. A paper ground (Remi, Kitchen) keeps its own color in `--paper-ground`: the paper is part of the set. Sample copy (episode titles, hosts: the shows' own text) stays as text to retype. The export fails if a show's name is left in a view.
- The site's renders fill the same views with each show's values (`apps/site/scripts/library.ts`).
- The Mac app ships them prebuilt in `Contents/Resources/packs` (`apps/apple/scripts/build.sh`; the server reads `VIEWSWITCHER_PACKS`). A source run builds them from the repo when they're first asked for (`apps/server/src/builtin-packs.ts`), from `packages/packs/shows/` or the folder `VIEWSWITCHER_SHOWS` names. The iPhone and iPad app gets them from the server.
- `GET /api/packs/builtin` lists them; `POST /api/packs/builtin/stage {org, id}` stages one for a show, and from there it's the same as a dropped pack: covers, install, cancel.
- In the switcher: a new show offers them after it's created (**Pick your templates**; **Skip** leaves just the starter), and the Templates page has **Add templates**. Each goes in as its own set, filled with the show's name and colors; adding one the show has already makes a second copy (`fullcount-2`).
