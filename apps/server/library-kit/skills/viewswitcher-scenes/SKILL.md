---
name: viewswitcher-scenes
description: Create or edit live-stream scenes for ViewSwitcher (the HTML files its switcher puts on air in OBS), for any org in this ViewSwitcher library. Use for any change to an org's templates/, projects/ or assets/ — a new scene, a stream-specific version, restyling, new text, using an uploaded image or video, branding a new org, or making a style pack (a set of views people install with a drop).
---

# ViewSwitcher scenes

Every on-air screen is one plain HTML file. The ViewSwitcher app shows these files as covers on the switcher; tapping one puts it on air in OBS. Saving a file updates its cover and OBS within a second. There is no build step.

**People edit these files too.** The switcher has a scene editor (the pencil on every scene): anyone can retype text in place, drag and resize panels and camera boxes, add text, a title bar, an image or a camera, screen or guest box, delete elements, swap an image and rename a scene, and each change is saved straight into the file, often while it's on air. It patches only what changed: the text between an element's tags, the numbers in its inline `left`/`top`/`width`/`height`, an image's `src`, the `<title>`, or one whole element added or removed. It never rewrites anything else. So write scenes it can edit (see "Editable by people" below), and **re-read a file right before you change it**: what you read earlier may be out of date.

The library holds one folder per **org** (a brand or channel). Orgs never share files: each has its own templates, assets, projects and brand. Work out which org the user means first (ask if it isn't clear).

## Where things live

```
<org>/org.json                                       { "name", "accent", "ground" }  (ground = OBS background)
<org>/BRAND.md                                       the org's brand rules: read before designing
<org>/templates/<name>.html                          starting points; never go on air directly
<org>/templates/_shared/theme.css                    brand tokens + .slot/.panel/.kicker/.display/.chip classes
<org>/templates/_shared/scene.js                     ?preview mode, data-countdown, the transition "play" class
<org>/templates/_shared/transition.html              the org's transition between scenes (optional)
<org>/templates/_shared/brand/mark.svg               the org's mark
<org>/templates/<set>/                               a template set installed from a style pack (see below):
<org>/templates/<set>/pack.json                        its name, version and views
<org>/templates/<set>/<view>.html                      its templates
<org>/templates/<set>/_shared/, assets/                its own theme, scripts, transition and pictures
<org>/assets/<file>                                  the org's uploads (images, video, audio)
<org>/projects/<project>/project.json                { "name", "order": [scene names] }
<org>/projects/<project>/transition.html             this project's own transition (optional; overrides the org's)
<org>/projects/<project>/scenes/<name>.html          shared by every stream in the project
<org>/projects/<project>/streams/<MM-DD-slug>/stream.json   { "name", "date": "YYYY-MM-DD" }
<org>/projects/<project>/streams/<MM-DD-slug>/<name>.html   this stream only
```

New orgs are created from the switcher (org menu → New org), which copies a neutral starter kit. To brand one, edit its `theme.css`, `brand/mark.svg`, `BRAND.md` and `org.json`.

**The override rule.** A stream shows the project's scenes plus its own files. A stream file with the same name as a project scene replaces it for that stream only. So:
- "Change X for this stream" → copy `<org>/projects/<p>/scenes/X.html` to `<org>/projects/<p>/streams/<s>/X.html` (if it isn't there) and edit the copy.
- "Change X for the whole series" → edit `<org>/projects/<p>/scenes/X.html`.
- "Change the template" → edit `<org>/templates/X.html`. Existing projects keep their own copies; say so.

If the user doesn't say which, ask, or pick the narrowest scope (the stream) and tell them.

## Scene contract

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Teaching</title>                                   <!-- the cover label -->
<link rel="stylesheet" href="/library/<org>/templates/_shared/theme.css">
</head>
<body>
<main class="scene">
  <div class="slot" data-slot="Camera" style="left: 1528px; top: 32px; width: 360px; height: 450px"></div>
  …
</main>
<script src="/library/<org>/templates/_shared/scene.js"></script>
</body>
</html>
```

- The canvas is exactly **1920 × 1080**. Position with absolute px.
- The page background stays **transparent**. OBS paints the ground color (`--ground`) underneath, and the camera/screen sit between the ground and the page.
- **Device slots**: `<div class="slot" data-slot="NAME">` with left/top/width/height. The server moves the OBS source named NAME into that box (cover-fit and cropped). Names in use: `Camera`, `Screen`, `iPad`. Never invent or rename a slot name without asking: it must match an OBS source exactly.
  - Rounded corners come from `--radius` (default 18px). Use `class="slot round"` for a circle and `class="slot square"` for none.
  - Nothing may paint over a slot unless it's meant to cover the video (a ring or badge on the edge is fine).
  - A scene with no slots hides all devices (e.g. BRB).
- Reference files with absolute library URLs inside the same org: `/library/<org>/templates/_shared/...` and `/library/<org>/assets/<file>`. Never point at another org's files.
- `?preview` (added by switcher covers) paints the ground and labels slots; don't depend on it otherwise.
- Keep `<title>` short; it's the label on the cover.

## Editable by people

The editor finds what to offer from the markup itself; there are no special attributes to add.

- **Text people may change goes in its own small element** with nothing but text inside: `<h2 class="display">Today's topic</h2>`, `<p>…</p>`, `<span class="kicker">Notes</span>`. Text mixed with other tags (`<p>Read <b>this</b></p>`, a chip with an icon and a word) can't be retyped there; wrap the word in its own `<span>` if people will want to change it.
- **Anything people may move keeps its position as inline px**: `style="left: 1528px; top: 506px; …"` on the absolutely positioned element (`.abs` panels, `.slot` boxes). Positions in a stylesheet, percentages, `right`/`bottom` or `transform` can't be dragged.
- **Anything people may resize also has its size as inline px**: `width: 360px; height: 450px` in the same `style`. Camera, screen and guest boxes resize at 16:9 unless people hold Shift.
- Plain text only: the editor doesn't do bold or links inside text. That stays your job.
- Keep every scene's content inside one `<main class="scene">` (or `<body>`): that's where added elements go.
- Theme classes are what make added elements look like the org: keep `.abs`, `.panel`, `.display`, `.muted`, `.kicker` and `.slot` defined in `theme.css` when you restyle an org.

### What the editor adds

Each addition is one element, on its own line, just before `</main>`, in the middle of the 1920×1080 scene:

```html
<p class="abs display" style="left: 600px; top: 492px; width: 720px; height: 96px; margin: 0; font-size: 72px; line-height: 1.15">New text</p>
<div class="abs panel" style="left: 560px; top: 465px; width: 800px; height: 150px; box-sizing: border-box; padding: 0 40px; display: flex; flex-direction: column; justify-content: center; gap: 12px"><h2 class="display" style="…">Name</h2><p class="muted" style="…">Title or topic</p></div>
<img class="abs" src="/library/<org>/assets/logo.png" alt="" style="left: 660px; top: 240px; width: 600px; height: 600px; object-fit: contain">
<div class="slot" data-slot="Camera 2" style="left: 640px; top: 360px; width: 640px; height: 360px"></div>
```

Device boxes ask for `Camera`, `Screen` or `Guest`, numbered (`Camera 2`) when the scene already has one; OBS needs a source with that name to fill it. Treat these like anything else in the file: tidy them, restyle them or move them into a better place in the markup if the user asks, but don't remove what people added without being asked.

Deleting removes one element and the whitespace before it. Renaming sets `<title>`; for a stream's own scene it also renames the file (a stream's copy of a project scene keeps its file name, which ties it to the project's).
- Don't put text that scripts overwrite (like `data-countdown`) in the elements people edit.
- Their edits are real changes to the file: keep them. If a file changed since you last read it, read it again and work from what's there now.

## Scenes run sandboxed

The switcher shows every scene in a sandboxed frame with no origin of its own, so a scene's scripts can't reach the switcher (its API, its live socket, the page around it). For scenes that means:

- Scripts run (countdowns, clocks, animations, `scene.js`), but `localStorage`, `sessionStorage`, cookies and `parent`/`top` are off limits and throw.
- `fetch`, `XMLHttpRequest`, `WebSocket` and `EventSource` work only to `https:`/`wss:` addresses (a public feed, say), never `http:`, `ws:` or the switcher itself, so a scene can't `fetch` its own library JSON: put data in the HTML. Library scripts (also `type="module"`), styles, pictures, media and fonts load fine.
- No forms, pop-ups or navigating the page. Links and buttons do nothing on air anyway.
- Fonts load from Google Fonts (or any https host with CORS) and from the library.
- The scene editor shows the file **without running its scripts**, so text a script writes isn't editable there: keep text people should retype in the HTML itself.

## Template sets and style packs

A **style pack** is a whole look (a set of views with their own theme, scripts, transition and pictures) in one folder or `.zip` that people install with a drop on the switcher's Templates page. It installs into an org as a **template set**, `<org>/templates/<set>/`, beside the org's own templates; the Templates page and New scene group templates by set. Scenes made from a set's template link the set's `_shared/` files, so:

- To restyle every view of a set, edit `<org>/templates/<set>/_shared/theme.css`. Edit a set's views like any template.
- Don't rename a set's folder or move its files: scenes made from it link them by path.
- Removing a set in the switcher keeps its `_shared/` and `assets/` if scenes still use them.

To **make** a pack (for another org, another library, or to share), write a folder like this, outside the library unless the user says where:

```
my-pack/
  pack.json            { "format": 1, "id": "neon-night", "name": "Neon Night", "version": "1.0.0",
                         "description": "…", "views": ["starting-soon", "main", "brb"],
                         "placeholders": ["ORG_NAME", "ACCENT", "GROUND", "PACK"] }
  templates/<view>.html   one per name in "views", in that order
  _shared/theme.css, scene.js, transition.html (optional), brand/…, fonts
  assets/              pictures, video, audio, fonts
```

- Link the pack's own files as `{{PACK}}/_shared/theme.css`, `{{PACK}}/assets/bg.jpg` (on install `{{PACK}}` becomes `/library/<org>/templates/<set>`). Views sit at `{{PACK}}/<view>.html`.
- `{{ORG_NAME}}`, `{{ORG_INITIAL}}`, `{{ORG_ID}}`, `{{ACCENT}}` and `{{GROUND}}` are filled from the org it's installed into. Use them so the pack takes on any org's name and colors.
- Same scene contract as above. Scripts go in `_shared/*.js` only; file names use letters, numbers, dots, dashes and spaces; views are lower-case-with-dashes. Up to 400 files, 25 MB each, 100 MB in all.
- The full format is docs/style-packs.md in the ViewSwitcher repo. `bun run packs:export` there exports the starter kit and the site's example styles as example packs.

## Transitions

A transition is a page that covers the screen while one scene switches to the next. The switcher fades it in over about 170 ms, holds it, then fades out onto the new scene. Switching to a scene in project P plays `<org>/projects/P/transition.html` if it exists, else `<org>/templates/_shared/transition.html`, else a blank fade through the ground color. Templates use the org's.

A blank fade is the default and often the best choice: anything with words flashes by too fast to read and distracts. Only make a transition page when the user asks for one, and prefer something simple (a mark, a color sweep) over text.

- "Change the transition" → edit the org's. "A transition for this series" → copy the org's into `<org>/projects/<p>/transition.html` (the switcher's "Customize for this project" does this) and edit the copy.
- Same head and `main.scene` as a scene, but **opaque**: give `body` the ground (or any) background, since it must hide the switch. No slots.
- Keep it short. `<meta name="viewswitcher:hold" content="120">` sets how long it stays fully on screen in ms (default 90, max 5000). Long holds slow every switch.
- Animate on the `play` class, which `scene.js` restarts on `<html>` every switch: `.play .x { animation: … }`. Make the resting (un-animated) state the finished look, and animate *from* the start state, so the switcher's cover shows the finished design.
- Only use brand marks that are real (from BRAND.md or the user). Don't invent a logo; a wordmark in the theme's type is fine.

## Brand

Each org has its own brand in `<org>/BRAND.md` (tokens, type, marks, rules) and `<org>/templates/_shared/theme.css`. **Read the org's BRAND.md before designing anything.** Use the theme's CSS variables; don't hard-code new colors. If you change `--ground`, change `ground` in `<org>/org.json` to match (OBS paints it).

## Workflow

1. Find the right file with the override rule. Read it right before editing (people may have just changed it in the switcher).
2. Edit in place. Keep the contract: head links, `main.scene`, slot names, `scene.js`, text in its own small elements, positions as inline px.
3. To check it, open `http://localhost:7420/library/<path>?preview` (1920×1080; use the switcher's port if it isn't 7420). If a headless browser is available, screenshot it at 1920×1080 and look.
4. Tell the user which file you changed and whether the change applies to one stream, the whole project, or a template.

## Don't

- Rename or move folders (orgs, projects, streams). The app keys on folder names.
- Touch `.viewswitcher/` (live app state, and packs waiting to be installed).
- Add build tools, frameworks or npm packages. Scenes are plain HTML/CSS with a little inline JS when needed.
- Delete user assets.
