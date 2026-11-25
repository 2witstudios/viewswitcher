#!/usr/bin/env bash
# The iPad App Store screenshots (MAC-19): the real iPad app in the 13-inch iPad Pro simulator, on a
# real-looking show with OBS connected and live, captured with `simctl io screenshot` under a clean
# status bar at the 13-inch App Store size (2752×2064 landscape, 2064×2752 portrait).
#
#   1. a fake OBS (scripts/fake-obs-server.ts, streaming) on FAKE_OBS_PORT (4466)
#   2. a scratch switcher on SHOTS_PORT (7445): USB off, a scratch library, that OBS
#   3. seeds it (scripts/shots-seed.ts): Full Count and Grace Community, a project and a stream each
#   4. boots the simulator, overrides its status bar (9:41, full battery, Wi-Fi), and runs
#      AppStoreScreenshots, which builds and installs the app, taps through each screen and waits
#      while this script captures it
#   5. frames each one (scripts/frame-shots.ts): an iPad frame and a caption on white
#
# Out (gitignored), in upload order:
#   raw/1-stream-landscape.png … raw/5-demo-landscape.png   the captures
#   1-stream-landscape.png … 5-demo-landscape.png           the App Store versions, framed
# Then DemoTests runs against the same server, so "a Mac answering leaves the demo" is checked too, and
# split/ipad-split-*.png show the switcher at Split View widths (MAC-13a; a simulation, see SwitcherViewController).
# Never the Mac's 7420 (the simulator shares the Mac's ports), never ~/ViewSwitcher Library, never a device.
#   bash apps/apple/scripts/ipad-shots.sh [out-dir] [simulator-udid]     (out-dir: apps/apple/AppStore/screenshots)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$(mkdir -p "${1:-AppStore/screenshots}" && cd "${1:-AppStore/screenshots}" && pwd)"
RAW="$OUT/raw"
SIM="${2:-}"
[ -n "$SIM" ] || SIM=$(xcrun simctl list devices available | awk -F '[()]' '/iPad Pro 13/ { print $2; exit }')
[ -n "$SIM" ] || { echo "No 13-inch iPad Pro simulator: create one in Xcode → Devices and Simulators." >&2; exit 1; }
xcrun simctl list devices available | grep -q "$SIM" || { echo "$SIM isn't a simulator." >&2; exit 1; }
PORT="${SHOTS_PORT:-7445}"
OBS_PORT="${FAKE_OBS_PORT:-4466}"
[ "$PORT" != 7420 ] || { echo "Never 7420: that's the live switcher." >&2; exit 1; }
[ "$OBS_PORT" != 4455 ] || { echo "Never 4455: that's OBS's own port." >&2; exit 1; }
for p in "$PORT" "$OBS_PORT"; do
  ! lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null || { echo "Something already listens on $p: stop it, or set SHOTS_PORT / FAKE_OBS_PORT." >&2; exit 1; }
done

TMP="$(mktemp -d)"
LIB="$TMP/library"
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; xcrun simctl status_bar "$SIM" clear 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

FAKE_OBS_STREAMING=1 bun scripts/fake-obs-server.ts "$OBS_PORT" >"$TMP/obs.log" 2>&1 &
PIDS+=($!)
[ -f ../web/dist/index.html ] || (cd ../web && bunx vite build >/dev/null)
mkdir -p "$LIB"
PORT=$PORT OBS_URL="ws://127.0.0.1:$OBS_PORT" OBS_PASSWORD= OBS_DEVICES=Camera,Guest,Screen,iPad VIEWSWITCHER_USB=0 \
  VIEWSWITCHER_LIBRARY="$LIB" bun ../server/src/index.ts >"$TMP/server.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 75); do curl -sf "http://127.0.0.1:$PORT/api/state" | grep -q '"connected":true' && break; sleep 0.2; done
curl -sf "http://127.0.0.1:$PORT/api/state" | grep -q '"connected":true' || { cat "$TMP/obs.log" "$TMP/server.log" >&2; echo "The scratch server didn't start on $PORT with OBS connected (bun install?)." >&2; exit 1; }
eval "$(VIEWSWITCHER_LIBRARY="$LIB" bun scripts/shots-seed.ts "http://127.0.0.1:$PORT")"

xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl bootstatus "$SIM" >/dev/null
xcrun simctl status_bar "$SIM" override --time 9:41 --batteryState charged --batteryLevel 100 \
  --wifiMode active --wifiBars 3 --dataNetwork wifi --cellularMode notSupported
xcodegen --quiet
rm -rf "$RAW" && mkdir -p "$RAW"
test_env() {
  env TEST_RUNNER_VIEWSWITCHER_SERVER="http://127.0.0.1:$PORT" TEST_RUNNER_VIEWSWITCHER_MAC="http://127.0.0.1:$PORT" \
    TEST_RUNNER_VIEWSWITCHER_SHOTS="$RAW" TEST_RUNNER_VIEWSWITCHER_FULLCOUNT="$FULLCOUNT" TEST_RUNNER_VIEWSWITCHER_GRACE="$GRACE" "$@"
}
test_env xcodebuild -project ViewSwitcher.xcodeproj -scheme "ViewSwitcher iPad" -derivedDataPath build/dd -destination "id=$SIM" \
  -only-testing:"ViewSwitcher iPad UITests/AppStoreScreenshots" -quiet test >"$TMP/test.log" 2>&1 &
TEST=$!
PIDS+=($TEST)
# The test writes raw/.shot-<name> (holding the orientation) when a screen is ready; capture it, then
# delete the marker so the test goes on. simctl's capture is the portrait framebuffer, so a landscape
# screen (landscapeLeft: the top of the screen on the left) is turned upright.
while kill -0 "$TEST" 2>/dev/null; do
  for marker in "$RAW"/.shot-*; do
    [ -f "$marker" ] || continue
    name="${marker##*/.shot-}"
    xcrun simctl io "$SIM" screenshot --type=png "$RAW/$name.png" >/dev/null 2>&1
    [ "$(cat "$marker")" != landscape ] || sips -r 270 "$RAW/$name.png" >/dev/null
    rm -f "$marker"
    echo "captured raw/$name.png"
  done
  sleep 0.2
done
wait "$TEST" || { tail -40 "$TMP/test.log" >&2; echo "AppStoreScreenshots failed." >&2; exit 1; }

bun scripts/frame-shots.ts "$OUT"
uitest() { # uitest <test> [web width]
  test_env ${2:+TEST_RUNNER_VIEWSWITCHER_WEB_WIDTH=$2} TEST_RUNNER_VIEWSWITCHER_SHOTS="$OUT/split" TEST_RUNNER_VIEWSWITCHER_SHOTS_PREFIX="ipad-split-${3:-}" \
    xcodebuild -project ViewSwitcher.xcodeproj -scheme "ViewSwitcher iPad" -derivedDataPath build/dd -destination "id=$SIM" \
    -only-testing:"ViewSwitcher iPad UITests/$1" -quiet test
}
uitest DemoTests
# Split View widths on the 13-inch iPad Pro (MAC-13a), not for the store: half (678 pt in landscape) and a third (444 pt).
mkdir -p "$OUT/split"
uitest SafeAreaScreenshots/testOrientations 678 half
uitest SafeAreaScreenshots/testOrientations 444 third
for f in "$RAW"/*.png "$OUT"/*.png "$OUT"/split/*.png; do
  printf '%s %s\n' "$(sips -g pixelWidth -g pixelHeight "$f" | awk '/pixel/ { printf "%s ", $2 }')" "${f#"$OUT"/}"
done
