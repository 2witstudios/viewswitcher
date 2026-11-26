// The conflict card's two answers. Apply my change again places each lost change in the newest
// version (the ones that can't be placed are said so); Keep the new version drops them and puts the
// stream back to what the file has.
import { editKind, freeSlotName, isStructural, retarget, slotsIn, valueIn } from "@viewswitcher/shared";
import type { InsertEdit, RemoveEdit, SceneBase, SceneEdit } from "@viewswitcher/shared";
import { useRef } from "react";
import { toast } from "../ui";
import type { ModeStore } from "./useMode";

export function useConflictActions(opts: {
  mode: ModeStore;
  current: () => SceneBase | null;
  /** Change an element now: on screen, live, saved, undoable against `before`. */
  change: (edit: SceneEdit, before: SceneEdit | null) => void;
  liveEdit: (edit: SceneEdit, gen?: number) => void;
  structural: (edit: InsertEdit | RemoveEdit) => Promise<unknown>;
}) {
  const o = useRef(opts);
  o.current = opts;

  const applyAgain = async () => {
    const k = o.current;
    const c = k.mode.now();
    if (c.kind !== "conflict") return;
    const { edits, prev } = c;
    const latest = k.current() ?? c.latest; // the newest version, if it moved on again
    const pairs = edits.map((e) => ({ e, m: retarget(prev.source, latest.source, e) }));
    k.mode.dispatch({ t: "end", kind: "conflict" });
    // The ones that can be placed go through; the others are said so. (Their earlier live previews
    // were on the old version, which the stream already replaced.)
    const lost = pairs.filter((p) => p.m === null).length;
    if (lost) toast(lost === pairs.length ? "That part of the view isn't in the new version, so your change can't go there" : "Some of your changes can't go anywhere in the new version, so only the others were saved");
    // Several lost changes of one kind to one element (a drag, then a nudge) become its last one.
    // Each goes as its own save: a move and a resize of one box both change its left.
    const last = new Map<string, SceneEdit>();
    for (const { m } of pairs) if (m && !isStructural(m)) last.set(`${m.id}:${editKind(m)}`, m);
    for (const e of last.values()) k.change(e, valueIn(latest, e));
    // Adding and deleting go through the same path as the first time (saved, then the frame follows),
    // one at a time, each placed in the version as it is by then.
    for (const { e, m } of pairs) {
      if (!m || !isStructural(m)) continue;
      const now = o.current.current();
      let again = now ? retarget(prev.source, now.source, e) : null;
      // A box's slot name was picked against the old version: pick again if the new one already uses it.
      if (now && again && "insert" in again) {
        const taken = slotsIn(now);
        const slot = /data-slot="([^"]*)"/.exec(again.insert);
        const name = slot?.[1]?.replace(/ \d+$/, "");
        if (slot && name && taken.includes(slot[1]!)) again = { ...again, insert: again.insert.replace(slot[0], `data-slot="${freeSlotName(name, taken)}"`) };
      }
      if (again && isStructural(again)) await o.current.structural(again);
    }
  };

  const keepNew = () => {
    const k = o.current;
    const c = k.mode.now();
    if (c.kind !== "conflict") return;
    // The stream may still show the live edit of the change that didn't save: put the latest back.
    for (const e of c.edits) {
      const m = retarget(c.prev.source, c.latest.source, e);
      const v = m && valueIn(c.latest, m);
      if (v) k.liveEdit(v);
    }
    k.mode.dispatch({ t: "end", kind: "conflict" });
  };

  return { applyAgain, keepNew };
}
