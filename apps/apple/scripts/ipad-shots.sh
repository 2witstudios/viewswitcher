#!/usr/bin/env bash
# iPad screenshots in the 13-inch iPad Pro simulator (2064×2752 portrait, 2752×2064 landscape: the App
# Store's 13-inch size, MAC-19), landscape and portrait:
#   demo-*.png              the offline demo (MAC-18), a view taken
#   ipad-*.png              the real switcher, against a scratch server on 7437 with the site's made-up
#                           shows as its library (apps/site/scripts/library.ts), OBS offline
#   ipad-split-*.png        the switcher at Split View widths (MAC-13a; a simulation, see SwitcherViewController)
# It also runs DemoTests against that server, so "a Mac answering leaves the demo" is checked too.
# Never the Mac's 7420 (the simulator shares the Mac's ports) and never ~/ViewSwitcher Library.
#   bash apps/apple/scripts/ipad-shots.sh [out-dir] [simulator-udid]     (out-dir: apps/apple/AppStore/screenshots)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$(mkdir -p "${1:-AppStore/screenshots}" && cd "${1:-AppStore/screenshots}" && pwd)"
SIM="${2:-}"
[ -n "$SIM" ] || SIM=$(xcrun simctl list devices available | awk -F '[()]' '/iPad Pro 13/ { print $2; exit }')
[ -n "$SIM" ] || { echo "No 13-inch iPad Pro simulator: create one in Xcode → Devices and Simulators." >&2; exit 1; }
PORT="${SHOTS_PORT:-7437}"
[ "$PORT" != 7420 ] || { echo "Never 7420: that's the live switcher." >&2; exit 1; }
if curl -sf "http://127.0.0.1:$PORT/api/state" >/dev/null; then
  echo "Using the server already on $PORT."
else
  [ -f ../web/dist/index.html ] || (cd ../web && bunx vite build >/dev/null)
  LIB="$(mktemp -d)/library"
  SHOTS_LIBRARY="$LIB" bun ../site/scripts/library.ts >/dev/null
  PORT=$PORT OBS_URL=ws://127.0.0.1:1 VIEWSWITCHER_USB=0 VIEWSWITCHER_LIBRARY="$LIB" bun ../server/src/index.ts >/dev/null 2>&1 &
  SERVER=$!
  trap 'kill $SERVER 2>/dev/null; rm -rf "$(dirname "$LIB")"' EXIT
  for _ in $(seq 50); do curl -sf "http://127.0.0.1:$PORT/api/state" >/dev/null && break; sleep 0.2; done
  curl -sf "http://127.0.0.1:$PORT/api/state" >/dev/null || { echo "The scratch server didn't start on $PORT (bun install?)." >&2; exit 1; }
fi
xcodegen --quiet
run() { # run <prefix> <web width or ""> <test>
  env TEST_RUNNER_VIEWSWITCHER_SERVER="http://127.0.0.1:$PORT" TEST_RUNNER_VIEWSWITCHER_MAC="http://127.0.0.1:$PORT" \
    TEST_RUNNER_VIEWSWITCHER_SHOTS="$OUT" TEST_RUNNER_VIEWSWITCHER_SHOTS_PREFIX="$1" ${2:+TEST_RUNNER_VIEWSWITCHER_WEB_WIDTH=$2} \
    xcodebuild -project ViewSwitcher.xcodeproj -scheme "ViewSwitcher iPad" -derivedDataPath build/dd -destination "id=$SIM" \
    -only-testing:"ViewSwitcher iPad UITests/$3" -quiet test
}
run ipad "" SafeAreaScreenshots
run ipad "" DemoTests
# Split View widths on the 13-inch iPad Pro: half (678 pt in landscape) and a third (444 pt).
run ipad-split-half 678 SafeAreaScreenshots/testOrientations
run ipad-split-third 444 SafeAreaScreenshots/testOrientations
for f in "$OUT"/demo-*.png "$OUT"/ipad-landscape.png "$OUT"/ipad-portrait.png; do
  printf '%s %s\n' "$(sips -g pixelWidth -g pixelHeight "$f" | awk '/pixel/ { printf "%s ", $2 }')" "$(basename "$f")"
done
