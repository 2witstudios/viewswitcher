# shellcheck shell=bash
# Checks a release build runs before anything slow: sourced by build.sh (--release, --publish) and
# ipad-release.sh; never run on its own. A release must be rebuildable from a commit everyone has.
# ALLOW_DIRTY=1 skips the clean-tree check for a one-off local test build (it says so, loudly).

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
require_clean_tree() {
  local dirty
  dirty="$(git -C "$1" status --porcelain)"
  [ -z "$dirty" ] && return 0
  if [ "${ALLOW_DIRTY:-}" = 1 ]; then
    echo "⚠ ALLOW_DIRTY=1: building from a working tree with changes. Don't ship this build." >&2
    return 0
  fi
  echo "✗ The working tree has changes, so this build wouldn't match any commit:" >&2
  echo "$dirty" | head -20 | sed 's/^/    /' >&2
  echo "  Commit or remove them (or ALLOW_DIRTY=1 for a local test build you won't ship)." >&2
  return 1
}

# HEAD is on origin/main, so the release tag (created on HEAD) names a commit that's been reviewed.
require_head_on_main() {
  git -C "$1" fetch -q origin main || { echo "✗ Couldn't fetch origin/main to check HEAD against it." >&2; return 1; }
  git -C "$1" merge-base --is-ancestor HEAD origin/main && return 0
  echo "✗ HEAD ($(git -C "$1" rev-parse --short HEAD)) isn't on origin/main: publish only what main has." >&2
  return 1
}
