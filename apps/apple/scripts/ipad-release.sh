#!/usr/bin/env bash
# bun run ipad:release (MAC-17, MAC-20): archive ViewSwitcher iPad (Release), export it for App Store
# Connect, check it as App Store validation would, and upload it.
#
#   bun run ipad:release             archive, export, check, upload to App Store Connect
#   bun run ipad:release --export    archive, export and check only: build/ipad/export/ViewSwitcher.ipa, no upload
#
# Upload needs the App Store Connect API key (scripts/release-env.sh): ASC_KEY_ID, ASC_ISSUER_ID and
# ASC_KEY_PATH from the environment or the gitignored apps/apple/.release.env. --export uses the key when
# it's complete, else the Apple account signed in to Xcode (Settings → Accounts).
# Env: TEAM (default M96WTV3CKX), BUILD_NUMBER (default the UTC time, YYYYMMDDHHMM: always increasing).
set -euo pipefail
cd "$(dirname "$0")/.."
APPLE="$PWD"
TEAM="${TEAM:-M96WTV3CKX}"
UPLOAD=1
for arg in "$@"; do
  case "$arg" in
    --export) UPLOAD=0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done
step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

source "$APPLE/scripts/release-guard.sh"
require_clean_tree "$APPLE/../.."

source "$APPLE/scripts/release-env.sh"
load_release_env "$APPLE"
AUTH=()
if [ "$UPLOAD" = 1 ]; then
  require_asc "upload the iPad app to App Store Connect" || { echo "  To build and check without uploading: bun run ipad:release --export" >&2; exit 1; }
fi
if [ -z "$(asc_problems)" ]; then
  AUTH=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
  echo "Signing and uploading with App Store Connect API key $ASC_KEY_ID."
else
  echo "No complete App Store Connect API key: signing with the Apple account in Xcode (export only)."
fi

VERSION="$(sed -n 's/^ *MARKETING_VERSION: *"\(.*\)"/\1/p' project.yml | head -1)"
BUILD_NUMBER="${BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}"
[[ "$BUILD_NUMBER" =~ ^[0-9]+$ ]] || { echo "BUILD_NUMBER must be an integer (got $BUILD_NUMBER)" >&2; exit 2; }
OUT="$APPLE/build/ipad"
ARCHIVE="$OUT/ViewSwitcher-iPad.xcarchive"
rm -rf "$OUT"
mkdir -p "$OUT"

step "Archive ViewSwitcher iPad $VERSION ($BUILD_NUMBER)"
xcodegen --quiet
xcodebuild -project ViewSwitcher.xcodeproj -scheme "ViewSwitcher iPad" -configuration Release \
  -destination "generic/platform=iOS" -derivedDataPath build/dd-ipad -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} \
  DEVELOPMENT_TEAM="$TEAM" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" -quiet archive

options() { # options <export|upload>
  cat > "$OUT/export-$1.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$1</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST
  echo "$OUT/export-$1.plist"
}

step "Export for App Store Connect"
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist "$(options export)" -exportPath "$OUT/export" \
  -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} -quiet
IPA="$(ls "$OUT"/export/*.ipa | head -1)"

step "Check the build (MAC-20)"
bash "$APPLE/scripts/ipad-check.sh" "$IPA" "$BUILD_NUMBER"

if [ "$UPLOAD" = 1 ]; then
  step "Upload to App Store Connect"
  rm -rf "$OUT/upload" # a summary left by an earlier upload must never be compared with this one
  xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist "$(options upload)" -exportPath "$OUT/upload" \
    -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"}
  # The upload is a second export of the same archive with the same options (only the destination
  # differs). Confirm it was signed exactly like the .ipa that ipad-check.sh passed, when xcodebuild says:
  # it writes no DistributionSummary.plist for an upload in some versions (Xcode 26), or an empty one.
  # Prints "<certificate SHA1> <profile UUID>", or nothing when the summary is missing or unreadable.
  signed_with() {
    [ -s "$1/DistributionSummary.plist" ] || return 0
    plutil -convert json -o - "$1/DistributionSummary.plist" 2>/dev/null | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except ValueError:
    sys.exit(0)
for apps in d.values():
    for a in apps:
        if a.get("name", "").endswith(".app"):
            print(a.get("certificate", {}).get("SHA1", ""), a.get("profile", {}).get("UUID", ""))
' || true
  }
  checked="$(signed_with "$OUT/export")" uploaded="$(signed_with "$OUT/upload")"
  echo "✓ Uploaded ViewSwitcher iPad $VERSION ($BUILD_NUMBER). It appears in App Store Connect → TestFlight once processed."
  if [ -z "$checked" ] || [ -z "$uploaded" ]; then
    which=upload; [ -n "$checked" ] || which=export
    echo "  (Signing not compared: xcodebuild wrote no readable DistributionSummary.plist for the $which."
    echo "   The upload used the same archive, options and signing as the checked .ipa.)"
  elif [ "$checked" != "$uploaded" ]; then
    echo "✗ But the uploaded build was signed differently from the checked .ipa (certificate or profile): check App Store Connect before submitting." >&2
    exit 1
  fi
else
  echo "✓ $IPA (not uploaded)"
fi
