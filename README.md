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
- **Scenes are files you edit by talking to an agent** (Claude Code or any other) in the library, using its `viewswitcher-scenes` skill. The switcher switches and organizes, and its scene editor does light edits: retype text, move and resize, add, and drop a picture onto a scene.
- **Style packs**: a whole look in one folder or `.zip`. Drop one on the Templates page and it installs as its own set of templates in the org's name and colors ([docs/style-packs.md](docs/style-packs.md)).
- **iPad app over USB-C**: the ViewSwitcher iPad app talks to the Mac over the cable, for low latency and no dependence on Wi-Fi.

## How it works

```
~/ViewSwitcher Library/            (its own git repo; VIEWSWITCHER_LIBRARY)
├─ daisy/  personal/  bible-study/  pagespace/  …   one folder per org
│  ├─ org.json                     { name, accent, ground }
│  ├─ BRAND.md                     the org's brand rules, for agents
│  ├─ templates/*.html, templates/_shared/{theme.css, scene.js, transition.html, brand/mark.svg}
│  ├─ templates/<set>/              a template set installed from a style pack: pack.json, views, _shared/, assets/
│  ├─ assets/
│  └─ projects/<project>/{project.json, transition.html?, scenes/*.html, streams/<MM-DD-slug>/*.html}
└─ .claude/skills/viewswitcher-scenes/SKILL.md     from apps/server/library-kit (changes ship there)
```

Scenes run sandboxed: every library page is served with a CSP sandbox and shown in sandboxed frames, so a scene's scripts (an agent's, or a stranger's style pack) can't reach the switcher's API. The program page reads slot positions through a small bridge over `postMessage` ([docs/style-packs.md](docs/style-packs.md#scripts-and-the-sandbox)).

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
bun run mac:dev          # builds the Mac app (Debug) and runs it, attached to the server above (or starting one from source)
```

Environment (all optional; the Mac app passes them through to its server):

| var | default |
|---|---|
| `VIEWSWITCHER_LIBRARY` | `~/ViewSwitcher Library` |
| `PORT` | `7420` |
| `HOST` | `127.0.0.1` (Tailscale serve proxies to it). Loopback only: the server refuses to start with another address; the Wi-Fi setting is the way onto the network (below) |
| `VIEWSWITCHER_LAN` | `1` also listens on the Wi-Fi from the start (the Mac app passes its "Let Phones and Tablets on This Wi-Fi Connect" setting) |
| `VIEWSWITCHER_LAN_HOST` | `0.0.0.0`: the address the Wi-Fi listener binds (tests bind this Mac's LAN IP) |
| `VIEWSWITCHER_ADMIN_TOKEN` | set by the Mac app at each launch: the secret for the pairing endpoints (`/api/remote…`); unset, they answer 404 |
| `OBS_URL` / `OBS_PASSWORD` | `ws://127.0.0.1:4455` / read from OBS's own settings on this Mac |
| `OBS_SCENE` / `OBS_PROGRAM_SOURCE` / `OBS_GROUND_SOURCE` | `ViewSwitcher` / `ViewSwitcher Program` / `ViewSwitcher Ground` |
| `OBS_DEVICES` | `Camera,Screen,iPad` (sources a scene can place; others stay untouched) |
| `VIEWSWITCHER_EDITOR` | app for "Open the file", e.g. `Cursor` (default: your text editor) |
| `VIEWSWITCHER_LOG` | `1` prints requests, placements and OBS-browser errors |
| `VIEWSWITCHER_USB` | `0` turns off the USB-C bridge |
| `VIEWSWITCHER_WEB_DIST` / `VIEWSWITCHER_STARTER` / `VIEWSWITCHER_LIBRARY_KIT` | `apps/web/dist` / `apps/server/starter` / `apps/server/library-kit` (the Mac app points these into its Resources) |
| `VIEWSWITCHER_UPDATES` | Mac app: `0` turns off checking for updates |
| `VIEWSWITCHER_REPO` | Mac app, Debug builds without a bundled server: run `bun <repo>/apps/server/src/index.ts` (set by `mac:dev`) |
| `VIEWSWITCHER_ORIGINS` | extra addresses the switcher is reached at, e.g. `http://192.168.1.20:7420` (comma-separated). The server answers only to this Mac's loopback names, `*.ts.net`, and (while Wi-Fi is on) this Mac's own `<name>.local` and LAN addresses, and refuses changes sent by other websites |

