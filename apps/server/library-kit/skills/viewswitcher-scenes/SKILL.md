---
name: viewswitcher-scenes
description: Create or edit live-stream scenes for ViewSwitcher (the HTML files its switcher puts on air in OBS), for any org in this ViewSwitcher library. Use for any change to an org's templates/, projects/ or assets/ — a new scene, a stream-specific version, restyling, new text, using an uploaded image or video, branding a new org.
---

# ViewSwitcher scenes

Every on-air screen is one plain HTML file. The ViewSwitcher app shows these files as covers on the switcher; tapping one puts it on air in OBS. Saving a file updates its cover and OBS within a second. There is no build step.

**People edit these files too.** The switcher has a scene editor ("Edit text and layout"): anyone can retype text in place and drag panels and camera boxes, and each change is saved straight into the file, often while it's on air. It changes only the text between an element's tags and the numbers in its inline `left`/`top`; it never rewrites anything else. So write scenes it can edit (see "Editable by people" below), and **re-read a file right before you change it**: what you read earlier may be out of date.

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
- Plain text only: the editor doesn't do bold or links inside text, and doesn't resize, add or delete elements. Those stay your job.
- Don't put text that scripts overwrite (like `data-countdown`) in the elements people edit.
- Their edits are real changes to the file: keep them. If a file changed since you last read it, read it again and work from what's there now.

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
- Touch `.viewswitcher/` (live app state).
- Add build tools, frameworks or npm packages. Scenes are plain HTML/CSS with a little inline JS when needed.
- Delete user assets.
