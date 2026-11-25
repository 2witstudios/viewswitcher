// Cue then Take (PHONE-2). On a phone, held in one hand during a show, one tap going straight on air
// is too easy to do by accident. So at phone width a tap cues a scene, and Take puts it on air.
// Wider screens (iPad, Mac, a browser) keep one tap. Pure, so it's tested without a page.
import { useSyncExternalStore } from "react";

/** Where the phone layout starts in styles.css; cue then Take starts at the same width. */
export const PHONE_QUERY = "(max-width: 600px)";

/** The cue after a tap on `tapped`: the scene on air or the one already cued clears it, any other cues it. */
export function cueAfterTap({ cued, onAir }: { cued: string | null; onAir: string | undefined }, tapped: string): string | null {
  if (tapped === onAir || tapped === cued) return null;
  return tapped;
}

/** The cue after the on-air scene changed (Take here, or a switch from another device or an agent). */
export function cueAfterOnAir(cued: string | null, onAir: string | undefined): string | null {
  return cued !== null && cued === onAir ? null : cued;
}

/** Whether the page is at phone width, following the window as it resizes (Split View, rotation). */
export function usePhone(): boolean {
  return useSyncExternalStore(
    (l) => {
      if (typeof matchMedia === "undefined") return () => {};
      const m = matchMedia(PHONE_QUERY);
      m.addEventListener("change", l);
      return () => m.removeEventListener("change", l);
    },
    () => typeof matchMedia !== "undefined" && matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}