## OBS setup (once)

1. OBS → Tools → WebSocket Server Settings: enable it.
2. In the switcher, press **Set up OBS** on the card at the top (or, from source, `bun run obs:setup`). This creates the scene, the program browser source and the ground color, and switches OBS to the scene. (It also renames the older "Daisy Live" scene and sources if it finds them.)
3. Add your devices to the "ViewSwitcher" scene with these exact names: **Camera** (video capture), **Screen** (macOS Screen Capture), **iPad** (the iPad over USB as a video capture device). The card lists the ones still missing.
4. Press **Set up OBS again** to put the browser source back on top. The card goes away once everything is there.

If a scene asks for a slot whose OBS source doesn't exist, the switcher shows a warning.

**If scenes don't show in OBS** (the program source stays blank, even for a normal web page), turn off OBS → Settings → Advanced → Sources → "Enable Browser Source Hardware Acceleration" and restart OBS. On macOS 26 with OBS 32.1, OBS's embedded browser never starts with it on.

## iPad app (USB-C)

The ViewSwitcher iPad app is the `ViewSwitcher iPad` target in `apps/apple` (native Swift, WKWebView).

```sh
bun run ipad:deploy   # build, sign, install and launch on the plugged-in iPad (replaces the app on it)
```

The app's web view adds `ViewSwitcher-iPad/<version>` to its user agent; that's how the switcher knows it's in the app (and the Mac app's window, which says `ViewSwitcher-Mac/<version>`, knows it isn't). Older builds added `ViewSwitcher-iPad` or plain `ViewSwitcher`, which still work until the next deploy. Its bundled connector page lives at `viewswitcher://connector/`. The web view runs edge to edge and the switcher keeps clear of the safe area itself (`env(safe-area-inset-*)`) in every orientation, Split View and Stage Manager.

One-time requirements: your Apple ID is signed into Xcode (Settings → Accounts; the team defaults to `M96WTV3CKX`, set `TEAM=` to override), Developer Mode is on, on the iPad, and the iPad trusts this Mac.

How the link works: iOS gives apps no network over the cable. The only path is usbmuxd, and it only connects Mac → iPad.
- The server (`apps/server/src/usb-bridge.ts`) keeps a few idle tunnels open to the app on iPad port 7421.
- The app (`apps/apple/iPad/UsbTunnel.swift`) serves `127.0.0.1:7420` on the iPad and pipes each WebView connection through one of those tunnels to the server.
- So the app simply loads `http://127.0.0.1:7420/`, the real switcher, served over the cable. A "USB" pill in the header confirms it, the Mac's switcher and menu bar show "iPad · USB", and the server log shows `[usb] … tunnels ready`.

