// Adding and deleting elements. Unlike other changes, element ids after the change move, so it's
// saved first (after every change before it), and only then does the scene on screen follow: the
// frame's DOM gets the same change and its data-vs ids renumbered to match the saved file (checked,
// and the frame loaded again if they don't). The stream gets the saved file, which swaps in without
// a transition. Undo entries below it were made in the ids from before it, and are only reached once
// Undo has taken it back out, so they stay right.
import { canRemove, DEVICE_SLOTS, freeSlotName, idsAfter, markupFor, movableIn, posIn, restoreFor, sceneRoot, slotsIn } from "@viewswitcher/shared";
import type { AddKind, InsertEdit, RemoveEdit, SceneBase, SceneEdit } from "@viewswitcher/shared";
import { type RefObject, useRef } from "react";
import { openAgentSheet } from "../AgentSheet";
import { toast } from "../ui";
import { applyStructure, type IdBaseline, idsMatch } from "./frame-dom";
import type { Pos } from "./geometry";
import type { ModeStore } from "./useMode";
import type { UndoEntry } from "./useUndo";

export function useAddDelete(opts: {
  mode: ModeStore;
  current: () => SceneBase | null;
  generation: () => number;
  /** Element ids changed: bump the layout counter. */
  idsChanged: () => void;
  /** A 409 is waiting for the newest version to load. */
  conflictPending: () => boolean;
  waitForSaves: () => Promise<void>;
  save: (edits: SceneEdit[], undo: UndoEntry[], madeIn: number) => Promise<void>;
  pushUndo: (entries: UndoEntry[]) => void;
  /** The frame's document while it shows the base, else null. */
  shownFrame: () => Document | null;
  ids0: RefObject<IdBaseline | null>;
  reloadFrame: () => void;
  finishTyping: () => void;
  flushNudge: () => void;
  origins: RefObject<Map<number, Pos>>;
  /** After the change: what's selected now (the added element, or a deleted one's neighbour's new id). */
  select: (next: (sel: number | null) => number | null) => void;
  /** Menus and hover from before name old ids. */
  clearPointers: () => void;
  redraw: () => void;
  onAir: () => boolean;
}) {
  const o = useRef(opts);
  o.current = opts;

  /** Resolves to the inserted element's id (null for a delete) once saved and shown; to false if it didn't happen. */
  const structural = async (edit: InsertEdit | RemoveEdit, record = true): Promise<{ added: number | null } | false> => {
    const k = o.current;
    if (k.mode.now().kind === "typing") k.finishTyping();
    if (k.mode.dispatch({ t: "structure" }).kind !== "saving-structure") return false;
    try {
      k.flushNudge();
      // The edit's ids are from now: if waiting reloads the scene (a failed save before it), they may name something else.
      const madeIn = k.generation();
      await k.waitForSaves();
      if (k.generation() !== madeIn) return false;
      const b = k.current();
      if (!b || k.mode.now().kind !== "saving-structure" || k.conflictPending()) return false;
      let ids: ReturnType<typeof idsAfter>, undoIt: SceneEdit;
      try {
        ids = idsAfter(b.source, edit);
        undoIt = "insert" in edit ? { id: ids.added!, remove: true } : restoreFor(b.source, edit.id);
      } catch (e) {
        toast((e as Error).message);
        return false;
      }
      const gen = k.generation();
      await k.save([edit], [], gen);
      // Not saved (a conflict or an error reloaded the scene): nothing to show.
      const saved = k.current();
      if (k.generation() !== gen || !saved || saved === b) return false;
      k.idsChanged();
      // The frame follows the saved file. If it's loading again meanwhile, it loads the saved file anyway.
      const d = k.shownFrame();
      if (d) {
        applyStructure(d, edit, ids);
        if (!k.ids0.current || !idsMatch(d, saved, k.ids0.current)) k.reloadFrame();
      } else k.reloadFrame();
      // Everything that names an element by id moves to the new ids.
      const moved = new Map<number, Pos>();
      k.origins.current.forEach((pos, id) => {
        const m = ids.map(id);
        if (m !== null) moved.set(m, pos);
      });
      k.origins.current = moved;
      if (record) k.pushUndo([{ before: undoIt, after: edit }]);
      k.clearPointers();
      if (ids.added !== null) {
        const p = posIn(saved, ids.added);
        if (p) moved.set(ids.added, p);
        const added = movableIn(saved, ids.added) ? ids.added : null;
        k.select(() => added);
      } else k.select((sel) => (sel === null ? null : ids.map(sel)));
      k.redraw();
      return { added: ids.added };
    } finally {
      k.mode.dispatch({ t: "end", kind: "saving-structure" });
    }
  };

  const add = (kind: AddKind, image?: { src: string; width: number; height: number }, at?: { x: number; y: number }) => {
    const b = o.current.current();
    if (!b) return;
    const root = sceneRoot(b.source);
    if (root === null) return toast("This scene can't take new items", { label: "Edit with AI", run: openAgentSheet });
    const slots = slotsIn(b);
    const slot = DEVICE_SLOTS[kind] ? freeSlotName(DEVICE_SLOTS[kind]!, slots) : null;
    void structural({ id: root, insert: markupFor(kind, { slots, image, at }) }).then((done) => {
      if (done && slot && o.current.onAir()) toast(`On air · OBS source "${slot}"`);
      else if (done && slot && slot !== DEVICE_SLOTS[kind]) toast(`OBS source "${slot}"`);
    });
  };

  const remove = (id: number) => {
    const b = o.current.current();
    if (!b) return;
    if (!canRemove(b.source, id)) return toast("Can't delete this here", { label: "Edit with AI", run: openAgentSheet });
    o.current.clearPointers();
    void structural({ id, remove: true }).then((done) => done && toast("Deleted. Undo puts it back."));
  };

  return { structural, add, remove };
}
