#!/usr/bin/env bash
# bun run ipad:deploy: build ViewSwitcher iPad, sign it with your team, install it on the
# USB-connected iPad or iPhone, and launch it (MAC-14, PHONE-1). Replaces the app that's on it.
#   bun run ipad:deploy            (first connected iPad, else iPhone)
#   DEVICE=<id> bun run ipad:deploy
set -euo pipefail
cd "$(dirname "$0")/.."

TEAM="${TEAM:-M96WTV3CKX}"
BUNDLE_ID="com.twowitstudios.viewswitcher"

if [ -z "${DEVICE:-}" ]; then
  # Usable states: "available (paired)", or "connected" while a tunnel is open; never "unavailable".
  # The id: a CoreDevice UUID, or a UDID (00008110-001A2B3C4D5E801E, or 40 hex on older devices) as newer Xcodes print.
  first() { xcrun devicectl list devices 2>/dev/null | awk -v kind="$1" '$0 ~ kind && ($0 ~ /(^|[[:space:]])available/ || $0 ~ /(^|[[:space:]])connected/) && $0 !~ /unavailable/ { for (i = 1; i <= NF; i++) if ($i ~ /^[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}$/ || $i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/ || $i ~ /^[0-9a-f]{40}$/) { print $i; exit } }'; }
  DEVICE=$(first iPad)
  [ -n "$DEVICE" ] || DEVICE=$(first iPhone)
fi
[ -n "$DEVICE" ] || { echo "No paired iPad or iPhone found. Plug it in, unlock it, and trust this Mac."; exit 1; }
echo "→ device $DEVICE"

xcodegen --quiet
xcodebuild -project ViewSwitcher.xcodeproj -scheme "ViewSwitcher iPad" -configuration Debug \
  -destination "generic/platform=iOS" -derivedDataPath build/dd \
  -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM" \
  -quiet build

APP="build/dd/Build/Products/Debug-iphoneos/ViewSwitcher.app"
xcrun devicectl device install app --device "$DEVICE" "$APP"
xcrun devicectl device process launch --terminate-existing --device "$DEVICE" "$BUNDLE_ID"
echo "✓ ViewSwitcher is running on the device."
