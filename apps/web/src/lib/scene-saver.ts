// The scene editor's save queue: one save at a time, each sent against the version of the file
// its element ids came from. When the editor reloads the file (after a 409), ids from before the
// reload may point at different elements, so edits still queued from then are never sent: they
// go to `onStale` (the conflict screen) instead.
import type { SceneEdit } from "@viewswitcher/shared";

export type SaverBase = { hash: string };

export function createSceneSaver<B extends SaverBase, M>(opts: {
  /** The file version saves go against now. */
  base: () => B | null;
  /** Bumped whenever the editor reloads the file; edits made before a bump are stale. */
  generation: () => number;
  send: (hash: string, edits: SceneEdit[]) => Promise<{ hash: string }>;
  isConflict: (e: unknown) => boolean;
  onSaved: (base: B, edits: SceneEdit[], hash: string, meta: M) => void;
  /** The file changed underneath: `base` is the version these edits were made against. */
  onConflict: (edits: SceneEdit[], base: B) => Promise<void>;
  /** Made before a reload, so never sent. */
  onStale: (edits: SceneEdit[]) => void;
  onError: (e: unknown) => Promise<void>;
}) {
  let queue: Promise<unknown> = Promise.resolve();
  /** `madeIn`: the generation the edit's ids came from, when it started before this call (a drag, typing). */
  const save = (edits: SceneEdit[], meta: M, madeIn = opts.generation()): Promise<void> => {
    const next = queue.then(async () => {
      if (opts.generation() !== madeIn) return opts.onStale(edits);
      const b = opts.base();
      if (!b) return;
      try {
        const r = await opts.send(b.hash, edits);
        opts.onSaved(b, edits, r.hash, meta);
      } catch (e) {
        if (opts.isConflict(e)) await opts.onConflict(edits, b);
        else await opts.onError(e);
      }
    });
    // A handler that throws mustn't stop every later save.
    queue = next.catch(() => {});
    return next;
  };
  /** Resolves once the queue is empty: every save so far (and any queued meanwhile) has finished. */
  const idle = async () => {
    let seen: Promise<unknown>;
    do {
      seen = queue;
      await seen;
    } while (seen !== queue);
  };
  return Object.assign(save, { idle });
}
