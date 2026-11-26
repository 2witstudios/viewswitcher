// A change to an org's shared theme changes every tile's url at once. Reloading them all together
// would start every scene on the page in the same moment (on an iPad, a stall of several seconds),
// so they go one at a time, a short gap apart, the ones on screen first.

export type Stagger = {
  /**
   * Run `run` when its turn comes. `onScreen` is asked at each turn, so a tile scrolled into view
   * meanwhile goes ahead of the rest. Returns a cancel (a tile that went away, or wants a newer url).
   */
  request: (run: () => void, onScreen: () => boolean) => () => void;
};

export function createStagger({ gap, later }: { gap: number; later: (ms: number, fn: () => void) => void }): Stagger {
  const waiting: { run: () => void; onScreen: () => boolean }[] = [];
  let pending = false;
  const next = () => {
    pending = false;
    const i = Math.max(0, waiting.findIndex((w) => w.onScreen()));
    const job = waiting.splice(i, 1)[0];
    if (!job) return;
    job.run();
    pending = true;
    later(gap, next);
  };
  return {
    request(run, onScreen) {
      const job = { run, onScreen };
      waiting.push(job);
      // The first turn waits for the current render, so every tile that changed with it is waiting
      // and the ones on screen can go first.
      if (!pending) {
        pending = true;
        later(0, next);
      }
      return () => {
        const i = waiting.indexOf(job);
        if (i >= 0) waiting.splice(i, 1);
      };
    },
  };
}

/** The tiles' reloads after a shared theme changes: about a tenth of a second apart. */
export const tileReloads = createStagger({ gap: 100, later: (ms, fn) => void setTimeout(fn, ms) });
