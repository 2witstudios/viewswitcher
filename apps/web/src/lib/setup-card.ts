// What the OBS setup card says, from the live state. The card shows while OBS or the switcher's
// scene and sources are missing or out of order, and stays out of the way once everything is there.
import { obsReady, type LiveState } from "@viewswitcher/shared";

export type SetupCard =
  /**
   * OBS isn't reachable: it's closed, or its WebSocket server is off. With `auth`, OBS is there but asks
   * for a password the switcher doesn't have ("missing"), or refused the one it has ("wrong").
   */
  | { kind: "connect"; auth?: "missing" | "wrong" }
  /** OBS is there but lacks the scene, a source, or the program source points elsewhere. */
  | { kind: "setup" }
  /** Set up, but a source was added above the program page (it covers every scene) or below the ground. */
  | { kind: "order" }
  /** Set up; these device sources still need adding in OBS by hand. */
  | { kind: "devices"; missing: string[] };

export function setupCard(state: Pick<LiveState, "obs" | "obsSetup">): SetupCard | null {
  if (!state.obs.connected) return state.obs.auth ? { kind: "connect", auth: state.obs.auth } : { kind: "connect" };
  const s = state.obsSetup;
  if (!s) return null; // connected, not checked yet: don't flash a card
  if (s.scene && s.program && s.ground && !s.ordered) return { kind: "order" };
  if (!obsReady(s)) return { kind: "setup" };
  if (s.missingDevices.length) return { kind: "devices", missing: s.missingDevices };
  return null;
}

/** A key that changes when the card's message does, so "Not now" hides only what was dismissed. */
export const cardKey = (c: SetupCard) =>
  c.kind === "devices" ? `devices:${c.missing.join(",")}` : c.kind === "connect" && c.auth ? `connect:${c.auth}` : c.kind;
