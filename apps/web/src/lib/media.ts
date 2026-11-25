// The phone layouts' media queries (PHONE-3, PHONE-12), for the few things CSS alone shouldn't do:
// mounting the upright on-air cover only where it shows, and the sideways library as a modal drawer.
// Keep them identical to styles.css.
import { useSyncExternalStore } from "react";

/** The phone layout (MAC-27): upright, the on-air cover on top. */
export const UPRIGHT = "(max-width: 600px)";
/** The deck: a phone held sideways, a short touch screen no wider than the largest phone (the iPhone 16 and
 *  17 Pro Max, 956 pt) and narrower than any iPad held sideways (the mini, 1133 pt), so an iPad with the
 *  keyboard up keeps its editing. Wins over UPRIGHT where both match. */
export const DECK = "(max-height: 500px) and (max-width: 1000px) and (pointer: coarse)";

/** Sideways viewports, for the tests: [width, height, the deck?]. */
export const SIDEWAYS: [number, number, boolean][] = [[956, 440, true], [932, 430, true], [844, 390, true], [568, 320, true], [1133, 480, false], [1180, 480, false]];

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
