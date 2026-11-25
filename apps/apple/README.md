# apps/apple: ViewSwitcher for Mac, iPhone and iPad

One Xcode project, generated from `project.yml` with [XcodeGen](https://github.com/yonaskolb/XcodeGen)
(`brew install xcodegen`; the scripts run it for you, and the `.xcodeproj` is gitignored).

| target | what |
|---|---|
| `ViewSwitcher` (macOS 14+) | ViewSwitcher.app: the bundled server, the switcher in a window, a menu-bar item. `com.twowitstudios.viewswitcher.mac` |
| `ViewSwitcher iPad` (iOS and iPadOS 17+) | one universal app (PHONE-1): the switcher on the iPhone or iPad over USB-C or the network. `com.twowitstudios.viewswitcher` |
| `Kit/` (Swift package `ViewSwitcherKit`) | shared by both: live state and menu text, navigation policy, server controller (macOS), shell bridge, update feed |

```sh
bun run mac:dev                  # Debug Mac app against the server in this checkout (attaches to `bun run dev` if it's up)
bun run mac:build                # build/ViewSwitcher.dmg + build/appcast/appcast.xml (signed, universal)
bun run mac:build --app          # just build/export/ViewSwitcher.app
bun run mac:e2e                  # drives that app on port 7435 (E2E_PORT), OBS offline, USB off, a temp library
bun run mac:release [--publish]  # + notarize and staple; --publish makes a DRAFT GitHub release
bun run ipad:deploy              # build, install and launch on the plugged-in iPad, else iPhone (replaces what's there)
bun run ipad:release [--export]  # archive, export for App Store Connect, check, upload (--export: no upload)

cd apps/apple && xcodegen && xcodebuild -project ViewSwitcher.xcodeproj -scheme ViewSwitcher -destination platform=macOS test
cd apps/apple/Kit && swift test  # the same XCTest, without Xcode's project
bash apps/apple/scripts/ipad-shots.sh [dir]   # 13-inch iPad App Store screenshots: the app on a live show (fake OBS, scratch server on 7445), framed
IPHONE=1 bash apps/apple/scripts/ipad-shots.sh [dir]   # iPhone ones, 6.9-inch and 6.3-inch: the deck, upright, pairing (into iphone/, iphone-6.3/)
bun apps/apple/scripts/demo-assets.ts         # refresh the iPad demo's show from apps/site
bun apps/apple/AppStore/check.ts              # App Store listing lengths
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
- `RemotesWindow.swift`: Phones and Tablets (MAC-23 … MAC-26): the Wi-Fi setting (UserDefaults
  `wifiRemotes`, passed to the server as `VIEWSWITCHER_LAN`; the e2e keeps its own in memory), Bonjour
  while it's on, a one-time code with its QR code (ViewSwitcherKit `qrCode`, CoreImage), and the paired
  devices. It calls the server's `/api/remote…` with `Env.adminToken`, a secret made at each launch.
  Attached to a server it didn't start, pairing isn't available (that server has another secret).
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

## iPhone and iPad app

One app for both (PHONE-1): the target keeps its name and the `ViewSwitcher-iPad` user-agent token, which
the switcher reads as "the native app" on either. On a phone the switcher has its own layouts
(apps/web/src/styles.css): sideways, the deck (a short touch screen: the scenes four across under one
bar, the library behind the title, PHONE-12); upright, what's on air on top (PHONE-3). Switching only:
editing stays on the Mac and iPad.

Pairing happens in the app (PHONE-4, PHONE-5), since the system Camera would pair Safari instead:
`ConnectorBridge.swift` gives the bundled connector page, and only it, Scan (VisionKit reads the Mac's QR
code; ViewSwitcherKit `PairingLink` accepts only a pairing link on the local network) and Enter code
(Bonjour finds the Mac's `ViewSwitcher` `_http._tcp` service, then its pair page takes the code). The
QR code carries the Mac's LAN address, so private LAN addresses are allowed like `.local` names.

`iPad/`: a web view from edge to edge with `ViewSwitcher-iPad/<version>` in its user agent. The bundled
connector (`iPad/Connector/index.html`, served at `viewswitcher://connector/`) finds the server (USB-C
first, through `UsbTunnel.swift`, unchanged from the Capacitor app, then a saved network address). The
main frame may show the connector, `127.0.0.1`, `*.ts.net` and `*.local`; other web pages open in Safari.
The screen stays awake while the app is in front, and the tunnel restarts when it comes back. The page
keeps clear of the safe area itself (`env(safe-area-inset-*)`). Every orientation is supported and full
screen isn't required, so Split View and Stage Manager work.

In the simulator the USB tunnel stays off: the simulator shares the Mac's ports, so its listener on
127.0.0.1:7420 would be the Mac's own port. A Debug build opens `VIEWSWITCHER_SERVER` directly instead
(`scripts/ipad-shots.sh` uses a scratch server on 7445), `VIEWSWITCHER_PROBE` points the connector's
USB-C probe elsewhere, `VIEWSWITCHER_START=demo` opens the demo and `VIEWSWITCHER_RESET=1` starts as a
first launch. Tests and screenshots always set the probe, so they never reach the Mac's own switcher.

