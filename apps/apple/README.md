# apps/apple: ViewSwitcher for Mac and iPad

One Xcode project, generated from `project.yml` with [XcodeGen](https://github.com/yonaskolb/XcodeGen)
(`brew install xcodegen`; the scripts run it for you, and the `.xcodeproj` is gitignored).

| target | what |
|---|---|
| `ViewSwitcher` (macOS 14+) | ViewSwitcher.app: the bundled server, the switcher in a window, a menu-bar item. `com.twowitstudios.viewswitcher.mac` |
| `ViewSwitcher iPad` (iPadOS 17+) | the switcher on the iPad over USB-C or the network. `com.twowitstudios.viewswitcher` |
| `Kit/` (Swift package `ViewSwitcherKit`) | shared by both: live state and menu text, navigation policy, server controller (macOS), shell bridge, update feed |

```sh
bun run mac:dev                  # Debug Mac app against the server in this checkout (attaches to `bun run dev` if it's up)
bun run mac:build                # build/ViewSwitcher.dmg + build/appcast/appcast.xml (signed, universal)
bun run mac:build --app          # just build/export/ViewSwitcher.app
bun run mac:e2e                  # drives that app on port 7435 (E2E_PORT), OBS offline, USB off, a temp library
bun run mac:release [--publish]  # + notarize and staple; --publish makes a DRAFT GitHub release
bun run ipad:deploy              # build, install and launch on the plugged-in iPad (replaces what's there)

cd apps/apple && xcodegen && xcodebuild -project ViewSwitcher.xcodeproj -scheme ViewSwitcher -destination platform=macOS test
cd apps/apple/Kit && swift test  # the same XCTest, without Xcode's project
bash apps/apple/scripts/ipad-shots.sh <dir>   # iPad screenshots in the simulator (scratch server on 7435)
```

## Mac app

- `Mac/main.swift`, `AppDelegate.swift`: lifecycle, the server (ViewSwitcherKit `connectOrStart`: attach to a
  ViewSwitcher server already on `PORT`, else start `Contents/Helpers/viewswitcher-server` and own it), the
  menu-bar item, the main menu and Sparkle. Quit stops only a server it started; a crash posts a
  notification and the menu offers Restart Server. The server exits by itself if the app dies
  (`VIEWSWITCHER_PARENT_PID`). Its output goes to `~/Library/Logs/ViewSwitcher/server.log`, restarted past 5 MB.
- `SwitcherWindow.swift`: the window and its WKWebView. Closing hides it. Navigation stays on the server,
  other http(s) links open in the browser, other schemes are refused; no camera or microphone; no
  downloads; window.open never opens a window. alert/confirm/prompt and file inputs are native.
- `E2E.swift`: the e2e script's handle on the app, active only with `VIEWSWITCHER_E2E_DIR`.

AppKit, not SwiftUI scenes: the window has to hide on close, its title bar holds the traffic lights in the
switcher's header row, and the menus are rebuilt from live state (and read back by the e2e).

### Edit → Undo / Redo (⌘Z)

WKWebView hands a typed ⌘Z to the page first, and the menu only gets it when the page didn't
`preventDefault`. So a typed ⌘Z reaches the scene editor exactly once, as in a browser. The menu then
runs the native text undo if focus is in a field, and nothing otherwise. Chosen from the menu with the
mouse, Undo hands the page a ⌘Z (or runs the native text undo in a field).

### Safe zones (MAC-13a)

The title bar is hidden (`fullSizeContentView`, transparent) and the traffic lights are moved into the
switcher's 64 px header row, 20 px in, centered on it, as Electron's `trafficLightPosition` does. The page
learns this from `<html data-shell="mac">` and `--shell-lights` / `--shell-header` / `--shell-drag`
(ViewSwitcherKit `ShellBridge`, read by `apps/web/src/styles.css`). The sidebar's brand row sits beside the
lights and the editor's top bar starts after them. WKWebView has no `-webkit-app-region`, so dragging
works like Tauri's: a mouse-down on a `[data-drag-region]` (the brand row, a 28 px band along the top, the
editor's top bar), but not on a control inside it, posts to the app, which runs `performDrag` with that
mouse-down. A double-click zooms, or does whatever System Settings says a title-bar double-click does.
In full screen the lights hide and every inset goes to 0 (`.shell-fullscreen`).

Why not a standard title bar: it adds a 28 px grey strip above an app that is graphite edge to edge, and
the lights wouldn't line up with anything. The editor would then lose 28 px of height for a title it
already shows.

## iPad app

`iPad/`: a web view from edge to edge with `ViewSwitcher-iPad/<version>` in its user agent. The bundled
connector (`iPad/Connector/index.html`, served at `viewswitcher://connector/`) finds the server (USB-C
first, through `UsbTunnel.swift`, unchanged from the Capacitor app, then a saved network address). The
main frame may show the connector, `127.0.0.1`, `*.ts.net` and `*.local`; other web pages open in Safari.
The screen stays awake while the app is in front, and the tunnel restarts when it comes back. The page
keeps clear of the safe area itself (`env(safe-area-inset-*)`). Every orientation is supported and full
screen isn't required, so Split View and Stage Manager work.

In the simulator the USB tunnel stays off: the simulator shares the Mac's ports, so its listener on
127.0.0.1:7420 would be the Mac's own port. A Debug build opens `VIEWSWITCHER_SERVER` directly instead
(`scripts/ipad-shots.sh` uses a scratch server on 7435).

## Signing: what each part is allowed

Signed with the Developer ID Application certificate for team M96WTV3CKX, with the hardened runtime and a
secure timestamp. `scripts/build.sh` checks all of it after the export.

| binary | entitlements | why |
|---|---|---|
| `ViewSwitcher.app` | none (`Mac/ViewSwitcher.entitlements` is empty) | WKWebView's JavaScript runs in WebKit's own Apple-signed processes, so the shell itself needs no JIT. |
| `Contents/Helpers/viewswitcher-server` | `com.apple.security.cs.allow-jit` (`Mac/Server.entitlements`) | JavaScriptCore's JIT. Without it the server still runs but JSC falls back to its interpreter: a CPU-bound loop took 12.2 s instead of 1.3 s on arm64 (measured 2026-11-24). |
| `Sparkle.framework` (Autoupdate, Updater.app, XPC services) | Sparkle's own | Signed by the Developer ID export. |

Not needed, so not granted: `allow-unsigned-executable-memory`, `disable-library-validation`,
`allow-dyld-environment-variables`, and no sandbox. The server reads the library folder the user picks,
spawns `open` and `git`, and talks to usbmuxd's socket for the iPad.

The sidecar is built with `bun build --compile` once for each architecture, merged with `lipo` into one
universal binary, and signed with its own entitlements **before** the app is built. The Xcode build phase
"Embed server payload" copies it into `Contents/Helpers`, and the app's signature then seals it as it is.
One universal binary (rather than one per architecture, picked at launch) keeps one path, one signature and
one Sparkle archive. The dmg is about 52 MB.

## Updates (Sparkle 2)

- Feed: `https://github.com/2witstudios/viewswitcher/releases/latest/download/appcast.xml` (`SUFeedURL`).
  Only a published release is "latest", so a draft reaches nobody.
- Key: EdDSA. The private key is in the login keychain of the release Mac, under the account
  `viewswitcher` (Sparkle's `generate_keys --account viewswitcher`). It is never in the repo. The public key
  is `SPARKLE_PUBLIC_KEY` in `project.yml` (`SUPublicEDKey`). To move releases to another Mac, export it
  with `generate_keys --account viewswitcher -x <file>`, import it there with `-f`, and delete the file.
- `scripts/build.sh` writes `build/appcast/appcast.xml` with `generate_appcast` for every dmg. The
  enclosure is `releases/download/v<version>/ViewSwitcher.dmg`. The key reaches it on stdin from a
  private temp file that's deleted at once.
- Sparkle compares `CFBundleVersion`, which follows `MARKETING_VERSION` in `project.yml`: bump it for each release.
- Checks run every 6 hours and from Check for Updates… (menu bar and app menu). They are off in Debug
  builds, with `VIEWSWITCHER_UPDATES=0`, and under the e2e.

## Releasing

1. Bump `MARKETING_VERSION` in `project.yml`.
2. `bun run mac:release --publish`. It signs, notarizes and staples the app and the dmg (keychain profile
   `viewswitcher-notary`, MAC-7a), writes the appcast, and uploads `ViewSwitcher.dmg` and `appcast.xml`
   to a draft release `v<version>`.
3. A person checks the draft and publishes it.
