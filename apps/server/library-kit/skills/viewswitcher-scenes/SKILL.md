---
name: viewswitcher-scenes
description: Make or change what's on screen in a live stream run with ViewSwitcher (the HTML views, or scene files, its switcher puts on air in OBS), for any show in this ViewSwitcher library. Use for any ask about the stream's views or templates — "make a BRB screen", "brand my channel", "change the title for tonight", "add my logo", a new view or scene, a starting-soon or ending screen, a lower third, a stream-only version, a new template or template set, new text, using an uploaded image or video, a transition, branding a new show — for anything in a show's templates/, projects/ or assets/, and for making a template pack (a set of templates people install with a drop).
---

# ViewSwitcher views

Every on-air screen is a **view**: one plain HTML file (a scene file; the tools and the code call views scenes). The ViewSwitcher app shows these files as covers on the switcher; tapping one puts it on air in OBS. Saving a file updates its cover and OBS within a second. There is no build step.

**People edit these files too.** The switcher has an editor (the pencil on every view): anyone can retype text in place, drag and resize panels and camera boxes, add text, a title bar, an image or a camera, screen or guest box, delete elements, swap an image and rename a view, and each change is saved straight into the file, often while it's on air. It patches only what changed: the text between an element's tags, the numbers in its inline `left`/`top`/`width`/`height`, an image's `src`, the `<title>`, or one whole element added or removed. It never rewrites anything else. So write views it can edit (see "Editable by people" below), and **re-read a file right before you change it**: what you read earlier may be out of date.

