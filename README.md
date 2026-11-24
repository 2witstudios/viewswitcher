# ViewSwitcher

A scene switcher for live streams on macOS. Every on-air screen is a plain HTML file; tap a cover on the iPad (or in a browser) and it goes on air in OBS, with your camera, screen and iPad moved into place.

## Install

1. Download **[ViewSwitcher.dmg](https://github.com/2witstudios/viewswitcher/releases/latest/download/ViewSwitcher.dmg)** (one download for Apple silicon and Intel Macs).
2. Open it and drag ViewSwitcher to Applications. Open ViewSwitcher.
3. The first time, it creates your library in `~/ViewSwitcher Library`, with the agent skill and a first org, "My channel".
4. In OBS, turn on Tools → WebSocket Server Settings → **Enable WebSocket server**. The switcher then shows a **Set up OBS** card: press it, and add your Camera, Screen and iPad sources when it asks.

The menu bar shows what's on air and whether OBS and the iPad are connected. Closing the window keeps ViewSwitcher running for OBS and the iPad; Quit (in the menu bar or ⌘Q) stops it. The app updates itself from GitHub Releases.

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
└─ .claude/skills/viewswitcher-scenes/SKILL.md     from apps/server/library-kit (changes ship there)
```

OBS has one scene with one browser source showing `/program`. Each scene file marks device boxes with `data-slot="Camera"` and similar; the server moves and crops those OBS sources into the boxes over obs-websocket, and paints the ground color of the org that's on air.

```
OBS scene "ViewSwitcher"
├─ ViewSwitcher Program   browser source → http://127.0.0.1:7420/program   (top)
├─ Camera · Screen · iPad                                                 (moved per scene)
└─ ViewSwitcher Ground    color source, set to the on-air org's ground     (bottom)
```

**Transitions** are pages too. Switching scenes briefly covers the screen with the scene's transition page: its project's own `transition.html` if it has one, else the org's `templates/_shared/transition.html`, else (the default) a blank fade through the ground color. The switcher shows the transition on the Templates page and on each stream page, where "Customize for this project" gives a project its own.

New orgs are created from the org menu in the sidebar. They start from `apps/server/starter/`: neutral templates using the org's name and accent color, ready to be branded.

## Development

Running from source needs [Bun](https://bun.sh):

```sh
bun install
bun run start            # builds the switcher, serves everything on http://localhost:7420
# or, while working on the app itself:
bun run dev              # server on :7420 (watch) + Vite on http://localhost:5173
bun run mac:dev          # the Mac app's window and menu bar, attached to the server above (or starting one from source)
```

Environment (all optional; the Mac app passes them through to its server):

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
| `VIEWSWITCHER_WEB_DIST` / `VIEWSWITCHER_STARTER` / `VIEWSWITCHER_LIBRARY_KIT` | `apps/web/dist` / `apps/server/starter` / `apps/server/library-kit` (the Mac app points these into its Resources) |
| `VIEWSWITCHER_UPDATES` | Mac app: `0` turns off checking for updates |
| `VIEWSWITCHER_ORIGINS` | extra addresses the switcher is reached at, e.g. `http://192.168.1.20:7420` (comma-separated). The server answers only to this Mac's loopback names, `*.ts.net` and `*.local`, and refuses changes sent by other websites |

## OBS setup (once)

1. OBS → Tools → WebSocket Server Settings: enable it.
2. In the switcher, press **Set up OBS** on the card at the top (or, from source, `bun run obs:setup`). This creates the scene, the program browser source and the ground color, and switches OBS to the scene. (It also renames the older "Daisy Live" scene and sources if it finds them.)
3. Add your devices to the "ViewSwitcher" scene with these exact names: **Camera** (video capture), **Screen** (macOS Screen Capture), **iPad** (the iPad over USB as a video capture device). The card lists the ones still missing.
4. Press **Set up OBS again** to put the browser source back on top. The card goes away once everything is there.

If a scene asks for a slot whose OBS source doesn't exist, the switcher shows a warning.

**If scenes don't show in OBS** (the program source stays blank, even for a normal web page), turn off OBS → Settings → Advanced → Sources → "Enable Browser Source Hardware Acceleration" and restart OBS. On macOS 26 with OBS 32.1, OBS's embedded browser never starts with it on.

## iPad app (USB-C)

`apps/ipad` is the ViewSwitcher iPad app (Capacitor).

```sh
bun run ipad:deploy   # build, sign, install and launch on the plugged-in iPad
```

The app's WebView adds `ViewSwitcher-iPad` to its user agent; that's how the switcher knows it's in the app (and the Mac app's window, which says `ViewSwitcher-Mac`, knows it isn't). Builds from before the Mac app added plain `ViewSwitcher`, which still works until the next deploy.

One-time requirements: your Apple ID is signed into Xcode (Settings → Accounts; the team defaults to `M96WTV3CKX`, set `TEAM=` to override), Developer Mode is on, on the iPad, and the iPad trusts this Mac.

How the link works: iOS gives apps no network over the cable. The only path is usbmuxd, and it only connects Mac → iPad.
- The server (`apps/server/src/usb-bridge.ts`) keeps a few idle tunnels open to the app on iPad port 7421.
- The app (`apps/ipad/ios/App/App/UsbTunnel.swift`) serves `127.0.0.1:7420` on the iPad and pipes each WebView connection through one of those tunnels to the server.
- So the app simply loads `http://127.0.0.1:7420/`, the real switcher, served over the cable. A "USB" pill in the header confirms it, the Mac's switcher and menu bar show "iPad · USB", and the server log shows `[usb] … tunnels ready`.

**Without the cable:** the app's connector page falls back to a network address you save on it, such as Tailscale (`tailscale serve --bg 7420`, then `https://<this-mac>.<tailnet>.ts.net`). The same address also works in Safari. If the link drops for 4 s, the app returns to the connector, which picks whichever link works.

## Repo layout

```
apps/server      Bun server: API, library + watcher, orgs, live state, OBS placement and setup, USB bridge
apps/server/starter   the starter kit copied into each new org
apps/server/library-kit   what a new library starts with: the agent skill, CLAUDE.md, .gitignore
apps/web         Vite + React + TanStack Router/Query SPA: switcher + /program
apps/mac         ViewSwitcher.app: Electron window + menu bar around the compiled server
apps/ipad        ViewSwitcher iPad app: connector page + native USB-C tunnel
apps/site        viewswitcher.com (Astro)
packages/shared  types and pure logic: resolveStream (override rule), coverTransform (slot → OBS), obsColor
ios/inkcast      parked Swift Pencil app (InkCast); its drawing moves into the iPad app later
post/            YouTube post pipeline (from Daisy Debate's daisy-video); see post/README.md
```

`bun test` runs the shared logic, usbmux protocol, path-safety, library kit, OBS setup and Mac app tests.

## Mac app

`apps/mac` is ViewSwitcher.app: Electron, with the server compiled by `bun build --compile` into `Contents/Resources/viewswitcher-server` (a sidecar) next to the built switcher, the starter kit and the library kit. If a ViewSwitcher server already answers on `PORT`, the app uses it instead of starting its own, and never stops a server it didn't start.

```sh
bun run mac:build              # release/ViewSwitcher.dmg (universal) + arm64/x64 zips, signed with the Developer ID in your keychain
bun run mac:build --dir        # just release/mac-arm64/ViewSwitcher.app, then:
bun apps/mac/scripts/e2e.ts    # drives the built app on port 7433 with OBS offline and USB off
bun run mac:release            # signed, notarized and stapled (needs the notarytool profile below)
bun run mac:release --publish  # ...and uploads it to a draft GitHub release for a person to publish
```

Signing uses the "Developer ID Application" certificate for team M96WTV3CKX (`TEAM=` to override); what each binary is entitled to is in `apps/mac/build/README.md`. Notarizing needs a notarytool keychain profile, made once with `xcrun notarytool store-credentials viewswitcher-notary --apple-id <email> --team-id M96WTV3CKX` (`APPLE_KEYCHAIN_PROFILE=` to use another). Updates: electron-updater reads `latest-mac.yml` and the zips from the latest GitHub release; the dmg is named `ViewSwitcher.dmg` because the site links to `releases/latest/download/ViewSwitcher.dmg`.

## Roadmap

1. ~~Switcher, library, program page, OBS placement, skill~~
2. ~~iPad app over USB-C~~
3. ~~Orgs~~
4. ~~Mac app: a signed dmg with the server inside, first-run library and OBS setup, menu-bar status~~
5. Ink layer: Pencil drawing from the iPad as a layer in `/program`
6. Post pipeline per org (it's Daisy-styled today)
