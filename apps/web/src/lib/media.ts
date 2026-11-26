// The phone layouts' media queries, for the few things CSS alone shouldn't do:
// mounting the upright on-air cover only where it shows, and the sideways library as a modal drawer.
// Keep them identical to styles.css.
import { useSyncExternalStore } from "react";

/** The phone layout: upright, the on-air cover on top. */
export const UPRIGHT = "(max-width: 600px)";
/** The deck: a phone held sideways, a short touch screen no wider than the largest phone (the iPhone 16 and
 *  17 Pro Max, 956 pt) and narrower than any iPad held sideways (the mini, 1133 pt), so an iPad with the
 *  keyboard up keeps its editing. Known trade-off: an iPad window narrower than 1000 pt (Split View,
 *  Stage Manager) with the keyboard up still matches; a viewport query can't tell it from a phone.
 *  Wins over UPRIGHT where both match. */
export const DECK = "(max-height: 500px) and (max-width: 1000px) and (pointer: coarse)";

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