The library holds one folder per **show** (a brand or channel; `<org>/` on disk, and the tools' `org` argument is the show's id, its folder name). Shows never share files: each has its own templates, assets, projects and brand. Work out which show the user means first (ask if it isn't clear).

## With the ViewSwitcher tools

When the ViewSwitcher app is open, its MCP server gives you tools (`get_state`, `scan_library`, `read_file`, `write_file`, `preview_scene` and the rest below). If you have them, work through them: they follow the same rules as the switcher, and they let you see your work. If you don't, use "Without the tools" at the end.

Every path you pass or get back starts with the show's id: `<org>/projects/<project>/scenes/<name>.html`.

1. **`get_state` first.** It tells you what's on air (path, label, and `org`, the show's id), whether OBS is streaming or recording (you're **live**), and the user's setting for what agents may do while live.
2. **Find the show and the file.** `list_orgs` lists the shows if you don't know which one. `scan_library { org }` lists its templates, projects, streams and views, and which stream views are the stream's own copy of a project view (`overrides: true`). Pick the file with the override rule (below). Read `<org>/BRAND.md` with `read_file` before designing anything.
3. **Use the structural tools instead of copying files by hand:**

   | to | call |
   |---|---|
   | change a view for this stream only | `customize_scene { org, projectId, streamId, name }`, then edit the `path` it returns |
   | undo a stream's own copy | `revert_scene { org, projectId, streamId, name }` (deletes the copy: ask first) |
   | add a new view from a template | `scene_from_template { org, template, projectId, streamId? }` (a set's template is `"<set>/<name>"`) |
   | start from a ready-made template set ("slides from the Grace Community templates") | `list_template_sets`, then `add_template_set { org, set }` (as Templates → Add templates does); make views from the `templates` it returns |
   | try a variation next to the original | `duplicate_scene { path }` |
   | rename a view (its cover label) | `rename_scene { path, hash, name }` |
   | give a project its own transition | `customize_transition { org, projectId }`; `revert_transition` goes back to the show's |
   | use an image or video the user gives you | `add_asset { org, name, base64 }`, then reference `/library/<path it returns>` |
   | start a new project or stream | `create_project { org, name, templates? }`, `create_stream { org, projectId, name, date? }` |

   `list_files { path }` shows what's in a folder (a show's or any folder in it). New views (`.html`) go only where the switcher lists them (`templates/`, a set's folder, `projects/<id>/scenes/`, `projects/<id>/streams/<id>/`), named in lower-case-with-dashes, as a pack's templates are; `write_file` refuses others.
4. **Read, then write with the hash.** Call `read_file { path }` right before you change a file; it returns `{ text, hash }`. Make your change to that text and call `write_file { path, text, hash }`. Omit `hash` only to create a new file. If the write is refused because the hash is stale, someone changed the file since you read it (often in the switcher): read it again, apply your change to what's there now, and write again. Never work around the check.
5. **Preview, look, fix** (next section) after every visual change.
6. **Tell the user** which file you changed and whether the change applies to one stream, the whole project, or a template.

### Preview, look, fix

After every change someone will see, call `preview_scene { path }`. It returns a picture of the view at 1920×1080 (sent at 960×540; pass `full: true` to check fine text), rendered by OBS with the ground color painted in and the camera boxes labeled. Actually look at it and check:

- **Camera boxes clear:** nothing paints over a camera, screen or guest box unless it's meant to.
- **Text fits:** no line cut off, wrapped badly or overflowing its panel; long names and titles still fit.
- **On the canvas:** nothing off the 1920×1080 frame or jammed against its edge.
- **Contrast:** text and marks read clearly against the ground and the panels.
- **Brand:** colors, type and marks as BRAND.md says, from the theme's variables.
- **Contract:** what's under "View contract" and "Editable by people" still holds.

Fix what's wrong and preview again until it's right; usually 1–3 rounds. If `preview_scene` returns a URL instead of a picture, OBS isn't available: say so, and give the user the URL to open.

`see_program { full? }` shows what OBS is actually putting out right now, **including the user's live camera and screen**. Use it only when the user asks about what's on stream, and tell them it includes their camera.

### On air

- Call `go_on_air { path }` only when the user asks to put something on air.
- When `get_state` says you're live, tell the user before you change anything that's on air: the view on air, its transition (its set's, its project's or the show's), or the show's `templates/_shared/` files (the theme every view uses) and, for a set's view, the set's `_shared/`.
- The server refuses some changes while live, depending on the user's setting in Edit with AI (by default, going on air and writing to what's on air). When it refuses, tell the user why in plain words, and offer the way around it: make a stream copy with `customize_scene` (or `duplicate_scene`) and change that, or wait until the stream is off air. Don't retry the same change.

## Where things live

```
<org>/org.json                                       { "name", "accent", "ground" }  (ground = OBS background)
<org>/BRAND.md                                       the show's brand rules: read before designing
<org>/templates/<name>.html                          templates: what new views start from (they can go on air too)
<org>/templates/_shared/order.json                   { "order": [file names] }: the order the templates are listed in (optional)
<org>/templates/_shared/theme.css                    brand tokens + .slot/.panel/.kicker/.display/.chip classes
<org>/templates/_shared/scene.js                     ?preview mode, data-countdown, the transition "play" class
<org>/templates/_shared/transition.html              the show's transition between views (optional)
<org>/templates/_shared/brand/mark.svg               the show's mark
<org>/templates/<set>/                               a template set installed from a template pack (see below):
<org>/templates/<set>/pack.json                        its name, version and templates ("views")
<org>/templates/<set>/<view>.html                      its templates
<org>/templates/<set>/_shared/, assets/                its own theme, scripts, transition and pictures
<org>/assets/<file>                                  the show's uploads (images, video, audio)
<org>/projects/<project>/project.json                { "name", "order": [view names] }
<org>/projects/<project>/transition.html             this project's own transition (optional; replaces the show's)
<org>/projects/<project>/scenes/<name>.html          shared by every stream in the project
<org>/projects/<project>/streams/<MM-DD-slug>/stream.json   { "name", "date": "YYYY-MM-DD" }
<org>/projects/<project>/streams/<MM-DD-slug>/<name>.html   this stream only
```

New shows are created from the switcher (show menu → New show), which copies a neutral starter kit. To brand one, edit its `theme.css`, `brand/mark.svg`, `BRAND.md` and `org.json`.

**The override rule.** A stream shows the project's views plus its own files. A stream file with the same name as a project view is the stream's own copy: it replaces the project's view for that stream only. So:
- "Change X for this stream" (or "for tonight") → the stream's own copy, `<org>/projects/<p>/streams/<s>/X.html`. Make it with `customize_scene` if it isn't there (without the tools, copy `<org>/projects/<p>/scenes/X.html` there), then edit the copy.
- "Change X for the whole series" → edit `<org>/projects/<p>/scenes/X.html`.
- "Change the template" → edit `<org>/templates/X.html`. Existing projects keep their own copies; say so.

If the user doesn't say which, ask, or pick the narrowest scope (the stream) and tell them.

## View contract

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
- **Camera boxes** (slots): `<div class="slot" data-slot="NAME">` with left/top/width/height. The server moves the OBS source named NAME into that box (cover-fit and cropped). The source names:
  - `Camera`, `Screen` and `iPad`: the sources the OBS setup asks for and ViewSwitcher hides when a view has no box for them (the server's `OBS_SOURCES`, `Camera,Screen,iPad` by default).
  - `Guest`, and numbered names like `Camera 2` or `Screen 2`: what the editor's camera, screen and guest boxes ask for beyond those (see "What the editor adds"). They work once OBS has a source with that exact name in the ViewSwitcher scene.
  - Never invent or rename a box's name without asking: it must match an OBS source exactly, or the box stays empty and the switcher warns.
  - Rounded corners come from `--radius` (default 18px). Use `class="slot round"` for a circle and `class="slot square"` for none.
  - Nothing may paint over a camera box unless it's meant to cover the video (a ring or badge on the edge is fine).
  - A view with no camera boxes hides all those sources (e.g. BRB).
- Reference files with absolute library URLs inside the same show: `/library/<org>/templates/_shared/...` and `/library/<org>/assets/<file>`. Never point at another show's files.
- `?preview` (added by the switcher's covers and by `preview_scene`) paints the ground and labels the camera boxes; don't depend on it otherwise.
- Keep `<title>` short; it's the label on the cover.

## Editable by people

The editor finds what to offer from the markup itself; there are no special attributes to add.

- **Text people may change goes in its own small element** with nothing but text inside: `<h2 class="display">Today's topic</h2>`, `<p>…</p>`, `<span class="kicker">Notes</span>`. Text mixed with other tags (`<p>Read <b>this</b></p>`, a chip with an icon and a word) can't be retyped there; wrap the word in its own `<span>` if people will want to change it.
- **Anything people may move keeps its position as inline px**: `style="left: 1528px; top: 506px; …"` on the absolutely positioned element (`.abs` panels, `.slot` boxes). Positions in a stylesheet, percentages, `right`/`bottom` or `transform` can't be dragged.
- **Anything people may resize also has its size as inline px**: `width: 360px; height: 450px` in the same `style`. Camera, screen and guest boxes resize at 16:9 unless people hold Shift.
- Plain text only: the editor doesn't do bold or links inside text. That stays your job.
- Keep every view's content inside one `<main class="scene">` (or `<body>`): that's where added elements go.
- Theme classes are what make added elements match the show: keep `.abs`, `.panel`, `.display`, `.muted`, `.kicker` and `.slot` defined in `theme.css` when you change a show's theme.

### What the editor adds

Each addition is one element, on its own line, just before `</main>`, in the middle of the 1920×1080 view:

```html
<p class="abs display" style="left: 600px; top: 492px; width: 720px; height: 96px; margin: 0; font-size: 72px; line-height: 1.15">New text</p>
<div class="abs panel" style="left: 560px; top: 465px; width: 800px; height: 150px; box-sizing: border-box; padding: 0 40px; display: flex; flex-direction: column; justify-content: center; gap: 12px"><h2 class="display" style="…">Name</h2><p class="muted" style="…">Title or topic</p></div>
<img class="abs" src="/library/<org>/assets/logo.png" alt="" style="left: 660px; top: 240px; width: 600px; height: 600px; object-fit: contain">
<div class="slot" data-slot="Camera 2" style="left: 640px; top: 360px; width: 640px; height: 360px"></div>
```

Camera, screen and guest boxes ask for `Camera`, `Screen` or `Guest`, numbered (`Camera 2`) when the view already has a box with that name. `Camera` and `Screen` are sources the OBS setup asks for; `Guest` and the numbered ones fill only once the user adds an OBS source with that exact name (see "Camera boxes" above). Treat these like anything else in the file: tidy them, change their CSS or move them into a better place in the markup if the user asks, but don't remove what people added without being asked.

Deleting removes one element and the whitespace before it. Renaming sets `<title>`; for a stream's own view it also renames the file (a stream's copy of a project view keeps its file name, which ties it to the project's).
- Don't put text that scripts overwrite (like `data-countdown`) in the elements people edit.
- Their edits are real changes to the file: keep them. If a file changed since you last read it, read it again and work from what's there now.

## Views run sandboxed

The switcher shows every view in a sandboxed frame with no origin of its own, so a view's scripts can't reach the switcher (its API, its live socket, the page around it). For views that means:

- Scripts run (countdowns, clocks, animations, `scene.js`), but `localStorage`, `sessionStorage`, cookies and `parent`/`top` are off limits and throw.
- `fetch`, `XMLHttpRequest`, `WebSocket` and `EventSource` work only to `https:`/`wss:` addresses (a public feed, say), never `http:`, `ws:` or the switcher itself, so a view can't `fetch` its own library JSON: put data in the HTML. Library scripts (also `type="module"`), styles, pictures, media and fonts load fine. A template's pictures (anything under `<org>/templates/`) also work as a CSS `mask` or with `crossorigin`; the show's own media (`assets/`, `projects/`) doesn't, so leave `crossorigin` off it and don't mask with it.
- No forms, pop-ups or navigating the page. Links and buttons do nothing on air anyway.
- Fonts load from Google Fonts (or any https host with CORS) and from the library.
- The editor shows the file **without running its scripts**, so text a script writes isn't editable there: keep text people should retype in the HTML itself.

## Template sets and template packs

A **template pack** is a whole template set (templates with their own theme, scripts, transition and pictures) in one folder or `.zip` that people install with a drop on the switcher's Templates page. It installs into a show as a **template set**, `<org>/templates/<set>/`, beside the show's own templates; the Templates page and New view group templates by set. Views made from a set's template link the set's `_shared/` files, so:

- To change the theme of every template in a set (and the views made from them), edit `<org>/templates/<set>/_shared/theme.css`. Edit a set's templates like any template.
- Don't rename a set's folder or move its files: views made from it link them by path.
- Removing a set in the switcher keeps its `_shared/` and `assets/` if views still use them.

To **make** a pack (for another show, another library, or to share), write a folder like this, outside the library unless the user says where:

```
my-pack/
  pack.json            { "format": 1, "id": "neon-night", "name": "Neon Night", "version": "1.0.0",
                         "description": "…", "views": ["starting-soon", "main", "brb"],
                         "placeholders": ["ORG_NAME", "ACCENT", "GROUND", "PACK"] }
  templates/<view>.html   one per name in "views", in that order
  _shared/theme.css, scene.js, transition.html (optional), brand/…, fonts
  assets/              pictures, video, audio, fonts
```

- Link the pack's own files as `{{PACK}}/_shared/theme.css`, `{{PACK}}/assets/bg.jpg` (on install `{{PACK}}` becomes `/library/<org>/templates/<set>`). Its templates sit at `{{PACK}}/<view>.html`.
- `{{ORG_NAME}}`, `{{ORG_INITIAL}}`, `{{ORG_ID}}`, `{{ACCENT}}` and `{{GROUND}}` are filled from the show it's installed into. Use them so the pack takes on any show's name and colors.
- Same view contract as above. Scripts go in `_shared/*.js` only; file names use letters, numbers, dots, dashes and spaces; views are lower-case-with-dashes. Up to 400 files, 25 MB each, 100 MB in all.
- The full format is docs/template-packs.md in the ViewSwitcher repo. `bun run packs:export` there exports the starter kit and the site's six example shows as packs; the app has them built in (Templates → Add templates, or `add_template_set`).

## Transitions

A transition is a page that covers the screen while one view switches to the next. The switcher fades it in over about 170 ms, holds it, then fades out onto the new view. Switching to a view plays the most specific transition there is: for a template set's template, the set's own `<org>/templates/<set>/_shared/transition.html`; for a view in project P, `<org>/projects/P/transition.html`; else the show's `<org>/templates/_shared/transition.html`; else a blank fade through the ground color. The show's own templates use the show's.

A blank fade is the default and often the best choice: anything with words flashes by too fast to read and distracts. Only make a transition page when the user asks for one, and prefer something simple (a mark, a color sweep) over text.

- "Change the transition" → edit the show's. "A transition for this series" → `customize_transition` (without the tools, copy the show's into `<org>/projects/<p>/transition.html`; the switcher's "Customize for this project" does the same) and edit the copy.
- Same head and `main.scene` as a view, but **opaque**: give `body` the ground (or any) background, since it must hide the switch. No camera boxes.
- Keep it short. `<meta name="viewswitcher:hold" content="120">` sets how long it stays fully on screen in ms (default 90, max 5000). Long holds slow every switch.
- Animate on the `play` class, which `scene.js` restarts on `<html>` every switch: `.play .x { animation: … }`. Make the resting (un-animated) state the finished design, and animate *from* the start state, so the switcher's cover (and `preview_scene`) shows the finished design.
- Only use brand marks that are real (from BRAND.md or the user). Don't invent a logo; a wordmark in the theme's type is fine.

## Brand

Each show has its own brand in `<org>/BRAND.md` (tokens, type, marks, rules) and `<org>/templates/_shared/theme.css`. **Read the show's BRAND.md before designing anything.** Use the theme's CSS variables; don't hard-code new colors. If you change `--ground`, change `ground` in `<org>/org.json` to match (OBS paints it). A logo or image the user gives you goes in `<org>/assets/` (`add_asset`); a mark that's part of the brand goes in `templates/_shared/brand/`.

## Without the tools

When the ViewSwitcher tools aren't there (the app is closed, or your agent has no MCP), work on the files directly:

1. Find the right file with the override rule. Read it right before editing (people may have just changed it in the switcher).
2. Edit in place. Keep the contract: head links, `main.scene`, camera box names, `scene.js`, text in its own small elements, positions as inline px. For a stream-only change, edit the stream's own copy; copy the project view into the stream folder first only if the stream has no copy yet (never over one: it holds that stream's changes).
3. To check it, open `http://localhost:7420/library/<path>?preview` (1920×1080; use the switcher's port if it isn't 7420). ViewSwitcher must be open for that address to answer; if it isn't, ask the user to open it. If a headless browser is available, screenshot it at 1920×1080, look, and fix it with the checklist under "Preview, look, fix".
4. Tell the user which file you changed and whether the change applies to one stream, the whole project, or a template.

## Don't

- Rename or move folders (shows, projects, streams). The app keys on folder names.
- Touch `.viewswitcher/` (live app state, and packs waiting to be installed).
- Put a view on air unless the user asked.
- Add build tools, frameworks or npm packages. Views are plain HTML/CSS with a little inline JS when needed.
- Delete user assets.
