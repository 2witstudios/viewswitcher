# shellcheck shell=bash
# Checks a release build runs before anything slow: sourced by build.sh (--release, --publish) and
# ipad-release.sh; never run on its own. A release must be rebuildable from a commit everyone has:
# a build that ships (--publish, the iPad upload) needs a clean tree and HEAD on origin/main.
# ALLOW_DIRTY=1 skips the clean-tree check for a one-off local test build (it says so, loudly), but
# never for a build that ships: mac:release --publish, or ipad:release's upload.

# The Bun in .bun-version: it compiles the server sidecar into the app.
require_pinned_bun() {
  local want have
  want="$(tr -d '[:space:]' < "$1/.bun-version")"
  have="$(bun --version 2>/dev/null || echo none)"
  [ "$have" = "$want" ] && return 0
  echo "✗ Releases build with Bun $want (.bun-version); this machine has $have." >&2
  echo "  Install it: curl -fsSL https://bun.sh/install | bash -s bun-v$want" >&2
  return 1
}

# Nothing changed or untracked in the repo, so the build is exactly a commit.
# require_clean_tree <repo> [ship]: with "ship", the build leaves this Mac, so ALLOW_DIRTY doesn't apply.
require_clean_tree() {
  local dirty
  # --untracked-files=all whatever status.showUntrackedFiles says, so an untracked file can't hide.
  dirty="$(git -C "$1" status --porcelain --untracked-files=all)"
  [ -z "$dirty" ] && return 0
  if [ "${ALLOW_DIRTY:-}" = 1 ] && [ "${2:-}" != ship ]; then
    echo "⚠ ALLOW_DIRTY=1: building from a working tree with changes. Don't ship this build." >&2
    return 0
  fi
  echo "✗ The working tree has changes, so this build wouldn't match any commit:" >&2
  # A here-string, not echo | head: under pipefail, head closing early on a long list would fail the guard
  # with SIGPIPE before the hint below.
  head -20 <<<"$dirty" | sed 's/^/    /' >&2
  if [ "${2:-}" = ship ]; then
    echo "  Commit or remove them: a build that ships must match a commit (ALLOW_DIRTY doesn't apply)." >&2
  else
    echo "  Commit or remove them (or ALLOW_DIRTY=1 for a local test build you won't ship)." >&2
  fi
  return 1
}

# HEAD is on origin/main, so what ships (the tagged Mac release, the iPad upload) is a reviewed commit.
# origin must be the repository releases go to, not a fork or a mirror, or "main" means someone else's.
RELEASE_REPO="2witstudios/viewswitcher"
require_head_on_main() {
  local url
  url="$(git -C "$1" remote get-url origin)"
  [[ "$url" =~ github\.com[:/]${RELEASE_REPO}(\.git)?$ ]] || {
    echo "✗ origin is $url, not github.com/$RELEASE_REPO: release from a clone of $RELEASE_REPO." >&2; return 1; }
  git -C "$1" fetch -q origin main || { echo "✗ Couldn't fetch origin/main to check HEAD against it." >&2; return 1; }
  git -C "$1" merge-base --is-ancestor HEAD origin/main && return 0
  echo "✗ HEAD ($(git -C "$1" rev-parse --short HEAD)) isn't on origin/main: publish only what main has." >&2
  return 1
}
