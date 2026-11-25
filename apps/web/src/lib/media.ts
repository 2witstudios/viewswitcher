// The phone layouts' media queries (PHONE-3, PHONE-12), for the few things CSS alone shouldn't do:
// mounting the upright on-air cover only where it shows, and the sideways library as a modal drawer.
// Keep them identical to styles.css.
import { useSyncExternalStore } from "react";

/** The phone layout (MAC-27): upright, the on-air cover on top. */
export const UPRIGHT = "(max-width: 600px)";
/** The deck: a phone held sideways, a short touch screen. Wins over UPRIGHT where both match. */
export const DECK = "(max-height: 500px) and (pointer: coarse)";

export const isUprightPhone = ({ upright, deck }: { upright: boolean; deck: boolean }) => upright && !deck;

/** Whether `query` matches now, following resizes and rotation. False without matchMedia (tests, SSR). */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (l) => {
      if (typeof matchMedia === "undefined") return () => {};
      const m = matchMedia(query);
      m.addEventListener("change", l);
      return () => m.removeEventListener("change", l);
    },
    () => typeof matchMedia !== "undefined" && matchMedia(query).matches,
    () => false,
  );
}
