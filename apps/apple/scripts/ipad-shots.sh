#!/usr/bin/env bash
# The App Store screenshots: the real app in the 13-inch iPad Pro simulator (or, with
# IPHONE=1, the 6.9-inch iPhone 17 or 16 Pro Max), on a real-looking show with OBS connected and live,
# captured with `simctl io screenshot` under a clean status bar at the App Store sizes (iPad 2752×2064 /
# 2064×2752, iPhone 17 Pro Max 2868×1320 / 1320×2868).
#
#   1. a fake OBS (scripts/fake-obs-server.ts, streaming) on FAKE_OBS_PORT (4466)
#   2. a scratch switcher on SHOTS_PORT (7445): USB off, a scratch library, that OBS
#   3. seeds it (scripts/shots-seed.ts): Full Count and Grace Community, a project and a stream each,
#      photos in their camera boxes
#   4. boots the simulator, overrides its status bar (9:41, full battery, Wi-Fi), and runs
#      AppStoreScreenshots (testShots, or testPhoneShots), which builds and installs the app, taps through
#      each screen and waits while this script captures it
#   5. frames each one (scripts/frame-shots.ts): the device on a portrait canvas under a headline; the
#      iPhone set twice, 1320×2868 (6.9-inch) and 1206×2622 (6.3-inch) in <out-dir>-6.3/
#
# Out (gitignored), in upload order (the names and captions are in frame-shots.ts and listing.md):
#   raw/<n>-<screen>.png        the captures
#   <n>-<screen>.png            the App Store versions, framed
# Then DemoTests runs against the same server, so "a Mac answering leaves the demo" is checked too, and on
# the iPad split/ipad-split-*.png show the switcher at Split View widths (a simulation, see SwitcherViewController).
# Never the Mac's 7420 (the simulator shares the Mac's ports), never ~/ViewSwitcher Library, never a device.
#   bash apps/apple/scripts/ipad-shots.sh [out-dir] [simulator-udid]     (out-dir: apps/apple/AppStore/screenshots)
#   IPHONE=1 bash apps/apple/scripts/ipad-shots.sh [out-dir] [udid]       (out-dir: apps/apple/AppStore/screenshots/iphone)
set -euo pipefail
cd "$(dirname "$0")/.."
IPHONE="${IPHONE:-}"
DEFAULT_OUT="AppStore/screenshots${IPHONE:+/iphone}"
OUT="$(mkdir -p "${1:-$DEFAULT_OUT}" && cd "${1:-$DEFAULT_OUT}" && pwd)"
RAW="$OUT/raw"
SIM="${2:-}"
if [ -n "$IPHONE" ]; then
  [ -n "$SIM" ] || SIM=$(xcrun simctl list devices available | awk -F '[()]' '/iPhone 17 Pro Max/ { print $2; exit }')
  [ -n "$SIM" ] || SIM=$(xcrun simctl list devices available | awk -F '[()]' '/iPhone 16 Pro Max/ { print $2; exit }')
  [ -n "$SIM" ] || { echo "No 6.9-inch iPhone simulator (iPhone 17 or 16 Pro Max): create one in Xcode → Devices and Simulators." >&2; exit 1; }
  SHOTS_TEST=testPhoneShots
else
  [ -n "$SIM" ] || SIM=$(xcrun simctl list devices available | awk -F '[()]' '/iPad Pro 13/ { print $2; exit }')
  [ -n "$SIM" ] || { echo "No 13-inch iPad Pro simulator: create one in Xcode → Devices and Simulators." >&2; exit 1; }
  SHOTS_TEST=testShots
