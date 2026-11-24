import type { ObsSetup } from "./types";

/** OBS has what the switcher needs: the scene, the program source pointing here, the ground. Devices are the user's to add. */
export const obsReady = (s: ObsSetup) => s.scene && s.program && s.ground;
