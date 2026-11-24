# Daisy Production

Everything for producing Daisy Debate video: **live** (scene switcher + OBS) and **post** (the YouTube editing pipeline in `post/`).

## Live: how it works

- Every on-air screen is a plain HTML file in the **Daisy Production Library** (`~/Daisy Production Library`, its own git repo).
- The switcher (a web app on the Mac, opened on the iPad over Tailscale) shows the files as covers. Tap a cover to put it on air.
- OBS has one scene with one browser source showing `/program`. Each scene file marks device boxes with `data-slot="Camera"` and similar. The server moves and crops those OBS sources into the boxes over obs-websocket.

```
OBS scene "Daisy Live"
├─ Daisy Program   browser source → http://localhost:7420/program   (top)
├─ Camera · Screen · iPad                                          (moved per scene)
└─ Daisy Ground    color source #0d1812                             (bottom)
```

Library layout, the stream-over-project override rule and the scene contract are in the library's skill: `~/Daisy Production Library/.claude/skills/daisy-scenes/SKILL.md`.

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
| `DAISY_LIBRARY` | `~/Daisy Production Library` |
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

**If scenes don't show in OBS** (the program source stays blank, even for a normal web page), turn off OBS → Settings → Advanced → Sources → "Enable Browser Source Hardware Acceleration" and restart OBS. On this Mac (OBS 32.1, macOS 26), OBS's embedded browser never starts with it on.

Debugging the program page: run the server with `DAISY_LOG=1`. Requests, WebSocket connections and errors from the OBS browser (which has no devtools) are printed to the server log.

## iPad: ViewSwitcher app (USB-C)

`apps/viewswitcher` is a Capacitor app that runs the switcher on the iPad over the **USB-C cable**: low latency, and no dependence on Wi-Fi.

```sh
bun run viewswitcher:deploy   # build, sign, install and launch on the plugged-in iPad
```

One-time requirements:
- Your Apple ID is signed into Xcode (Settings → Accounts). The team defaults to `M96WTV3CKX`; set `TEAM=` to override.
- Developer Mode is on, on the iPad.
- The iPad trusts this Mac.

How the link works: iOS gives apps no network over the cable. The only path is usbmuxd, and it only connects Mac → iPad.
- The Daisy server (`apps/server/src/usb-bridge.ts`) keeps a few idle tunnels open to the app on iPad port 7421.
- The app (`ios/App/App/UsbTunnel.swift`) serves `127.0.0.1:7420` on the iPad and pipes each WebView connection through one of those tunnels to the server.
- So the app simply loads `http://127.0.0.1:7420/`, the real switcher, served over the cable. A "USB" pill in the header confirms it.

The server log shows `[usb] … tunnels ready` when the app is connected. Set `DAISY_USB=0` to turn the bridge off.

**Without the cable:** the app's connector page falls back to a network address you save on it, such as Tailscale:

```sh
tailscale serve --bg 7420
```

Then enter `https://<this-mac>.<tailnet>.ts.net` on the connector. The same address also works in Safari (Share → Add to Home Screen). If the link drops for 4 s, the app returns to the connector, which picks whichever link works.

## Repo layout

```
apps/server      Bun server: API, library files + watcher, live state, OBS placement, obs:setup
apps/web         Vite + React + TanStack Router/Query SPA: switcher + /program
apps/viewswitcher  Capacitor iPad app: connector page + native USB-C tunnel to the server
packages/shared  types and pure logic: resolveStream (override rule), coverTransform (slot → OBS)
ios/inkcast      parked Swift Pencil app (InkCast); its drawing moves into ViewSwitcher later
post/            YouTube post pipeline (was daisy-video); see post/README.md
```

`bun test` runs the shared logic and path-safety tests.

## Roadmap

1. ~~Switcher, library, program page, OBS placement, skill~~ (this slice)
2. Ink layer: InkCast Pencil drawing as a layer in `/program`
3. Post pipeline on the Daisy brand (Fraunces / Instrument Sans, forest palette)
4. ~~ViewSwitcher iPad app over USB-C~~; next, a native Pencil canvas in it

Scenes are edited by talking to Claude Code (or any agent) in `~/Daisy Production Library`; its `daisy-scenes` skill covers the rules. The switcher only switches and organizes.
