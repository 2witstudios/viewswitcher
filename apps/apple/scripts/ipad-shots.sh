#!/usr/bin/env bash
# MAC-13a: screenshots of ViewSwitcher iPad in the simulator, landscape and portrait, full screen and
# at Split View widths (the web view laid out narrower: a simulation, see SwitcherViewController), against a
# scratch server on 7435 (never the Mac's 7420: the simulator shares the Mac's ports).
#   bash apps/apple/scripts/ipad-shots.sh <out-dir> [simulator-udid]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$(mkdir -p "$1" && cd "$1" && pwd)"
SIM="${2:-}"
[ -n "$SIM" ] || SIM=$(xcrun simctl list devices available | awk -F '[()]' '/iPad Pro 13/ { print $2; exit }')
PORT=7435
if ! curl -sf "http://127.0.0.1:$PORT/api/state" >/dev/null; then
  LIB="$(mktemp -d)"
  PORT=$PORT OBS_URL=ws://127.0.0.1:1 VIEWSWITCHER_USB=0 VIEWSWITCHER_LIBRARY="$LIB" bun ../server/src/index.ts >/dev/null 2>&1 &
  SERVER=$!
  trap 'kill $SERVER; rm -rf "$LIB"' EXIT
  for _ in $(seq 50); do curl -sf "http://127.0.0.1:$PORT/api/state" >/dev/null && break; sleep 0.2; done
fi
xcodegen --quiet
run() {
  env TEST_RUNNER_VIEWSWITCHER_SERVER="http://127.0.0.1:$PORT" TEST_RUNNER_VIEWSWITCHER_SHOTS="$OUT" TEST_RUNNER_VIEWSWITCHER_SHOTS_PREFIX="$1" ${2:+TEST_RUNNER_VIEWSWITCHER_WEB_WIDTH=$2} \
    xcodebuild -project ViewSwitcher.xcodeproj -scheme "ViewSwitcher iPad" -derivedDataPath build/dd -destination "id=$SIM" -quiet test
}
run ipad
# Split View widths on the 13-inch iPad Pro: half (678 pt in landscape) and a third (444 pt).
run ipad-split-half 678
run ipad-split-third 444
ls -l "$OUT"/ipad*.png
