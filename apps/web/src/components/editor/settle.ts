// Waiting for every save to land before the editor goes (Done, Back, Edit a copy) or renames.
import type { createModeStore } from "./mode";

/**
 * Every queued save has finished, and none of them hit a conflict (that screen is up instead).
 * An add or delete that's saving finishes first, as every other save does. `then` runs once the
 * saves have landed, before leaving ends, so a step that needs a quiet scene (a rename's save) goes
 * next and nothing waiting for idle (a picture) slips in between.
 */
export async function settleSaves(
  k: { mode: Pick<ReturnType<typeof createModeStore>, "until" | "dispatch" | "now">; idle: () => Promise<void>; conflictPending: () => boolean },
  then?: () => void,
): Promise<boolean> {
  await k.mode.until((m) => m.kind !== "saving-structure");
  if (k.mode.dispatch({ t: "leave" }).kind !== "leaving") return false;
  let ok = false;
  try {
    await k.idle();
    ok = k.mode.now().kind !== "conflict" && !k.conflictPending();
    if (ok) then?.();
  } finally {
    k.mode.dispatch({ t: "end", kind: "leaving" });
  }
  return ok;
}
