# ViewSwitcher

A scene switcher for live streams on macOS. Every on-air screen is a plain HTML file; tap a cover on the iPad (or in a browser) and it goes on air in OBS, with your camera, screen and iPad moved into place.

- **Orgs**: one library holds any number of orgs (brands or channels). Each has its own templates, assets, projects and brand.
- **Projects and streams**: a project is a series with shared scenes; a stream is one dated episode that can override any of them.
- **Scenes are files you edit by talking to an agent** (Claude Code or any other) in the library, using its `viewswitcher-scenes` skill. The switcher only switches and organizes.
- **iPad app over USB-C**: the ViewSwitcher iPad app talks to the Mac over the cable, for low latency and no dependence on Wi-Fi.

## How it works

```
~/ViewSwitcher Library/            (its own git repo; VIEWSWITCHER_LIBRARY)
├─ daisy/  personal/  bible-study/  pagespace/  …   one folder per org
│  ├─ org.json                     { name, accent, ground }
│  ├─ BRAND.md                     the org's brand rules, for agents
│  ├─ templates/*.html, templates/_shared/{theme.css, scene.js, transition.html, brand/mark.svg}
│  ├─ assets/
│  └─ projects/<project>/{project.json, transition.html?, scenes/*.html, streams/<MM-DD-slug>/*.html}
└─ .claude/skills/viewswitcher-scenes/SKILL.md
```

OBS has one scene with one browser source showing `/program`. Each scene file marks device boxes with `data-slot="Camera"` and similar; the server moves and crops those OBS sources into the boxes over obs-websocket, and paints the ground color of the org that's on air.

```
OBS scene "ViewSwitcher"
├─ ViewSwitcher Program   browser source → http://127.0.0.1:7420/program   (top)
├─ Camera · Screen · iPad                                                 (moved per scene)
└─ ViewSwitcher Ground    color source, set to the on-air org's ground     (bottom)
```

**Transitions** are pages too. Switching scenes briefly covers the screen with the scene's transition page: its project's own `transition.html` if it has one, else the org's `templates/_shared/transition.html`, else just the ground color. The switcher shows the transition on the Templates page and on each stream page, where "Customize for this project" gives a project its own.

New orgs are created from the org menu in the sidebar. They start from `apps/server/starter/`: neutral templates using the org's name and accent color, ready to be branded.

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
| `VIEWSWITCHER_LIBRARY` | `~/ViewSwitcher Library` |
| `PORT` | `7420` |
| `HOST` | `127.0.0.1` (Tailscale serve proxies to it) |
| `OBS_URL` / `OBS_PASSWORD` | `ws://127.0.0.1:4455` / read from OBS's own settings on this Mac |
| `OBS_SCENE` / `OBS_PROGRAM_SOURCE` / `OBS_GROUND_SOURCE` | `ViewSwitcher` / `ViewSwitcher Program` / `ViewSwitcher Ground` |
| `OBS_DEVICES` | `Camera,Screen,iPad` (sources a scene can place; others stay untouched) |
| `VIEWSWITCHER_EDITOR` | app for "Open the file", e.g. `Cursor` (default: your text editor) |
| `VIEWSWITCHER_LOG` | `1` prints requests, placements and OBS-browser errors |
| `VIEWSWITCHER_USB` | `0` turns off the USB-C bridge |

## OBS setup (once)

1. OBS → Tools → WebSocket Server Settings: enable it.
2. With the server running: `bun run obs:setup`. This creates the scene, the program browser source and the ground color, and switches OBS to the scene. (It also renames the older "Daisy Live" scene and sources if it finds them.)
3. Add your devices to the "ViewSwitcher" scene with these exact names: **Camera** (video capture), **Screen** (macOS Screen Capture), **iPad** (the iPad over USB as a video capture device).
4. Run `bun run obs:setup` again to put the browser source back on top.

If a scene asks for a slot whose OBS source doesn't exist, the switcher shows a warning.

**If scenes don't show in OBS** (the program source stays blank, even for a normal web page), turn off OBS → Settings → Advanced → Sources → "Enable Browser Source Hardware Acceleration" and restart OBS. On macOS 26 with OBS 32.1, OBS's embedded browser never starts with it on.

## iPad app (USB-C)

`apps/ipad` is the ViewSwitcher iPad app (Capacitor).

```sh
bun run ipad:deploy   # build, sign, install and launch on the plugged-in iPad
```

One-time requirements: your Apple ID is signed into Xcode (Settings → Accounts; the team defaults to `M96WTV3CKX`, set `TEAM=` to override), Developer Mode is on, on the iPad, and the iPad trusts this Mac.

How the link works: iOS gives apps no network over the cable. The only path is usbmuxd, and it only connects Mac → iPad.
- The server (`apps/server/src/usb-bridge.ts`) keeps a few idle tunnels open to the app on iPad port 7421.
- The app (`apps/ipad/ios/App/App/UsbTunnel.swift`) serves `127.0.0.1:7420` on the iPad and pipes each WebView connection through one of those tunnels to the server.
- So the app simply loads `http://127.0.0.1:7420/`, the real switcher, served over the cable. A "USB" pill in the header confirms it, and the server log shows `[usb] … tunnels ready`.

**Without the cable:** the app's connector page falls back to a network address you save on it, such as Tailscale (`tailscale serve --bg 7420`, then `https://<this-mac>.<tailnet>.ts.net`). The same address also works in Safari. If the link drops for 4 s, the app returns to the connector, which picks whichever link works.

## Repo layout

```
apps/server      Bun server: API, library + watcher, orgs, live state, OBS placement, USB bridge, obs:setup
apps/server/starter   the starter kit copied into each new org
apps/web         Vite + React + TanStack Router/Query SPA: switcher + /program
apps/ipad        ViewSwitcher iPad app: connector page + native USB-C tunnel
packages/shared  types and pure logic: resolveStream (override rule), coverTransform (slot → OBS), obsColor
ios/inkcast      parked Swift Pencil app (InkCast); its drawing moves into the iPad app later
post/            YouTube post pipeline (from Daisy Debate's daisy-video); see post/README.md
```

`bun test` runs the shared logic, usbmux protocol and path-safety tests.

## Roadmap

1. ~~Switcher, library, program page, OBS placement, skill~~
2. ~~iPad app over USB-C~~
3. ~~Orgs~~
4. Ink layer: Pencil drawing from the iPad as a layer in `/program`
5. Post pipeline per org (it's Daisy-styled today)