### Demo (MAC-18)

With no Mac, the app has a demo for App Review and new buyers: `iPad/Connector/demo/`, served at
`viewswitcher://connector/demo/`. It's static web content bundled in the app, like the connector (one
web view, one scheme handler, nothing to load), so it works offline. The show is the site's made-up
Saltwater Kitchen: its rendered views and Unsplash photos (apps/site/CREDITS.md), copied by
`scripts/demo-assets.ts`. Tap a view and the program cuts to it, the camera and guest glide into its
boxes and the red On air tally moves. A white bar says "Demo · Connect your Mac to go live".

- The connector opens the demo by itself until a Mac has answered once (`viewswitcher.connectedOnce`
  in the web view's storage); after that it offers "Try the demo" when no Mac answers.
- "Connect your Mac" goes back to the connector, which then stays until the next launch.
- The demo keeps probing like the connector (`Connector/probe.js`, shared) and opens the real switcher
  as soon as a Mac answers.
- `iPadUITests/DemoTests.swift` covers it (the Mac part runs from `scripts/ipad-shots.sh`).

### Screenshots (MAC-19)

`scripts/ipad-shots.sh` makes the App Store screenshots from the real app in the 13-inch iPad Pro
simulator, or with `IPHONE=1` the 6.9-inch iPhone 17 (or 16) Pro Max (PHONE-9: the deck, upright and pairing,
into `AppStore/screenshots/iphone/`, and again at 1206×2622 into `iphone-6.3/`). It starts a stand-in OBS (`scripts/fake-obs-server.ts`: an obs-websocket server around the
server tests' in-memory OBS, live) and a scratch switcher on 7445 with USB off, and seeds it through the
API (`scripts/shots-seed.ts`: Full Count and Grace Community, a project and a stream each, and the
site's photos in their camera boxes, in the scratch library only). Then
`iPadUITests/AppStoreScreenshots.swift` (`testShots`, `testPhoneShots`) taps through each screen in the app and waits while the script
captures it with `simctl io screenshot`, under a 9:41 status bar. `scripts/frame-shots.ts` puts each in a
realistic device on a portrait canvas, the whole device inside with a margin (a sideways iPhone capture
goes in an upright phone, turned to fill it): dark ground, the logo, a two-line Space Grotesk headline
and an Instrument Sans subtitle. The upload list is in
`AppStore/listing.md`.

### App Store (MAC-19, MAC-20)

`AppStore/listing.md` holds the listing in App Store Connect's order: name, subtitle, description,
keywords, promotional text, URLs, review notes, age rating, privacy label (no data collected) and
export compliance. The app ships with every iPad icon size from one 1024 px source, a launch screen
(`UILaunchScreen`), `PrivacyInfo.xcprivacy` (the Mac app has one too), `ITSAppUsesNonExemptEncryption`
NO, one usage string (Local Network: the network address), and all four orientations without
`UIRequiresFullScreen`. `scripts/ipad-check.sh` checks all of that on the exported .ipa, and
`ipad:release` runs it before any upload.

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

### Credentials (MAC-17)

One App Store Connect team API key notarizes the Mac app and uploads the iPad app. Set these in the
environment or in `apps/apple/.release.env` (gitignored; copy `.release.env.example`):

| variable | what | where |
|---|---|---|
| `ASC_KEY_ID` | the key's ID (10 characters, like `AB12CD34EF`) | App Store Connect → Users and Access → Integrations → App Store Connect API |
| `ASC_ISSUER_ID` | the issuer ID, a UUID | the same page, above the list of keys |
| `ASC_KEY_PATH` | the `.p8` file | default `~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8` |

The scripts pass only the path and IDs to Apple's tools; nothing prints the key, and it's never in the repo.
With a value missing, `mac:release` and `ipad:release` stop before building and name it.

### Mac (free, GitHub Releases)

1. Bump `MARKETING_VERSION` in `project.yml`.
2. `bun run mac:release --publish`. It signs, notarizes and staples the app and the dmg, writes the
   appcast, and uploads `ViewSwitcher.dmg` and `appcast.xml` to a draft release `v<version>`. It
   notarizes with the keychain profile `viewswitcher-notary` when it exists (MAC-7a), else with the API key.
3. A person checks the draft and publishes it.

### iPad ($9.99, App Store)

1. `bun run ipad:release`. It archives the Release build with the build number set to the UTC time
   (`YYYYMMDDHHMM`, or `BUILD_NUMBER`), exports it for App Store Connect, runs `scripts/ipad-check.sh`,
   and uploads it with the API key. `--export` stops before the upload (build/ipad/export/ViewSwitcher.ipa)
   and signs with the Xcode account when the API key isn't complete.
2. In App Store Connect: pick the build, fill the version from `AppStore/listing.md`, add the screenshots
   from `scripts/ipad-shots.sh`, and submit for review.
