#!/usr/bin/env bash
# Builds ViewSwitcher.app (MAC-15): build/ViewSwitcher.dmg, universal (arm64 + x86_64).
#
#   bun run mac:build                 signed with the Developer ID for $TEAM if it's in the keychain, else ad hoc
#   bun run mac:build --unsigned      ad hoc signature only
#   bun run mac:build --app           just build/export/ViewSwitcher.app, no dmg (for scripts/e2e.ts)
#   bun run mac:release               signed, notarized and stapled; fails if any of that can't happen
# Every dmg build also writes build/appcast/appcast.xml (Sparkle, EdDSA-signed).
#   bun run mac:release --publish     ...then uploads ViewSwitcher.dmg and appcast.xml to a DRAFT GitHub
#                                     release v<version> (needs gh); publishing the draft is a person's call
#
# Env: TEAM (default M96WTV3CKX), APPLE_KEYCHAIN_PROFILE (notarytool profile, default viewswitcher-notary).
# No credentials live in the repo: signing uses the login keychain, notarizing a notarytool profile,
# and the appcast's EdDSA signature Sparkle's private key in the login keychain (see README.md).
set -euo pipefail

cd "$(dirname "$0")/.."
APPLE="$PWD"
REPO="$(cd ../.. && pwd)"
TEAM="${TEAM:-M96WTV3CKX}"
PROFILE="${APPLE_KEYCHAIN_PROFILE:-viewswitcher-notary}"
RELEASE=0 PUBLISH=0 UNSIGNED=0 APP_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --release) RELEASE=1 ;;
    --publish) RELEASE=1 PUBLISH=1 ;;
    --unsigned) UNSIGNED=1 ;;
    --app) APP_ONLY=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done
VERSION="$(sed -n 's/^ *MARKETING_VERSION: *"\(.*\)"/\1/p' project.yml | head -1)"
step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
BUILD="$APPLE/build"
DD="$BUILD/dd"
APP="$BUILD/export/ViewSwitcher.app"
DMG="$BUILD/ViewSwitcher.dmg"

# ---------------------------------------------------------------- identity and notary preflight
IDENTITY=""
if [ "$UNSIGNED" = 0 ]; then
  IDENTITY="$(security find-identity -v -p codesigning | sed -n "s/.*\"\(Developer ID Application: .*($TEAM)\)\"/\1/p" | head -1)"
  if [ -z "$IDENTITY" ]; then
    [ "$RELEASE" = 1 ] && { echo "No 'Developer ID Application … ($TEAM)' certificate in the keychain; a release must be signed." >&2; exit 1; }
    echo "No Developer ID certificate for $TEAM found: building with an ad hoc signature." >&2
  fi
fi
if [ "$RELEASE" = 1 ] && ! xcrun notarytool history --keychain-profile "$PROFILE" >/dev/null 2>&1; then
  cat >&2 <<MSG

✗ Can't notarize: there's no notarytool keychain profile "$PROFILE" (MAC-7a).
  Create it once with an app-specific password from appleid.apple.com, for the Apple ID on team $TEAM:

    xcrun notarytool store-credentials $PROFILE --apple-id <apple-id-email> --team-id $TEAM

  (It prompts for the app-specific password and stores it in the login keychain.)
  Or set APPLE_KEYCHAIN_PROFILE to an existing profile. A signed but unnotarized build: bun run mac:build

MSG
  exit 1
fi
sign() { # sign <path> [entitlements]: Developer ID + hardened runtime + timestamp, or ad hoc
  local ent=()
  [ -n "${2:-}" ] && ent=(--entitlements "$2")
  if [ -n "$IDENTITY" ]; then codesign --force --options runtime --timestamp "${ent[@]}" --sign "$IDENTITY" "$1"
  else codesign --force --options runtime "${ent[@]}" --sign - "$1"; fi
}

# ---------------------------------------------------------------- the payload (build/payload)
PAYLOAD="$BUILD/payload"
rm -rf "$PAYLOAD"
mkdir -p "$PAYLOAD"

step "Switcher (apps/web/dist)"
(cd "$REPO/apps/web" && bunx vite build)
ditto "$REPO/apps/web/dist" "$PAYLOAD/web"
ditto "$REPO/apps/server/starter" "$PAYLOAD/starter"
ditto "$REPO/apps/server/library-kit" "$PAYLOAD/library-kit"
rm -f "$PAYLOAD/library-kit/README.md"

step "Server sidecar: arm64 + x64, one universal binary"
for arch in arm64 x64; do
  bun build "$REPO/apps/server/src/index.ts" --compile --minify --target="bun-darwin-$arch" --outfile "$BUILD/sidecar/$arch/viewswitcher-server"
done
lipo -create "$BUILD/sidecar/arm64/viewswitcher-server" "$BUILD/sidecar/x64/viewswitcher-server" -output "$PAYLOAD/viewswitcher-server"
# Its own entitlements (allow-jit only; README.md). The app's signature then seals it as it is.
sign "$PAYLOAD/viewswitcher-server" Mac/Server.entitlements
lipo -archs "$PAYLOAD/viewswitcher-server"

# ---------------------------------------------------------------- the app
step "ViewSwitcher.app (xcodebuild archive, Release, universal)"
xcodegen --quiet
rm -rf "$BUILD/ViewSwitcher.xcarchive" "$BUILD/export"
signing=(CODE_SIGN_IDENTITY="-" CODE_SIGN_STYLE=Manual)
[ -n "$IDENTITY" ] && signing=(CODE_SIGN_IDENTITY="$IDENTITY" CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="$TEAM")
xcodebuild -project ViewSwitcher.xcodeproj -scheme ViewSwitcher -configuration Release -derivedDataPath "$DD" \
  -archivePath "$BUILD/ViewSwitcher.xcarchive" -destination "generic/platform=macOS" "${signing[@]}" -quiet archive

