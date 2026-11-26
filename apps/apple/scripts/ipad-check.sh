#!/usr/bin/env bash
# Checks an exported ViewSwitcher (iPhone and iPad) .ipa for what App Store validation rejects, before upload.
# Run by scripts/ipad-release.sh after the export.
#   bash apps/apple/scripts/ipad-check.sh <ViewSwitcher.ipa> [expected build number]
set -euo pipefail
IPA="$1"
WANT_BUILD="${2:-}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
ditto -x -k "$IPA" "$WORK"
APP="$(ls -d "$WORK"/Payload/*.app | head -1)"
PLIST="$APP/Info.plist"
FAIL=0
ok() { printf '  ✓ %s\n' "$1"; }
bad() { printf '  ✗ %s\n' "$1" >&2; FAIL=1; }
get() { plutil -extract "$1" raw -o - "$PLIST" 2>/dev/null || true; }
json() { plutil -extract "$1" json -o - "$PLIST" 2>/dev/null || true; }

# Version and build
build="$(get CFBundleVersion)"; version="$(get CFBundleShortVersionString)"
[[ "$version" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]] && ok "version $version" || bad "CFBundleShortVersionString \"$version\" isn't 1 to 3 integers"
[[ "$build" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]] && ok "build $build" || bad "CFBundleVersion \"$build\" isn't 1 to 3 integers"
[ -z "$WANT_BUILD" ] || [ "$build" = "$WANT_BUILD" ] || bad "CFBundleVersion is $build, expected $WANT_BUILD"
[ "$(get CFBundleIdentifier)" = "com.twowitstudios.viewswitcher" ] && ok "bundle id com.twowitstudios.viewswitcher" || bad "bundle id is $(get CFBundleIdentifier)"
[ "$(json UIDeviceFamily)" = "[1,2]" ] && ok "iPhone and iPad (universal)" || bad "UIDeviceFamily is $(json UIDeviceFamily), expected [1,2]"

# Export compliance
[ "$(get ITSAppUsesNonExemptEncryption)" = "false" ] && ok "ITSAppUsesNonExemptEncryption NO" || bad "ITSAppUsesNonExemptEncryption isn't NO"

# Launch screen
plutil -extract UILaunchScreen xml1 -o - "$PLIST" >/dev/null 2>&1 && ok "launch screen (UILaunchScreen)" || bad "no UILaunchScreen"

# Orientations and multitasking: every orientation and no full-screen lock, in both keys
for key in UISupportedInterfaceOrientations 'UISupportedInterfaceOrientations~ipad'; do
  o="$(json "$key")"
  all=1
  for want in Portrait PortraitUpsideDown LandscapeLeft LandscapeRight; do [[ "$o" == *"\"UIInterfaceOrientation$want\""* ]] || all=0; done
  [ "$all" = 1 ] && ok "$key: all four" || bad "$key must list all four orientations for multitasking (has $o)"
done
[ "$(get UIRequiresFullScreen)" = "false" ] && ok "UIRequiresFullScreen NO (Split View, Stage Manager)" || bad "UIRequiresFullScreen isn't NO"

# Icons: the compiled catalog's iPhone and iPad icons, named in the plist, and the 1024 App Store icon without alpha
for key in CFBundleIcons 'CFBundleIcons~ipad'; do
  icons="$(plutil -convert json -o - "$PLIST" | python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1],{}).get("CFBundlePrimaryIcon",{}).get("CFBundleIconName",""))' "$key")"
  [ "$icons" = "AppIcon" ] && ok "$key → AppIcon" || bad "no $key AppIcon"
done
[ -f "$APP/Assets.car" ] || bad "no Assets.car"
info="$(xcrun --sdk iphoneos assetutil --info "$APP/Assets.car" 2>/dev/null || true)"
for px in 20 29 40 58 60 76 80 87 120 152 167 180 1024; do
  python3 -c '
import json, sys
px = int(sys.argv[1]); items = json.load(sys.stdin)
icons = [i for i in items if i.get("Name") == "AppIcon" and i.get("PixelWidth") == px]
sys.exit(0 if icons and (px != 1024 or not any(i.get("Opaque") is False for i in icons)) else 1)
' "$px" <<< "$info" && ok "icon ${px}px" || bad "icon ${px}px missing from Assets.car (or the 1024 has alpha)"
done

# Privacy manifest: present, collects nothing, no tracking
PI="$APP/PrivacyInfo.xcprivacy"
if [ -f "$PI" ] && plutil -lint -s "$PI"; then
  [ "$(plutil -extract NSPrivacyTracking raw -o - "$PI")" = "false" ] && ok "PrivacyInfo.xcprivacy: no tracking" || bad "PrivacyInfo.xcprivacy says it tracks"
  [ "$(plutil -extract NSPrivacyCollectedDataTypes json -o - "$PI")" = "[]" ] && ok "PrivacyInfo.xcprivacy: no data collected" || bad "PrivacyInfo.xcprivacy lists collected data"
else bad "no valid PrivacyInfo.xcprivacy"; fi

# Usage strings: exactly the permissions the app asks for, each with a reason
usage="$(plutil -convert json -o - "$PLIST" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(" ".join(sorted(k for k in d if k.endswith("UsageDescription") and str(d[k]).strip())))')"
[ "$usage" = "NSCameraUsageDescription NSLocalNetworkUsageDescription" ] && ok "usage strings: camera (pairing scanner) and local network" || bad "usage strings are \"$usage\", expected NSCameraUsageDescription and NSLocalNetworkUsageDescription"
[ "$(json NSBonjourServices)" = '["_http._tcp"]' ] && ok "NSBonjourServices _http._tcp (finding the Mac)" || bad "NSBonjourServices is $(json NSBonjourServices), expected [\"_http._tcp\"]"

# Signing: distribution, not a debug build
gta="$(codesign -d --entitlements - --xml "$APP" 2>/dev/null | plutil -extract get-task-allow raw -o - - 2>/dev/null || true)"
[ "$gta" = "true" ] && bad "signed with get-task-allow (a development build)" || ok "distribution signature (no get-task-allow)"
codesign --verify --strict "$APP" 2>/dev/null && ok "signature verifies" || bad "codesign --verify failed"
if [ -f "$APP/embedded.mobileprovision" ]; then
  prof="$(security cms -D -i "$APP/embedded.mobileprovision" 2>/dev/null || true)"
  [[ "$prof" == *"ProvisionedDevices"* ]] && bad "the profile lists devices (not an App Store profile)" || ok "App Store provisioning profile"
else bad "no embedded.mobileprovision"; fi

[ "$FAIL" = 0 ] && echo "✓ $(basename "$IPA") passes the App Store checks" || { echo "✗ $(basename "$IPA") would be rejected (above)" >&2; exit 1; }
