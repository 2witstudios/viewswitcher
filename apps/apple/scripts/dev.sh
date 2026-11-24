#!/usr/bin/env bash
# bun run mac:dev: build the Mac app (Debug) and run it against the server in this checkout.
# It attaches to a server already answering on PORT (e.g. `bun run dev`), or starts
# `bun apps/server/src/index.ts` itself (and stops that one on Quit). Env passes through (PORT,
# VIEWSWITCHER_LIBRARY, OBS_URL…).
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(cd ../.. && pwd)"
[ -f "$REPO/apps/web/dist/index.html" ] || (cd "$REPO/apps/web" && bunx vite build)
xcodegen --quiet
xcodebuild -project ViewSwitcher.xcodeproj -scheme ViewSwitcher -configuration Debug -derivedDataPath build/dd -quiet build
VIEWSWITCHER_REPO="$REPO" exec build/dd/Build/Products/Debug/ViewSwitcher.app/Contents/MacOS/ViewSwitcher
