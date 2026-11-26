#!/usr/bin/env bash
# Builds ViewSwitcher.app: build/ViewSwitcher.dmg, universal (arm64 + x86_64).
#
#   bun run mac:build                 signed with the Developer ID for $TEAM if it's in the keychain, else ad hoc
#   bun run mac:build --unsigned      ad hoc signature only
#   bun run mac:build --app           just build/export/ViewSwitcher.app, no dmg (for scripts/e2e.ts)
#   bun run mac:release               signed, notarized and stapled; fails if any of that can't happen
# Every dmg build also writes build/appcast/appcast.xml (Sparkle, EdDSA-signed).
#   bun run mac:release --publish     ...then uploads ViewSwitcher.dmg and appcast.xml to a DRAFT GitHub
#                                     release v<version> (needs gh); publishing the draft is a person's call
# --release and --publish need a clean tree and the Bun in .bun-version; --publish also needs HEAD on
# origin/main, and tags the draft on the commit it built (scripts/release-guard.sh). Both install
# bun.lock into empty node_modules first. ALLOW_DIRTY=1 lets --release build from a dirty tree for a
# local test (installing what package.json says); never --publish.
#
# Env: TEAM (default M96WTV3CKX), APPLE_KEYCHAIN_PROFILE (notarytool profile, default viewswitcher-notary),
# and when that profile doesn't exist, the App Store Connect API key: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH
# (env or the gitignored apps/apple/.release.env; scripts/release-env.sh).
# No credentials live in the repo: signing uses the login keychain, notarizing a notarytool profile or the
# API key's .p8 file, and the appcast's EdDSA signature Sparkle's private key in the login keychain (README.md).
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
if [ "$RELEASE" = 1 ]; then
  source "$APPLE/scripts/release-guard.sh"
  require_pinned_bun "$REPO"
  if [ "$PUBLISH" = 1 ]; then
    require_clean_tree "$REPO" ship
    require_head_on_main "$REPO"
  else
    require_clean_tree "$REPO"
  fi
  # The commit the guards passed: the release is tagged on it even if HEAD moves during the build.
  BUILT="$(git -C "$REPO" rev-parse HEAD)"
  # node_modules is gitignored, so the clean tree says nothing about it: install bun.lock into empty
  # node_modules folders, so no stale or extra package reaches the build (a file patched by hand can come
  # back only through a hardlinked cache; see below). A local test build from a dirty tree (ALLOW_DIRTY) installs what package.json says now
  # instead, since its bun.lock may have changed.
  if [ "${ALLOW_DIRTY:-}" = 1 ] && [ "$PUBLISH" = 0 ] && [ -n "$(git -C "$REPO" status --porcelain --untracked-files=all)" ]; then
    (cd "$REPO" && bun install)
  else
    # The root's and each workspace's folder, found as Bun finds workspaces (scripts/node-modules-dirs.ts),
    # never a wider search: $REPO can hold other checkouts (.pu/worktrees) with their own. An assignment,
    # so a failed lookup stops the build instead of skipping the cleanup.
    NM_DIRS="$(bun "$APPLE/scripts/node-modules-dirs.ts" "$REPO")"
    while IFS= read -r dir; do rm -rf "${REPO:?}/${dir:?}"; done <<<"$NM_DIRS"
    # clonefile: this install adds no hardlinks into Bun's cache. It doesn't re-check the cache, which a hand
    # edit reaches only through a hardlink backend configured elsewhere (bunfig, BUN_INSTALL_BACKEND).
    (cd "$REPO" && bun install --frozen-lockfile --backend=clonefile) || {
      echo "✗ bun install --frozen-lockfile failed, and node_modules was emptied for it: run bun install." >&2; exit 1; }
  fi
