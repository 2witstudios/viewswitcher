# apps/windows: ViewSwitcher for Windows

The Windows app: a native WinUI 3 shell (Windows App SDK, unpackaged and self-contained, .NET 10) around
the same server the Mac app bundles, compiled with `bun build --compile --target=bun-windows-x64`, and
the switcher in WebView2. It mirrors `apps/apple`'s Mac app; Kit's logic is ported one for one into
`ViewSwitcher.Core`.

| project | what |
|---|---|
| `ViewSwitcher.Core` | The Kit port, no UI: live state, the tray's text and menu, server states and restart policy, the supervisor and controller, the typed API, the navigation policy, pairing text, the page's shell script. |
| `ViewSwitcher.Core.Tests` | Kit's tests, ported to xUnit. The controller and supervisor tests start Bun stub servers for real (skipped without bun). |
| `ViewSwitcher.Windows` | The app: `ViewSwitcher.exe` (code-only WinUI: no XAML pages). |
| `scripts/` | `payload.ts` (the server and its resources), `build.ts` (the app and its Velopack release), `dev.ts`, `e2e.ts`, `icons.ts`. |

## Prerequisites

- Windows 10 (1809) or 11 with the WebView2 Runtime (built into Windows 11).
- The .NET 10 SDK (`winget install Microsoft.DotNet.SDK.10`), and the pinned Bun (`.bun-version`).
- For a release: `dotnet tool install -g vpk` (Velopack).

## Commands (from the repo root)

```sh
bun run win:dev                  # Debug app against the server in this checkout (attaches to whatever answers on PORT, e.g. `bun run dev`)
bun run win:test                 # ViewSwitcher.Core.Tests
bun run win:build --app          # apps/windows/build/app: ViewSwitcher.exe with Helpers\ and Resources\
bun run win:build                # + the Velopack release in apps/windows/build/release (ViewSwitcher-win-Setup.exe, the package, releases.win.json)
bun run win:build --arch arm64   # for ARM PCs
bun run win:e2e                  # drives build/app on port 7435 (E2E_PORT), OBS offline, a temp library; E2E_LAN=1 adds the Wi-Fi checks
bun run win:release [--publish]  # from a clean origin/main with the pinned Bun; --publish uploads to the version's DRAFT GitHub release
bun run win:icons                # Assets/*.ico from the brand mark
```

Never run the e2e on port 7420 (it refuses): that's the person's own ViewSwitcher.

## The app

- **Server** (`ServerSupervisor`, `ServerController`): as on the Mac. It attaches to a ViewSwitcher
  server already on `PORT`, else starts `Helpers\viewswitcher-server.exe` and owns it, restarts it at
  0, 2 and 10 s, and gives up after a fourth crash within a minute (Restart Server in the tray). Windows
  has no SIGTERM, so:
  - the app holds a pipe on the server's stdin and closes it to stop it (`VIEWSWITCHER_STOP_ON_STDIN=1`,
    `apps/server/src/main.ts`), ending it after 3 s if it hasn't gone;
  - the server runs in a kill-on-close Job Object, so it never outlives the app, even one ended from
    Task Manager. `VIEWSWITCHER_PARENT_PID` still makes it watch the app as well.
  - Refused connections to 127.0.0.1 fail at once (`Loopback.cs`: no SYN retries), since Windows
    otherwise takes 2 s to say nothing is listening.
- **Log**: `%LOCALAPPDATA%\ViewSwitcher\Logs\server.log` (a development build's `server-dev.log`),
  restarted past 5 MB. Settings: `%APPDATA%\ViewSwitcher\App\settings.json`, beside the server's
  state for this PC (`%APPDATA%\ViewSwitcher\libraries\…`). The web view's data:
  `%LOCALAPPDATA%\ViewSwitcher\WebView2`.
- **Window** (`SwitcherWindow.cs`): WebView2 on `http://127.0.0.1:7420/`, user agent
  `ViewSwitcher-Windows/<version>` (the switcher reads it as the desktop app,
  `apps/web/src/lib/client-kind.ts`).
  - The main frame stays on the server. Other web pages open in the browser, Cursor's MCP install link
    only from the switcher's own page, other schemes are refused, and nothing opens a second window.
  - No permissions (camera, microphone, …) and no downloads, except Edit with AI's Claude Desktop
    extension, which is saved to Downloads and opened.
  - No host objects and no web messages: the page has no way to call into the app (scenes are untrusted).
  - A failed load is tried again on the same page. Closing the window hides it; the server keeps serving.
  - The system title bar, in the switcher's graphite (`data-shell="windows"`, no insets).
- **Tray** (`Tray.cs`): the brand mark, red while something is on air, the on-air line as its tooltip,
  and the status menu (`StatusMenu.Items`). A left click opens the window.
- **Phones and Tablets** (`RemotesWindow.cs`):
  - The Wi-Fi setting, a one-time code with its QR code, the addresses, and the paired devices.
  - mDNS (`DnsServiceRegister`) announces "ViewSwitcher" `_http._tcp` while Wi-Fi is on.
  - Windows lets phones in only through the firewall and only on a private network. The window checks
    both (`netsh`, `Get-NetConnectionProfile`). **Set Up Windows for Phones…** asks once through
    Windows' admin prompt to add the rule ("ViewSwitcher (phones and tablets)": the server, private
    networks, the port) and to make the Wi-Fi private.
- **Toasts, one instance, Open at Login**: Windows App SDK notifications (tag `server`, so a new one
  replaces the last); `AppInstance` redirects a second launch to the first; the per-user `Run` key
  (`--login` starts in the tray).
- **Updates** (`Updates.cs`): Velopack from GitHub Releases (`releases.win.json`). Checked at launch
  and every 6 hours, applied when the person says so. Not in a development build, the e2e, or with
  `VIEWSWITCHER_UPDATES=0`.
- **E2E** (`E2E.cs`): with `VIEWSWITCHER_E2E_DIR`, the app writes `app.json` (state, server pid, the
  tray's menu, what it opened or notified) and runs `cmd-N.json` commands. Its windows never take the
  foreground.

USB-C to an iPhone or iPad isn't on Windows yet (ISSUE-39: Apple's usbmuxd is Apple Mobile Device
Service on TCP 27015 there). Phones and tablets connect over the Wi-Fi.

## Release

`bun run win:release --publish` builds from `origin/main` with the pinned Bun, then uploads
`ViewSwitcher-win-Setup.exe`, the full package and the update feed to the draft release `v<version>`
(the version is the Mac app's, `apps/apple/project.yml`, so both platforms ship together).

With `WINDOWS_SIGN_PARAMS` set (signtool's arguments for the code-signing certificate, WIN-21), vpk
signs every executable and the installer. Without it the build is unsigned, and Windows SmartScreen
warns on first run ("More info → Run anyway").
