# Daisy Production

Everything for producing Daisy Debate video: **live** (scene switcher + OBS) and **post** (the YouTube editing pipeline in `post/`).

## Live: how it works

- Every on-air screen is a plain HTML file in the **Daisy Live Library** (`~/Daisy Live Library`, its own git repo).
- The switcher (a web app on the Mac, opened on the iPad over Tailscale) shows the files as covers. Tap a cover to put it on air.
- OBS has one scene with one browser source showing `/program`. Each scene file marks device boxes with `data-slot="Camera"` and similar. The server moves and crops those OBS sources into the boxes over obs-websocket.

```
OBS scene "Daisy Live"
├─ Daisy Program   browser source → http://localhost:7420/program   (top)
├─ Camera · Screen · iPad                                          (moved per scene)
└─ Daisy Ground    color source #0d1812                             (bottom)
```

Library layout, the stream-over-project override rule and the scene contract are in the library's skill: `~/Daisy Live Library/.claude/skills/daisy-scenes/SKILL.md`.

## Run it

```sh
bun install
bun run start            # builds the switcher, serves everything on http://localhost:7420
# or, while working on the app itself:
bun run dev              # server on :7420 (watch) + Vite on http://localhost:5173
```

Environment (all optional):

| var | default |
|---|---|
| `DAISY_LIBRARY` | `~/Daisy Live Library` |
| `PORT` | `7420` |
| `HOST` | `127.0.0.1` (Tailscale serve proxies to it) |
| `OBS_URL` / `OBS_PASSWORD` | `ws://127.0.0.1:4455` / none |
| `OBS_SCENE` / `OBS_PROGRAM_SOURCE` | `Daisy Live` / `Daisy Program` |
| `OBS_DEVICES` | `Camera,Screen,iPad` (sources a scene can place; others stay untouched) |
| `DAISY_EDITOR` | app for "Open the file", e.g. `Cursor` (default: your text editor) |

## OBS setup (once)

1. OBS → Tools → WebSocket Server Settings: enable it, and set a password if you like (then pass `OBS_PASSWORD`).
2. With the server running: `bun run obs:setup`. This creates the scene, the program browser source and the ground color, and switches OBS to the scene.
3. Add your devices to the "Daisy Live" scene with these exact names: **Camera** (video capture), **Screen** (macOS Screen Capture), **iPad** (the iPad over USB as a video capture device).
4. Run `bun run obs:setup` again to put the browser source back on top.

If a scene asks for a slot whose OBS source doesn't exist, the switcher shows a warning.

## iPad over Tailscale

```sh
tailscale serve --bg 7420
```

Open the `https://<this-mac>.<tailnet>.ts.net` address on the iPad, then Share → Add to Home Screen.

## Repo layout

```
apps/server      Bun server: API, library files + watcher, live state, OBS placement, obs:setup
apps/web         Vite + React + TanStack Router/Query SPA: switcher + /program (Capacitor wraps this later)
packages/shared  types and pure logic: resolveStream (override rule), coverTransform (slot → OBS)
ios/inkcast      parked Swift Pencil app (InkCast); the Capacitor app replaces it later
post/            YouTube post pipeline (was daisy-video); see post/README.md
```

`bun test` runs the shared logic and path-safety tests.

## Roadmap

1. ~~Switcher, library, program page, OBS placement, skill~~ (this slice)
2. Ink layer: InkCast Pencil drawing as a layer in `/program`
3. Post pipeline on the Daisy brand (Fraunces / Instrument Sans, forest palette)
4. Capacitor iPad app wrapping `apps/web`, with a native Pencil canvas

Scenes are edited by talking to Claude Code (or any agent) in `~/Daisy Live Library`; its `daisy-scenes` skill covers the rules. The switcher only switches and organizes.