fi
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
# A background job's pid is its subshell's, so its children (xcodebuild, bun) are stopped by name of parent too.
cleanup() { for p in "${PIDS[@]}"; do pkill -TERM -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done; xcrun simctl status_bar "$SIM" clear 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

# The fake OBS and the switcher get the same scene and devices, whatever the shell exports.
export OBS_SCENE=ViewSwitcher OBS_SOURCES=Camera,Guest,Screen,iPad
FAKE_OBS_STREAMING=1 bun scripts/fake-obs-server.ts "$OBS_PORT" >"$TMP/obs.log" 2>&1 &
PIDS+=($!)
(cd ../web && bunx vite build >/dev/null) # every run: a stale build would show an old layout
mkdir -p "$LIB"
PORT=$PORT OBS_URL="ws://127.0.0.1:$OBS_PORT" OBS_PASSWORD= VIEWSWITCHER_USB=0 \
  VIEWSWITCHER_STATE="$TMP/state" VIEWSWITCHER_LIBRARY="$LIB" bun ../server/src/index.ts >"$TMP/server.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 75); do curl -sf "http://127.0.0.1:$PORT/api/state" | grep -q '"connected":true' && break; sleep 0.2; done
curl -sf "http://127.0.0.1:$PORT/api/state" | grep -q '"connected":true' || { cat "$TMP/obs.log" "$TMP/server.log" >&2; echo "The scratch server didn't start on $PORT with OBS connected (bun install?)." >&2; exit 1; }
seed="$(VIEWSWITCHER_STATE="$TMP/state" VIEWSWITCHER_LIBRARY="$LIB" bun scripts/shots-seed.ts "http://127.0.0.1:$PORT")" # stops here if seeding fails
eval "$seed"
[ -n "${FULLCOUNT:-}" ] && [ -n "${GRACE:-}" ] || { echo "Seeding printed no stream pages." >&2; exit 1; }

xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl bootstatus "$SIM" >/dev/null
xcrun simctl status_bar "$SIM" override --time 9:41 --batteryState charged --batteryLevel 100 \
  --wifiMode active --wifiBars 3 --dataNetwork wifi --cellularMode notSupported
xcodegen --quiet
# This run's shots only: no raw or framed ones left from an earlier run (or from the old script's names).
rm -rf "$RAW" "$OUT/split" ${IPHONE:+"$OUT-6.3"} && rm -f "$OUT"/*.png && mkdir -p "$RAW"
test_env() {
  env TEST_RUNNER_VIEWSWITCHER_SERVER="http://127.0.0.1:$PORT" TEST_RUNNER_VIEWSWITCHER_MAC="http://127.0.0.1:$PORT" \
    TEST_RUNNER_VIEWSWITCHER_SHOTS="$RAW" TEST_RUNNER_VIEWSWITCHER_FULLCOUNT="$FULLCOUNT" TEST_RUNNER_VIEWSWITCHER_GRACE="$GRACE" "$@"
}
test_env xcodebuild -project ViewSwitcher.xcodeproj -scheme "ViewSwitcher iPad" -derivedDataPath build/dd -destination "id=$SIM" \
  -only-testing:"ViewSwitcher iPad UITests/AppStoreScreenshots/$SHOTS_TEST" -quiet test >"$TMP/test.log" 2>&1 &
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

bun scripts/frame-shots.ts "$OUT" ${IPHONE:+--phone}
uitest() { # uitest <test> [web width]
  test_env ${2:+TEST_RUNNER_VIEWSWITCHER_WEB_WIDTH=$2} TEST_RUNNER_VIEWSWITCHER_SHOTS="$OUT/split" TEST_RUNNER_VIEWSWITCHER_SHOTS_PREFIX="ipad-split-${3:-}" \
    xcodebuild -project ViewSwitcher.xcodeproj -scheme "ViewSwitcher iPad" -derivedDataPath build/dd -destination "id=$SIM" \
    -only-testing:"ViewSwitcher iPad UITests/$1" -quiet test
}
uitest DemoTests
if [ -z "$IPHONE" ]; then
# Split View widths on the 13-inch iPad Pro, not for the store: half (678 pt in landscape) and a third (444 pt).
mkdir -p "$OUT/split"
uitest SafeAreaScreenshots/testOrientations 678 half
uitest SafeAreaScreenshots/testOrientations 444 third
fi
for f in "$RAW"/*.png "$OUT"/*.png "$OUT"/split/*.png "$OUT"-6.3/*.png; do
  [ -f "$f" ] || continue
  printf '%s %s\n' "$(sips -g pixelWidth -g pixelHeight "$f" | awk '/pixel/ { printf "%s ", $2 }')" "${f#"$(dirname "$OUT")"/}"
done
