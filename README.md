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
- **Scenes are files you edit by talking to an agent** (Claude Code, Claude Desktop, Cursor, Codex or any other), connected over MCP (below) and using the library's `viewswitcher-scenes` skill. The switcher only switches and organizes.
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

## Agents (MCP)

ViewSwitcher is an MCP server for the AI agent you already use. **Edit with AI** (in the switcher's header, and in the Mac menu bar) connects one in a step and shows whether one is connected.

- **Endpoint:** Streamable HTTP at `http://127.0.0.1:7420/mcp` (stateless, JSON responses). Only this Mac may use it: a loopback connection to a loopback host, with no proxy headers and no other site's `Origin`. Tailscale, Bonjour names and other machines get 404.
- **stdio**, for clients that only launch commands: `/Applications/ViewSwitcher.app/Contents/Helpers/viewswitcher-server --mcp-stdio` (from source, `bun apps/server/src/index.ts --mcp-stdio`). It relays to the running switcher and never starts a second one; it opens the app if nothing answers.
- **Connecting:** the library has `.mcp.json` (Claude Code, which asks once to allow it), `.cursor/mcp.json` and `AGENTS.md` (with the Codex snippet). Edit with AI adds a per-install Claude Desktop extension (`.mcpb`), a Cursor install link, and the URL, stdio command and Codex TOML for the rest.
- **Tools:** `get_state`, `list_orgs`, `scan_library`, `list_files`, `read_file`, `get_guide` to read; `preview_scene`, `see_program` to look; `write_file`, `add_asset`, `create_project`, `create_stream`, `scene_from_template`, `customize_scene`, `revert_scene`, `duplicate_scene`, `rename_scene`, `customize_transition`, `revert_transition` to change; `go_on_air`. Paths start with the org id; writes to an existing file need the hash from `read_file`, as in the switcher's editor.
- **Previews:** `preview_scene` renders a library scene in OBS, in a muted "ViewSwitcher Preview" scene that's never switched to, and returns the picture; `see_program` returns what OBS is putting out, camera and screen included. Without OBS, they return the scene's preview URL instead.
- **On air:** the agent setting (Edit with AI; `.viewswitcher/settings.json`) says what agents may put on air: **Never**, **When not live** (the default: not while OBS is streaming or recording, and no changes then to the scene on air, its transition or the org's shared files) or **Always**. It limits agents only, never people in the switcher.

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
| `HOST` | `127.0.0.1` (Tailscale serve proxies to it) |
| `OBS_URL` / `OBS_PASSWORD` | `ws://127.0.0.1:4455` / read from OBS's own settings on this Mac |
| `OBS_SCENE` / `OBS_PROGRAM_SOURCE` / `OBS_GROUND_SOURCE` | `ViewSwitcher` / `ViewSwitcher Program` / `ViewSwitcher Ground` |
| `OBS_DEVICES` | `Camera,Screen,iPad` (sources a scene can place; others stay untouched) |
| `VIEWSWITCHER_EDITOR` | app for "Open the file", e.g. `Cursor` (default: your text editor) |
| `VIEWSWITCHER_LOG` | `1` prints requests, placements and OBS-browser errors |
| `VIEWSWITCHER_USB` | `0` turns off the USB-C bridge |
| `VIEWSWITCHER_WEB_DIST` / `VIEWSWITCHER_STARTER` / `VIEWSWITCHER_LIBRARY_KIT` | `apps/web/dist` / `apps/server/starter` / `apps/server/library-kit` (the Mac app points these into its Resources) |
| `VIEWSWITCHER_UPDATES` | Mac app: `0` turns off checking for updates |
| `VIEWSWITCHER_VERSION` | set by the Mac app to its version, which the Claude Desktop extension carries (default `1.0.0`) |
| `VIEWSWITCHER_REPO` | Mac app, Debug builds without a bundled server: run `bun <repo>/apps/server/src/index.ts` (set by `mac:dev`) |
| `VIEWSWITCHER_ORIGINS` | extra addresses the switcher is reached at, e.g. `http://192.168.1.20:7420` (comma-separated). The server answers only to this Mac's loopback names, `*.ts.net` and `*.local`, and refuses changes sent by other websites |

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

**Without the cable:** the app's connector page falls back to a network address you save on it, such as Tailscale (`tailscale serve --bg 7420`, then `https://<this-mac>.<tailnet>.ts.net`). The same address also works in Safari. If the link drops for 4 s, the app returns to the connector, which picks whichever link works.

## Repo layout

```
apps/server      Bun server: API, library + watcher, orgs, live state, OBS placement and setup, USB bridge
apps/server/starter   the starter kit copied into each new org
apps/server/library-kit   what a new library starts with: the agent skill, CLAUDE.md, AGENTS.md, MCP configs, .gitignore
apps/server/src/mcp   the MCP server for agents (/mcp and --mcp-stdio)
apps/web         Vite + React + TanStack Router/Query SPA: switcher + /program
apps/apple       one Xcode project (XcodeGen): ViewSwitcher.app for macOS, ViewSwitcher for iPad, the shared ViewSwitcherKit
apps/site        viewswitcher.com (Astro)
packages/shared  types and pure logic: resolveStream (override rule), coverTransform (slot → OBS), obsColor
ios/inkcast      parked Swift Pencil app (InkCast); its drawing moves into the iPad app later
post/            YouTube post pipeline (from Daisy Debate's daisy-video); see post/README.md
```

`bun test` runs the shared logic, usbmux protocol, path-safety, library kit and OBS setup tests; the Apple apps have XCTest (`xcodebuild test`, see apps/apple/README.md).

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
