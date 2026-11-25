# App Store Connect API key for releases (MAC-17). Sourced by build.sh (mac:release) and
# ipad-release.sh (ipad:release); never run on its own.
#
#   ASC_KEY_ID      the key's ID (Users and Access → Integrations → App Store Connect API), e.g. AB12CD34EF
#   ASC_ISSUER_ID   the issuer ID shown above the keys on that same page (a UUID)
#   ASC_KEY_PATH    the .p8 file; default ~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8
#
# Each comes from the environment first, else from apps/apple/.release.env (gitignored; copy
# .release.env.example). Nothing here prints the key: only its path and IDs.

load_release_env() {
  local file="$1/.release.env" line key value
  if [ -f "$file" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      [[ "$line" =~ ^[[:space:]]*# ]] && continue
      [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?(ASC_KEY_ID|ASC_ISSUER_ID|ASC_KEY_PATH)[[:space:]]*=[[:space:]]*(.*)$ ]] || continue
      key="${BASH_REMATCH[2]}"
      value="${BASH_REMATCH[3]}"
      # A comment after the value needs whitespace before its # (a path may contain #).
      [[ "$value" =~ ^(.*[^[:space:]])[[:space:]]+#.*$ ]] && value="${BASH_REMATCH[1]}"
      [[ "$value" =~ ^[[:space:]]*#.*$ ]] && value=""
      value="${value%"${value##*[![:space:]]}"}"
      value="${value#\"}"; value="${value%\"}"; value="${value#\'}"; value="${value%\'}"
      # The environment wins over the file.
      [ -n "${!key:-}" ] || printf -v "$key" '%s' "$value"
    done < "$file"
  fi
  ASC_KEY_ID="${ASC_KEY_ID:-}"
  ASC_ISSUER_ID="${ASC_ISSUER_ID:-}"
  ASC_KEY_PATH="${ASC_KEY_PATH:-}"
  ASC_KEY_PATH="${ASC_KEY_PATH/#\~/$HOME}"
  if [ -z "$ASC_KEY_PATH" ] && [ -n "$ASC_KEY_ID" ]; then
    ASC_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8"
  fi
}

# The values that are missing or wrong, one per line (empty when the key is usable).
asc_problems() {
  [ -n "$ASC_KEY_ID" ] || echo "ASC_KEY_ID is not set: the key's ID, e.g. AB12CD34EF (App Store Connect → Users and Access → Integrations → App Store Connect API)."
  if [ -z "$ASC_ISSUER_ID" ]; then
    echo "ASC_ISSUER_ID is not set: the issuer ID, a UUID shown above the list of keys at App Store Connect → Users and Access → Integrations → App Store Connect API (MAC-21)."
  elif ! [[ "$ASC_ISSUER_ID" =~ ^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$ ]]; then
    echo "ASC_ISSUER_ID is not a UUID: copy the issuer ID from App Store Connect → Users and Access → Integrations → App Store Connect API."
  fi
  if [ -z "$ASC_KEY_PATH" ]; then
    echo "ASC_KEY_PATH is not set, and there's no ASC_KEY_ID to find AuthKey_<id>.p8 by."
  elif [ ! -r "$ASC_KEY_PATH" ]; then
    echo "ASC_KEY_PATH: no readable key file at $ASC_KEY_PATH (the AuthKey_<id>.p8 downloaded once from App Store Connect)."
  fi
}

# Fails with every missing value and where to set it.
require_asc() { # require_asc <what this is for>
  local problems
  problems="$(asc_problems)"
  [ -z "$problems" ] && return 0
  {
    printf '\n✗ Can'\''t %s: the App Store Connect API key isn'\''t fully configured.\n\n' "$1"
    while IFS= read -r p; do printf '  • %s\n' "$p"; done <<< "$problems"
    printf '\n  Set them in the environment or in apps/apple/.release.env (gitignored; see .release.env.example).\n\n'
  } >&2
  return 1
}
