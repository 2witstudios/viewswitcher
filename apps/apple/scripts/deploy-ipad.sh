#!/usr/bin/env bash
# bun run ipad:deploy: build ViewSwitcher iPad, sign it with your team, install it on the
# USB-connected iPad, and launch it (MAC-14). Replaces the app that's on the iPad.
#   bun run ipad:deploy            (first connected iPad)
#   DEVICE=<id> bun run ipad:deploy
set -euo pipefail
cd "$(dirname "$0")/.."

TEAM="${TEAM:-M96WTV3CKX}"
BUNDLE_ID="com.twowitstudios.viewswitcher"

if [ -z "${DEVICE:-}" ]; then
  DEVICE=$(xcrun devicectl list devices 2>/dev/null | awk '/iPad/ && /available/ { for (i = 1; i <= NF; i++) if ($i ~ /^[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}$/) { print $i; exit } }')
fi
[ -n "$DEVICE" ] || { echo "No paired iPad found. Plug it in, unlock it, and trust this Mac."; exit 1; }
echo "→ iPad $DEVICE"

xcodegen --quiet
xcodebuild -project ViewSwitcher.xcodeproj -scheme "ViewSwitcher iPad" -configuration Debug \
  -destination "generic/platform=iOS" -derivedDataPath build/dd \
  -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM" \
  -quiet build

APP="build/dd/Build/Products/Debug-iphoneos/ViewSwitcher.app"
xcrun devicectl device install app --device "$DEVICE" "$APP"
xcrun devicectl device process launch --terminate-existing --device "$DEVICE" "$BUNDLE_ID"
echo "✓ ViewSwitcher is running on the iPad."
