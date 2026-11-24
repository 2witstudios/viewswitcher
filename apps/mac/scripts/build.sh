#!/usr/bin/env bash
# Builds ViewSwitcher.app: release/ViewSwitcher.dmg (universal) and per-arch zips for auto-update.
#
#   bun run mac:build                 signed with the Developer ID for $TEAM if it's in the keychain, else unsigned
#   bun run mac:build --unsigned      skip signing
#   bun run mac:build --dir           just release/mac-arm64/ViewSwitcher.app, no dmg/zip (quick, for scripts/e2e.ts)
#   bun run mac:release               signed, notarized and stapled; fails if any of that can't happen
#   bun run mac:release --publish     ...then uploads to a DRAFT GitHub release v<version> (needs gh);
#                                     publishing the draft is a person's call
#
# Env: TEAM (default M96WTV3CKX), APPLE_KEYCHAIN_PROFILE (notarytool profile, default viewswitcher-notary).
# No credentials live in the repo: signing uses the login keychain, notarizing a notarytool profile.
set -euo pipefail

cd "$(dirname "$0")/.."
MAC="$PWD"
REPO="$(cd ../.. && pwd)"
TEAM="${TEAM:-M96WTV3CKX}"
PROFILE="${APPLE_KEYCHAIN_PROFILE:-viewswitcher-notary}"
RELEASE=0 PUBLISH=0 UNSIGNED=0 DIR=0
for arg in "$@"; do
  case "$arg" in
    --release) RELEASE=1 ;;
    --publish) RELEASE=1 PUBLISH=1 ;;
    --unsigned) UNSIGNED=1 ;;
    --dir) DIR=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done
VERSION="$(bun -e 'console.log(require("./package.json").version)')"
step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- identity and notary preflight
IDENTITY=""
if [ "$UNSIGNED" = 0 ]; then
  IDENTITY="$(security find-identity -v -p codesigning | sed -n "s/.*\"\(Developer ID Application: .*($TEAM)\)\"/\1/p" | head -1)"
  if [ -z "$IDENTITY" ]; then
    [ "$RELEASE" = 1 ] && { echo "No 'Developer ID Application … ($TEAM)' certificate in the keychain; a release must be signed." >&2; exit 1; }
    echo "No Developer ID certificate for $TEAM found: building unsigned." >&2
  fi
fi
if [ "$RELEASE" = 1 ] && ! xcrun notarytool history --keychain-profile "$PROFILE" >/dev/null 2>&1; then
  cat >&2 <<EOF

✗ Can't notarize: there's no notarytool keychain profile "$PROFILE" (MAC-7a).
  Create it once with an app-specific password from appleid.apple.com, for the Apple ID on team $TEAM:

    xcrun notarytool store-credentials $PROFILE --apple-id <apple-id-email> --team-id $TEAM

  (It prompts for the app-specific password and stores it in the login keychain.)
  Or set APPLE_KEYCHAIN_PROFILE to an existing profile. A signed but unnotarized build: bun run mac:build

EOF
  exit 1
fi

# ---------------------------------------------------------------- the pieces
step "Switcher (apps/web/dist)"
(cd "$REPO/apps/web" && bunx vite build)

step "Server sidecar, arm64 and x64"
for arch in arm64 x64; do
  out="build/sidecar/$arch/viewswitcher-server"
  mkdir -p "$(dirname "$out")"
  bun build "$REPO/apps/server/src/index.ts" --compile --minify --target="bun-darwin-$arch" --outfile "$out"
  if [ -n "$IDENTITY" ]; then
    # Its own entitlements (build/README.md); electron-builder leaves it alone (mac.signIgnore).
    codesign --force --options runtime --timestamp --entitlements build/entitlements.server.plist --sign "$IDENTITY" "$out"
  fi
done

step "Main process (dist/main.cjs)"
bun build src/main.ts --target=node --format=cjs --external electron --outfile dist/main.cjs

# ---------------------------------------------------------------- package
step "ViewSwitcher.app → dmg + zip"
args=(--mac --publish never)
[ "$DIR" = 1 ] && args=(--mac dir --arm64 --publish never)
if [ -n "$IDENTITY" ]; then
  args+=("-c.mac.identity=${IDENTITY#Developer ID Application: }" -c.dmg.sign=true)
else
  args+=(-c.mac.identity=null)
fi
if [ "$RELEASE" = 1 ]; then
  # electron-builder notarizes and staples each .app with this profile before making the dmg.
  export APPLE_KEYCHAIN_PROFILE="$PROFILE"
  args+=(-c.mac.notarize=true)
fi
rm -rf release
bunx electron-builder "${args[@]}"

DMG="release/ViewSwitcher.dmg"
if [ "$DIR" = 1 ]; then
  [ -n "$IDENTITY" ] && codesign --verify --deep --strict --verbose=2 release/mac-arm64/ViewSwitcher.app
  exit 0
fi
if [ "$RELEASE" = 1 ]; then
  step "Notarize and staple the dmg"
  xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
  xcrun stapler staple "$DMG"
fi

# ---------------------------------------------------------------- verify
if [ -n "$IDENTITY" ]; then
  step "Verify"
  for app in release/mac-universal/ViewSwitcher.app release/mac-arm64/ViewSwitcher.app release/mac/ViewSwitcher.app; do
    [ -d "$app" ] || continue
    codesign --verify --deep --strict --verbose=2 "$app"
    codesign --verify --strict "$app/Contents/Resources/viewswitcher-server"
    if [ "$RELEASE" = 1 ]; then
      spctl -a -vv -t exec "$app"
      xcrun stapler validate "$app"
    fi
  done
  codesign --verify --strict "$DMG"
  if [ "$RELEASE" = 1 ]; then
    spctl -a -vv -t open --context context:primary-signature "$DMG"
    xcrun stapler validate "$DMG"
  fi
fi

if [ "$PUBLISH" = 1 ]; then
  step "Draft GitHub release v$VERSION"
  # Everything electron-updater needs (latest-mac.yml, the zips and their blockmaps) and the dmg the
  # site links to. A draft: nobody gets it until a person publishes the release.
  shopt -s nullglob
  gh release create "v$VERSION" --repo 2witstudios/viewswitcher --draft --title "ViewSwitcher $VERSION" --notes "ViewSwitcher $VERSION for macOS." \
    "$DMG" release/latest-mac.yml release/*.zip release/*.zip.blockmap
fi

step "Done"
ls -lh release/*.dmg release/*.zip 2>/dev/null
