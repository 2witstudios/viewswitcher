import type { ObsSetup } from "./types";

/** OBS has the switcher's scene, its program source pointing here, and its ground. */
export const obsPresent = (s: ObsSetup) => s.scene && s.program && s.ground;

/**
 * OBS has what the switcher needs: all of it present, the program on top and the ground at the
 * bottom. Devices are the user's to add.
 */
export const obsReady = (s: ObsSetup) => obsPresent(s) && s.ordered;
