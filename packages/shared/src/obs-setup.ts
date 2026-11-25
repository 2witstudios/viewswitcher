import type { ObsSetup } from "./types";

/**
 * OBS has what the switcher needs: the scene, the program source pointing here and on top, the ground
 * at the bottom. Devices are the user's to add.
 */
export const obsReady = (s: ObsSetup) => s.scene && s.program && s.ground && s.ordered;
