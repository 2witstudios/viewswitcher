# Checks build.sh runs on what it signed. Sourced; also sourced by sign-check.test.ts.

# Whether the code at <path> is signed for the hardened runtime: the runtime bit (0x10000) of its
# code directory's flags, whatever else is set beside it. A Developer ID signature reads
# flags=0x10000(runtime), an ad hoc one (mac:build --unsigned) flags=0x10002(adhoc,runtime).
hardened_runtime() {
  local out flags
  out="$(codesign -dv "$1" 2>&1 || true)"
  flags="$(sed -n 's/.*CodeDirectory .*flags=0x\([0-9a-fA-F]*\).*/\1/p' <<<"$out" | head -1)"
  [ -n "$flags" ] && (( (16#$flags & 16#10000) != 0 ))
}