fi
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
# Notarizing: the notarytool keychain profile if it exists, else the App Store Connect
# API key (scripts/release-env.sh: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH from env or .release.env).
NOTARY=()
if [ "$RELEASE" = 1 ]; then
  if profile_out="$(xcrun notarytool history --keychain-profile "$PROFILE" 2>&1)"; then
    NOTARY=(--keychain-profile "$PROFILE")
    echo "Notarizing with the keychain profile $PROFILE."
  elif [[ "$profile_out" != *"No Keychain password item found"* ]]; then
    # The profile exists but notarytool can't use it (network, expired password, Apple's service).
    echo "✗ notarytool couldn't use the keychain profile $PROFILE:" >&2
    echo "$profile_out" | sed 's/^/    /' >&2
    exit 1
  else
    source "$APPLE/scripts/release-env.sh"
    load_release_env "$APPLE"
    require_asc "notarize (there's no notarytool keychain profile \"$PROFILE\" either)" || {
      echo "  Or create the profile once: xcrun notarytool store-credentials $PROFILE --apple-id <apple-id-email> --team-id $TEAM" >&2
      echo "  A signed but unnotarized build: bun run mac:build" >&2
      exit 1
    }
    NOTARY=(--key "$ASC_KEY_PATH" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER_ID")
    echo "Notarizing with App Store Connect API key $ASC_KEY_ID."
    # Fail now, not after a ten-minute build, if Apple refuses the key.
    xcrun notarytool history "${NOTARY[@]}" >/dev/null 2>&1 || {
      echo "✗ notarytool refused API key $ASC_KEY_ID (issuer $ASC_ISSUER_ID, key file $ASC_KEY_PATH): check the IDs and that the key has the Developer role or higher." >&2
      exit 1
    }
  fi
fi
if [ "$PUBLISH" = 1 ]; then
  gh auth status >/dev/null 2>&1 || { echo "✗ --publish needs the GitHub CLI signed in (gh auth login)." >&2; exit 1; }
  ! gh release view "v$VERSION" --repo 2witstudios/viewswitcher >/dev/null 2>&1 || {
    echo "✗ A release v$VERSION already exists: bump MARKETING_VERSION in project.yml first." >&2; exit 1; }
  # A tag left without a release: gh would reuse it (--target doesn't move a tag), so the draft would
  # name that commit while carrying this build. ^{} dereferences an annotated tag.
  TAGGED="$(git -C "$REPO" ls-remote origin "refs/tags/v$VERSION^{}" "refs/tags/v$VERSION" | awk 'NR==1 || /\^\{\}$/ {c=$1} END {print c}')"
  [ -z "$TAGGED" ] || [ "$TAGGED" = "$BUILT" ] || {
    echo "✗ Tag v$VERSION already exists on origin at ${TAGGED:0:7}, not ${BUILT:0:7}: bump MARKETING_VERSION or delete that tag." >&2; exit 1; }
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
# The built-in template packs: the starter and the site's six shows, from @viewswitcher/packs, the
# same source as the site's renders and downloads. Folders only; the server reads them at VIEWSWITCHER_PACKS.
(cd "$REPO" && bun apps/server/src/export-packs.ts "$PAYLOAD/packs")
rm -f "$PAYLOAD/packs/"*.zip

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
# Ad hoc: on the hardened runtime like a release, with library validation off (Mac/AdHoc.entitlements),
# since an ad hoc app has no team for Sparkle's to match and couldn't launch otherwise.
signing=(CODE_SIGN_IDENTITY="-" CODE_SIGN_STYLE=Manual CODE_SIGN_ENTITLEMENTS=Mac/AdHoc.entitlements)
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
source "$APPLE/scripts/sign-check.sh"
hardened_runtime "$APP/Contents/Helpers/viewswitcher-server" || { echo "the sidecar isn't on the hardened runtime" >&2; exit 1; }
hardened_runtime "$APP" || { echo "the app isn't on the hardened runtime" >&2; exit 1; }
if [ -n "$IDENTITY" ]; then
  # Library validation stays on in anything Developer ID signed: only the ad hoc build turns it off.
  has "disable-library-validation" codesign -d --entitlements - --xml "$APP" && { echo "the app turns off library validation (Mac/AdHoc.entitlements is for --unsigned only)" >&2; exit 1; }
  has "TeamIdentifier=$TEAM" codesign -dv "$APP" || { echo "the app isn't signed by $TEAM" >&2; exit 1; }
  has "TeamIdentifier=$TEAM" codesign -dv "$APP/Contents/Helpers/viewswitcher-server" || { echo "the sidecar isn't signed by $TEAM" >&2; exit 1; }
fi

if [ "$RELEASE" = 1 ]; then
  step "Notarize and staple the app"
  ditto -c -k --keepParent "$APP" "$BUILD/ViewSwitcher-notarize.zip"
  xcrun notarytool submit "$BUILD/ViewSwitcher-notarize.zip" "${NOTARY[@]}" --wait
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
  xcrun notarytool submit "$DMG" "${NOTARY[@]}" --wait
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
  # The tag is made on the commit that was built (gh's default is main's tip when the draft is published),
  # so the tree must still be that commit: nothing pulled, switched or edited during the build.
  [ "$(git -C "$REPO" rev-parse HEAD)" = "$BUILT" ] || { echo "✗ HEAD moved during the build (it was ${BUILT:0:7}): not publishing." >&2; exit 1; }
  require_clean_tree "$REPO" ship
  gh release create "v$VERSION" --repo 2witstudios/viewswitcher --draft --target "$BUILT" \
    --title "ViewSwitcher $VERSION" --notes "ViewSwitcher $VERSION for macOS (Apple silicon and Intel)." "$DMG" "$BUILD/appcast/appcast.xml"
fi

step "Done"
ls -lh "$DMG"
