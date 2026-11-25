// The scene file the editor works on: the version it last read or saved (the base), the generation
// that every element id is checked against, the save queue, conflicts, and reading the file again
// when it changes somewhere else (an agent, another device).
import { applyEdits, changedElements, scanElements, toBase } from "@viewswitcher/shared";
import type { SceneBase, SceneEdit } from "@viewswitcher/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, SceneConflict } from "../../lib/api";
import { useLive } from "../../lib/live";
import { createSceneSaver } from "../../lib/scene-saver";
import { toast } from "../ui";
import { canReloadIn } from "./mode";
import type { ModeStore } from "./useMode";
import type { UndoEntry } from "./useUndo";

/** How often a change made elsewhere checks again whether the editor is free to load it. */
const OUTSIDE_RETRY_MS = 300;

export function useSceneDocument(path: string, opts: {
  mode: ModeStore;
  /** A new version is loaded: everything that named the old one's elements starts over. */
  onLoaded: (b: SceneBase) => void;
  /** A scene is open but couldn't be read again. */
  onStuck: () => void;
  /** A save failed (not a conflict): Undo no longer matches the file. */
  onSaveFailed: () => void;
  /** Nothing outside the mode is under way that loading another version would lose (a press, a nudge, a typed number, an upload). */
  quiet: () => boolean;
}) {
  const o = useRef(opts);
  o.current = opts;
  const { mode } = opts;

  const [base, setBaseState] = useState<SceneBase | null>(null);
  const baseRef = useRef<SceneBase | null>(null);
  const setBase = (b: SceneBase) => {
    baseRef.current = b;
    setBaseState(b);
  };
  const [loadError, setLoadError] = useState("");
  /** A scene is open but couldn't be read again: say so, with Reload, and keep everything else. */
  const [stuck, setStuck] = useState<string | null>(null);
  /** Bumped on every (re)load: element ids from before a reload may name different elements now. */
  const generation = useRef(0);
  /**
   * Bumped whenever element ids change: every load, and every add or delete. Something that holds
   * an id across a wait (a picture uploading) checks it before using the id.
   */
  const layout = useRef(0);
  /** A 409 whose latest version hasn't loaded yet. */
  const pendingConflict = useRef<{ edits: SceneEdit[]; prev: SceneBase } | null>(null);
  // Loads can overlap (a conflict, Reload, a change made elsewhere): the newest one wins, and an
  // older one that answers later waits for it instead of putting back an older version.
  const loadToken = useRef(0);
  const latestLoad = useRef<Promise<SceneBase | null>>(Promise.resolve(null));
  /** A change made elsewhere is waiting until the editor is free to load it. */
  const outside = useRef(false);
  const outsideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const apply = (b: SceneBase) => {
    generation.current++;
    layout.current++;
    setBase(b);
    setLoadError("");
    setStuck(null);
    mode.dispatch({ t: "reloaded", base: b });
    o.current.onLoaded(b);
    const pending = pendingConflict.current;
    pendingConflict.current = null;
    if (pending) mode.dispatch({ t: "conflict", conflict: { ...pending, changed: changedElements(pending.prev.source, b.source), latest: b } });
  };

  /**
   * Read the file and show it. With `ifChanged`, only when its hash isn't the base's (the editor's
   * own saves come back as changes too) and the editor is still free to.
   */
  const load = useCallback((ifChanged?: { stillFree: () => boolean }): Promise<SceneBase | null> => {
    const token = ++loadToken.current;
    const run = (async () => {
      try {
        const b = toBase(await api.sceneForEdit(path));
        if (token !== loadToken.current) return latestLoad.current;
        if (ifChanged) {
          if (b.hash === baseRef.current?.hash) return baseRef.current;
          // Someone started something while it was read: try again once they're done.
          if (!ifChanged.stillFree()) {
            outside.current = true;
            outsideTimer.current = setTimeout(() => void refreshRef.current(), OUTSIDE_RETRY_MS);
            return baseRef.current;
          }
        }
        apply(b);
        return b;
      } catch (e) {
        if (token !== loadToken.current) return latestLoad.current;
        // With a scene already open, a failed reload is a message, not the end of the editor.
        if (baseRef.current) {
          o.current.onStuck();
          setStuck(`Couldn't read the scene again: ${(e as Error).message}`);
        } else setLoadError((e as Error).message);
        return null;
      }
    })();
    latestLoad.current = run;
    return run;
  }, [path]);
  useEffect(() => void load(), [load]);

  // Save edits one at a time against the version their ids came from (see lib/scene-saver.ts).
  const saverRef = useRef<ReturnType<typeof createSceneSaver<SceneBase, UndoEntry[]>> | null>(null);
  if (!saverRef.current) {
    saverRef.current = createSceneSaver<SceneBase, UndoEntry[]>({
      base: () => baseRef.current,
      generation: () => generation.current,
      send: (hash, edits) => api.editScene(path, hash, edits),
      isConflict: (e) => e instanceof SceneConflict,
      onSaved: (b, edits, hash) => {
        const source = applyEdits(b.source, edits);
        setBase({ source, hash, els: scanElements(source) });
      },
      // The conflict opens when the latest version has loaded (now, or after Reload if this read fails),
      // so the lost changes are never dropped silently.
      onConflict: async (edits, b) => {
        // A reload that failed earlier left a pending conflict on this same version: add to it.
        if (pendingConflict.current) pendingConflict.current.edits.push(...edits);
        else pendingConflict.current = { edits, prev: b };
        await load();
      },
      // Queued behind the change that hit the conflict: their ids are from the same old version,
      // so they join it on the conflict screen and go through Apply my change again with it.
      onStale: (edits) => {
        if (mode.now().kind === "conflict") mode.dispatch({ t: "conflict:edits", edits });
        else if (pendingConflict.current) pendingConflict.current.edits.push(...edits);
        else toast("The scene reloaded, so your last change didn't save");
      },
      onError: async (e) => {
        toast(`Couldn't save: ${(e as Error).message}`);
        o.current.onSaveFailed();
        await load();
      },
    });
  }
  const saver = saverRef.current;

  /** Every queued save has finished, and none of them hit a conflict (that screen is up instead). */
  const settle = async () => {
    if (mode.dispatch({ t: "leave" }).kind !== "leaving") return false;
    try {
      await saver.idle();
    } finally {
      mode.dispatch({ t: "end", kind: "leaving" });
    }
    return mode.now().kind !== "conflict" && !pendingConflict.current;
  };

  // ------------------------------------------------------------ a change made elsewhere
  // The server says when the file changes (versions[path]). When the editor is free (no save on its
  // way, nothing being typed, dragged, nudged or chosen) it reads the file again, and shows it if it
  // isn't the version it already has. Otherwise it waits: the person's change is never thrown away
  // for someone else's, and when it saves against the old version the conflict screen takes over.
  const version = useLive().versions[path] ?? 0;
  const seen = useRef(version);
  const free = () => canReloadIn(mode.now()) && o.current.quiet();
  const refreshRef = useRef(async () => {});
  const alive = useRef(true);
  refreshRef.current = async () => {
    clearTimeout(outsideTimer.current);
    if (!alive.current || !outside.current || !baseRef.current) return;
    const later = () => (outsideTimer.current = setTimeout(() => void refreshRef.current(), OUTSIDE_RETRY_MS));
    if (!free()) return void later();
    // The editor's own saves land first: their new versions aren't someone else's change.
    await saver.idle();
    if (!alive.current) return;
    if (!free()) return void later();
    outside.current = false;
    await load({ stillFree: free });
  };
  useEffect(() => {
    if (version === seen.current) return;
    seen.current = version;
    outside.current = true;
    void refreshRef.current();
  }, [version]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(outsideTimer.current);
    };
  }, []);

  return {
    base,
    baseRef,
    /** Replace the base without reloading (a rename that kept every element). */
    setBase,
    loadError,
    stuck,
    setStuck,
    generation,
    layout,
    pendingConflict,
    load,
    saver,
    settle,
  };
}
