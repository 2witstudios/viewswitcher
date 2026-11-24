#!/usr/bin/env bash
# Build ViewSwitcher, sign it with your team, install it on the USB-connected iPad, and launch it.
#   bun run ipad:deploy            (first connected iPad)
#   DEVICE=<id> bun run ipad:deploy
set -euo pipefail
cd "$(dirname "$0")/.."

TEAM="${TEAM:-M96WTV3CKX}"
BUNDLE_ID="com.twowitstudios.viewswitcher"
BUILD="ios/App/build"

if [ -z "${DEVICE:-}" ]; then
  DEVICE=$(xcrun devicectl list devices 2>/dev/null | awk '/iPad/ && /available/ { for (i = 1; i <= NF; i++) if ($i ~ /^[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}$/) { print $i; exit } }')
fi
[ -n "$DEVICE" ] || { echo "No paired iPad found. Plug it in, unlock it, and trust this Mac."; exit 1; }
echo "→ iPad $DEVICE"

bunx cap sync ios

xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination "generic/platform=iOS" -derivedDataPath "$BUILD" \
  -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM" \
  -quiet build

APP="$BUILD/Build/Products/Debug-iphoneos/App.app"
xcrun devicectl device install app --device "$DEVICE" "$APP"
xcrun devicectl device process launch --terminate-existing --device "$DEVICE" "$BUNDLE_ID"
echo "✓ ViewSwitcher is running on the iPad."