**Without the cable:** the app's connector page falls back to a network address you save on it: the Mac's `http://<name>.local:7420` once Wi-Fi pairing is on (below), or a Tailscale address (`tailscale serve --bg 7420`, then `https://<this-mac>.<tailnet>.ts.net`). Either way the iPad pairs once with a code from the Mac. The same address also works in Safari. If the link drops for 4 s, the app returns to the connector, which picks whichever link works. (User-facing copy never names Tailscale; it's a developer path.)

## Phones and tablets over Wi-Fi (MAC-23 … MAC-27)

Off by default. In the Mac app's menu, **Let Phones and Tablets on This Wi-Fi Connect** opens a second listener on the network (and announces it over Bonjour); **Phones and Tablets…** shows a one-time code, its QR code and the paired devices.

- **Who gets in** (`apps/server/src/gate.ts`): a request is "this Mac" only if the socket's remote address is loopback, the Host is a loopback name, and it carries no proxy headers. That's the Mac app, browsers on the Mac, OBS's program page and the USB-C iPad (its tunnel ends on 127.0.0.1): unchanged. Everything else (the Wi-Fi, and anything forwarded, such as tailscale serve) needs a paired device token; without one it gets the pairing page and 401 for everything else (API, `/library`, `/ws`, assets).
- **Codes** (`pairing.ts`): 8 characters, 5 minutes, single use, one open at a time; 5 wrong guesses per address per 5 minutes (behind a local proxy, per forwarded client), and a code is cancelled after 10 wrong guesses, which the Mac window points out. An expired code isn't counted as a guess. The pairing POST is at most 2 KB. **Device tokens**: 32 random bytes in an `HttpOnly; SameSite=Strict` cookie (`vs_device`), sent again once a day while the device is used, so it lasts 400 days from last use; only their SHA3-256 hash is kept, in `<library>/.viewswitcher/devices.json` (0600, gitignored). Secrets are compared by hashing both sides with SHA3-256.
- **Remove** a device in the window: its token stops at once, its live socket closes, and devices.json is written before the window hears back (and again on quit), so a quit or crash can't bring it back.
- **The live socket** (`/ws`) refuses a cross-site Origin, so a website open in a browser on the Mac can't read it. **Turning Wi-Fi off** closes the listener and drops every Wi-Fi socket; devices stay paired for next time.
- **Pairing endpoints** (`/api/remote`, `/api/remote/code`, `/api/remote/remove`) answer only this Mac with the secret the app started the server with (`VIEWSWITCHER_ADMIN_TOKEN`), so a paired phone can't mint codes or remove devices. `/api/info` stays loopback only.
- **Known limit**: Wi-Fi traffic is plain HTTP (no self-signed TLS). The setting says to use it on networks you trust, like home or church Wi-Fi.
- On a phone (≤ 600 px) the switcher is a remote: the library folds into a button, scenes come in two columns, and what's on air with EDIT, REC and GO LIVE stays at the bottom, above the home indicator.

## Repo layout

```
apps/server      Bun server: API, library + watcher, orgs, live state, OBS placement and setup, USB bridge
apps/server/starter   the starter kit copied into each new org
apps/server/library-kit   what a new library starts with: the agent skill, CLAUDE.md, .gitignore
apps/web         Vite + React + TanStack Router/Query SPA: switcher + /program
apps/apple       one Xcode project (XcodeGen): ViewSwitcher.app for macOS, ViewSwitcher for iPad, the shared ViewSwitcherKit
apps/site        viewswitcher.com (Astro)
packages/shared  types and pure logic: resolveStream (override rule), coverTransform (slot → OBS), obsColor
ios/inkcast      parked Swift Pencil app (InkCast); its drawing moves into the iPad app later
post/            YouTube post pipeline (from Daisy Debate's daisy-video); see post/README.md
```

`bun run packs:export` writes the starter kit and the site's six example styles as style packs (`dist/packs/<id>.zip`).

`bun test` runs the shared logic, usbmux protocol, path-safety, library kit, style pack and OBS setup tests; the Apple apps have XCTest (`xcodebuild test`, see apps/apple/README.md).

## Mac app

ViewSwitcher.app is the `ViewSwitcher` target in `apps/apple`: a native window (WKWebView) and menu-bar item around the server, compiled by `bun build --compile` into `Contents/Helpers/viewswitcher-server` next to the built switcher, the starter kit and the library kit in `Contents/Resources`. If a ViewSwitcher server already answers on `PORT`, the app uses it instead of starting its own, and never stops a server it didn't start.

```sh
bun run mac:build              # apps/apple/build/ViewSwitcher.dmg (universal) + appcast.xml, signed with the Developer ID in your keychain
bun run mac:build --app        # just apps/apple/build/export/ViewSwitcher.app, then:
bun run mac:e2e                # drives the built app on port 7435 with OBS offline and USB off
bun run mac:release            # signed, notarized and stapled (needs the notarytool profile below)
bun run mac:release --publish  # ...and uploads it to a draft GitHub release for a person to publish
```

Signing uses the "Developer ID Application" certificate for team M96WTV3CKX (`TEAM=` to override); what each binary is entitled to is in `apps/apple/README.md`. Notarizing needs a notarytool keychain profile, made once with `xcrun notarytool store-credentials viewswitcher-notary --apple-id <email> --team-id M96WTV3CKX` (`APPLE_KEYCHAIN_PROFILE=` to use another). Updates: Sparkle reads `appcast.xml` from the latest GitHub release, signed with an EdDSA key in the login keychain; the dmg is named `ViewSwitcher.dmg` because the site links to `releases/latest/download/ViewSwitcher.dmg`.

## Roadmap

1. ~~Switcher, library, program page, OBS placement, skill~~
2. ~~iPad app over USB-C~~
3. ~~Orgs~~
4. ~~Mac app: a signed dmg with the server inside, first-run library and OBS setup, menu-bar status~~
5. Ink layer: Pencil drawing from the iPad as a layer in `/program`
6. Post pipeline per org (it's Daisy-styled today)