if [ -n "$IDENTITY" ]; then
  step "Developer ID export"
  cat > "$BUILD/export-options.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>developer-id</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Developer ID Application</string>
  <key>teamID</key><string>$TEAM</string>
</dict></plist>
PLIST
  xcodebuild -exportArchive -archivePath "$BUILD/ViewSwitcher.xcarchive" -exportOptionsPlist "$BUILD/export-options.plist" -exportPath "$BUILD/export" -quiet
else
  mkdir -p "$BUILD/export"
  ditto "$BUILD/ViewSwitcher.xcarchive/Products/Applications/ViewSwitcher.app" "$APP"
fi

step "Verify the app"
codesign --verify --deep --strict --verbose=2 "$APP"
# (Each check reads the whole output first: grep -q would close the pipe early, and pipefail would call that a failure.)
has() { local out; out="$("${@:2}" 2>&1 || true)"; [[ "$out" == *"$1"* ]]; }
has "x86_64 arm64" lipo -archs "$APP/Contents/MacOS/ViewSwitcher" || { echo "the app isn't universal" >&2; exit 1; }
has "x86_64 arm64" lipo -archs "$APP/Contents/Helpers/viewswitcher-server" || { echo "the sidecar isn't universal" >&2; exit 1; }
has "com.apple.security.cs.allow-jit" codesign -d --entitlements - --xml "$APP/Contents/Helpers/viewswitcher-server" || { echo "the sidecar lost its allow-jit entitlement" >&2; exit 1; }
has "flags=0x10000(runtime)" codesign -dv "$APP/Contents/Helpers/viewswitcher-server" || { echo "the sidecar isn't on the hardened runtime" >&2; exit 1; }
has "flags=0x10000(runtime)" codesign -dv "$APP" || { echo "the app isn't on the hardened runtime" >&2; exit 1; }
if [ -n "$IDENTITY" ]; then
  has "TeamIdentifier=$TEAM" codesign -dv "$APP" || { echo "the app isn't signed by $TEAM" >&2; exit 1; }
  has "TeamIdentifier=$TEAM" codesign -dv "$APP/Contents/Helpers/viewswitcher-server" || { echo "the sidecar isn't signed by $TEAM" >&2; exit 1; }
fi

if [ "$RELEASE" = 1 ]; then
  step "Notarize and staple the app"
  ditto -c -k --keepParent "$APP" "$BUILD/ViewSwitcher-notarize.zip"
  xcrun notarytool submit "$BUILD/ViewSwitcher-notarize.zip" --keychain-profile "$PROFILE" --wait
  xcrun stapler staple "$APP"
  rm -f "$BUILD/ViewSwitcher-notarize.zip"
fi
[ "$APP_ONLY" = 1 ] && { step "Done"; echo "$APP"; exit 0; }

# ---------------------------------------------------------------- the dmg
step "ViewSwitcher.dmg"
STAGE="$BUILD/dmg"
rm -rf "$STAGE" "$DMG"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/ViewSwitcher.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname ViewSwitcher -srcfolder "$STAGE" -fs HFS+ -format ULFO -ov "$DMG" -quiet
rm -rf "$STAGE"
[ -n "$IDENTITY" ] && codesign --force --timestamp --sign "$IDENTITY" "$DMG"
if [ "$RELEASE" = 1 ]; then
  step "Notarize and staple the dmg"
  xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
  xcrun stapler staple "$DMG"
  spctl -a -vv -t exec "$APP"
  spctl -a -vv -t open --context context:primary-signature "$DMG"
  xcrun stapler validate "$DMG"
fi
[ -n "$IDENTITY" ] && codesign --verify --strict "$DMG"

# ---------------------------------------------------------------- the appcast
step "Sparkle appcast"
# Signed with ViewSwitcher's EdDSA key (login keychain, account viewswitcher). generate_keys owns the
# keychain item, so it exports the key (no keychain prompt) into a private temp folder, generate_appcast
# reads it on stdin, and it's deleted at once (and by the trap if anything fails). Never in the repo.
SPARKLE="$DD/SourcePackages/artifacts/sparkle/Sparkle/bin"
FEED="$BUILD/appcast"
rm -rf "$FEED" && mkdir -p "$FEED"
cp "$DMG" "$FEED/"
KEYDIR="$(mktemp -d)"
trap 'rm -rf "$KEYDIR"' EXIT
chmod 700 "$KEYDIR"
"$SPARKLE/generate_keys" --account viewswitcher -x "$KEYDIR/key" >/dev/null
"$SPARKLE/generate_appcast" --ed-key-file - --download-url-prefix "https://github.com/2witstudios/viewswitcher/releases/download/v$VERSION/" "$FEED" < "$KEYDIR/key"
rm -rf "$KEYDIR"
rm -f "$FEED/ViewSwitcher.dmg"
has 'sparkle:edSignature' cat "$FEED/appcast.xml" || { echo "appcast.xml has no EdDSA signature" >&2; exit 1; }

if [ "$PUBLISH" = 1 ]; then
  step "Draft GitHub release v$VERSION"
  # The dmg the site links to (releases/latest/download/ViewSwitcher.dmg) and the appcast Sparkle
  # reads. A draft: nobody gets it until a person publishes the release.
  gh release create "v$VERSION" --repo 2witstudios/viewswitcher --draft --title "ViewSwitcher $VERSION" \
    --notes "ViewSwitcher $VERSION for macOS (Apple silicon and Intel)." "$DMG" "$BUILD/appcast/appcast.xml"
fi

step "Done"
ls -lh "$DMG"
