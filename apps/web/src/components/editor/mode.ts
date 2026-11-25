// What the scene editor is doing right now: one value, so every pointer, key and button asks the
// same question. Before, each mode was its own flag, and each handler checked a different subset of
// them (Undo worked while typing; an arrow key nudged a box mid-drag).
//
// A mode starts only from idle. It ends with an `end` naming it, which does nothing once something
// else has taken over (a conflict that opened during a save, say). A new version of the file ends
// whatever was working on the old one's element ids, except the steps that check for that themselves
// (an add or delete saving, a picture being chosen; see usePictureDrop).
import { changedElements } from "@viewswitcher/shared";
import type { SceneBase, SceneEdit } from "@viewswitcher/shared";

export type Guides = { x: number[]; y: number[] };
/** The version an element id came from (`layout` bumps whenever ids change): ids from another one may name a different element. */
export type Made = { layout: number; base: SceneBase };
export type Conflict = { edits: SceneEdit[]; changed: number[]; prev: SceneBase; latest: SceneBase };
/** A picture dropped on an image: Replace it, or Add it as a new one. `x`/`y` are where the menu goes. */
export type DropChoice = { file: File; at: { x: number; y: number }; image: number; x: number; y: number; made: Made };

export type Mode =
  | { kind: "idle" }
  | { kind: "typing"; id: number; original: string; gen: number }
  | { kind: "dragging"; id: number; left: number; top: number; guides: Guides }
  | { kind: "resizing"; id: number; width: number; height: number }
  /** An add, delete or rename is saving: element ids change when it lands, so nothing may start on the old ones. */
  | { kind: "saving-structure" }
  /** Choosing a picture from the org's assets: for a new image, or to replace image `replace`. */
  | { kind: "picking"; replace: number | null; made: Made }
  | ({ kind: "dropChoice" } & DropChoice)
  | ({ kind: "conflict" } & Conflict)
  /** Waiting for every save to land before going (Done, Back, Edit a copy, rename). */
  | { kind: "leaving" };
export type ModeKind = Mode["kind"];

export type ModeEvent =
  | { t: "type"; id: number; original: string; gen: number }
  | { t: "drag"; id: number; left: number; top: number; guides: Guides }
  | { t: "resize"; id: number; width: number; height: number }
  | { t: "structure" }
  /** A rename, once the saves before it have landed: from leaving straight to saving, never through idle. */
  | { t: "rename" }
  | { t: "pick"; replace: number | null; made: Made }
  | { t: "dropChoice"; choice: DropChoice }
  | { t: "leave" }
  /** That mode is over. Ignored if the editor is in another one by now. */
  | { t: "end"; kind: ModeKind }
  /** A save hit a newer version: whatever was happening, this is what the editor shows now. */
  | { t: "conflict"; conflict: Conflict }
  /** Saves queued behind the one that conflicted: they join it. */
  | { t: "conflict:edits"; edits: SceneEdit[] }
  /** A new version of the file is loaded. */
  | { t: "reloaded"; base: SceneBase };

export const IDLE: Mode = { kind: "idle" };

export function reduce(mode: Mode, e: ModeEvent): Mode {
  switch (e.t) {
    case "type":
      return mode.kind === "idle" ? { kind: "typing", id: e.id, original: e.original, gen: e.gen } : mode;
    case "drag":
      // The first move starts the drag; every later one updates where it is.
      return mode.kind === "idle" || (mode.kind === "dragging" && mode.id === e.id) ? { kind: "dragging", id: e.id, left: e.left, top: e.top, guides: e.guides } : mode;
    case "resize":
      return mode.kind === "idle" || (mode.kind === "resizing" && mode.id === e.id) ? { kind: "resizing", id: e.id, width: e.width, height: e.height } : mode;
    case "structure":
      return mode.kind === "idle" ? { kind: "saving-structure" } : mode;
    case "rename":
      return mode.kind === "leaving" ? { kind: "saving-structure" } : mode;
    case "pick":
      return mode.kind === "idle" ? { kind: "picking", replace: e.replace, made: e.made } : mode;
    case "dropChoice":
      return mode.kind === "idle" ? { kind: "dropChoice", ...e.choice } : mode;
    case "leave":
      // Done or Back over a drop's Replace / Add choice: that choice is dropped.
      return mode.kind === "idle" || mode.kind === "dropChoice" ? { kind: "leaving" } : mode;
    case "end":
      return mode.kind === e.kind ? IDLE : mode;
    case "conflict":
      return { kind: "conflict", ...e.conflict };
    case "conflict:edits":
      return mode.kind === "conflict" ? { ...mode, edits: [...mode.edits, ...e.edits] } : mode;
    case "reloaded":
      switch (mode.kind) {
        case "typing":
        case "dragging":
        case "resizing":
          return IDLE;
        // An open conflict follows the newest version: its marks and Apply my change again use it.
        case "conflict":
          return { ...mode, latest: e.base, changed: changedElements(mode.prev.source, e.base.source) };
        default:
          return mode;
      }
  }
}

/** Something new may start: a press, a key, a drop, Add, Undo. */
export const canStart = (m: Mode) => m.kind === "idle";
/** Undo only acts on a quiet scene: never while typing, dragging, saving an add or delete, or with a conflict up. */
export const canUndo = canStart;
/** An add or delete is saving (ids change when it lands), or the editor is leaving: something holding an id waits it out. */
export const idsUnsettled = (m: Mode) => m.kind === "saving-structure" || m.kind === "leaving";
/** A change made elsewhere may be loaded now without losing anything the person is doing. */
export const canReloadIn = (m: Mode) => m.kind === "idle" || m.kind === "conflict";

/**
 * The mode as the editor holds it: `now()` for handlers that run between renders (a save landing, a
 * timer), each event applied at once so the next guard already sees it, and `until()` for a step
 * that has to wait for the mode (a picture waiting out an add or delete). `changed` hears every new mode.
 */
export function createModeStore(changed: (m: Mode) => void = () => {}) {
  let mode = IDLE;
  const waiting = new Set<{ pred: (m: Mode) => boolean; resolve: (m: Mode) => void }>();
  return {
    now: () => mode,
    dispatch: (e: ModeEvent): Mode => {
      const next = reduce(mode, e);
      if (next === mode) return mode;
      mode = next;
      changed(next);
      for (const w of waiting) if (w.pred(next)) (waiting.delete(w), w.resolve(next));
      return next;
    },
    /** Resolves with the mode once `pred` holds: now, or after a later event. */
    until: (pred: (m: Mode) => boolean): Promise<Mode> => (pred(mode) ? Promise.resolve(mode) : new Promise((resolve) => void waiting.add({ pred, resolve }))),
  };
}
