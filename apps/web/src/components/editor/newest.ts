// Overlapping runs of one async step where only the newest may act: reading the scene file again can
// be started by a conflict, Reload and a change made elsewhere, and their answers can arrive in any
// order. An older run that finishes later must not put back an older version, and whoever awaited
// it gets the newest run's result instead.

/**
 * Wraps `run`, which is told whether it's still the newest (it checks before acting on what it read).
 * A call that has been overtaken resolves to the newest call's result.
 */
export function newestOnly<A extends unknown[], T>(run: (isNewest: () => boolean, ...args: A) => Promise<T>): (...args: A) => Promise<T> {
  let token = 0;
  let latest: Promise<T> | null = null;
  return (...args: A) => {
    const mine = ++token;
    const isNewest = () => mine === token;
    const p: Promise<T> = run(isNewest, ...args).then(
      (v) => (isNewest() ? v : latest!),
      (e) => {
        if (isNewest()) throw e;
        return latest!;
      },
    );
    latest = p;
    return p;
  };
}
