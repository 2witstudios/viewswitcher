# Signing: what each part of ViewSwitcher.app is allowed

Everything is signed with the Developer ID Application certificate for team M96WTV3CKX, with the
hardened runtime on and a secure timestamp. Each binary gets only the entitlements it was shown to
need (measured on this Mac, 2026-11-24):

| plist | signs | entitlements | why |
|---|---|---|---|
| `entitlements.mac.plist` | the app (Electron main) | `com.apple.security.cs.allow-jit` | V8 compiles JavaScript to machine code (MAP_JIT); without it the hardened runtime kills the process. |
| `entitlements.mac.inherit.plist` | the Electron Helper apps (renderer, GPU, plugin) | `com.apple.security.cs.allow-jit` | Same: the renderer's V8 runs the switcher page. |
| `entitlements.server.plist` | `Contents/Resources/viewswitcher-server` (the Bun server, `bun build --compile`) | `com.apple.security.cs.allow-jit` | JavaScriptCore's JIT. Without it the server still runs but JSC falls back to its interpreter: a CPU-bound loop took 12.2 s instead of 1.3 s on arm64 (4.3 s vs 1.5 s for x64 under Rosetta). |

Not needed, so not granted: `allow-unsigned-executable-memory`, `disable-library-validation` (the
server loads no native addons; Electron loads only its own signed frameworks),
`allow-dyld-environment-variables`, and no sandbox (the server reads the library folder the user
picks, spawns `open` and `git`, and talks to usbmuxd's socket for the iPad).

The sidecar is signed by `scripts/build.sh` before packaging (electron-builder would give it the
helpers' plist) and `mac.signIgnore` keeps electron-builder from re-signing it. The universal build
merges the arm64 and x64 sidecars with `lipo`, which keeps each slice's signature.
