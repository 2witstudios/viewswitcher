// Live changes on stream while the scene is on air: typing, dragging and nudging show as they happen
// (about one preview per frame), an unsaved one is resent as a heartbeat so the program page knows
// the editor is still here, and leaving mid-change puts the on-air scene back the way the file has it.
import { editKind, isStructural } from "@viewswitcher/shared";
import type { SceneBase, SceneEdit } from "@viewswitcher/shared";
import { useEffect, useRef } from "react";
import { api } from "../../lib/api";

const PREVIEW_MS = 33;
const HEARTBEAT_MS = 2000;

type Change = { edit: SceneEdit; gen: number };

export function useLivePreview(opts: {
  path: string;
  onAir: () => boolean;
  base: () => SceneBase | null;
  generation: () => number;
  /** The change under way (typing, a drag or resize, a nudge not saved yet) as the value that puts it back; null when there's none. */
  unfinished: () => Change | null;
  /** Runs as the editor goes, before anything unfinished is put back: a pending nudge saves first, so the stream doesn't snap back before it lands. */
  beforeLeave: () => void;
}) {
  const o = useRef(opts);
  o.current = opts;
  const pending = useRef(new Map<string, Change>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The latest live change not saved yet; resent as a heartbeat. */
  const unsaved = useRef<Change | null>(null);

  /**
   * Show a change live on stream. `gen` is the generation its id came from (when the drag, typing or
   * nudge started). After a reload the ids may name other elements, so an older one is never sent:
   * the hash it would carry is the new version's, which the program page would accept.
   */
  const preview = (edit: SceneEdit, gen = o.current.generation()) => {
    if (gen !== o.current.generation()) return;
    unsaved.current = { edit, gen };
    if (!o.current.onAir()) return;
    if (isStructural(edit)) return; // reaches the stream as the saved file
    const kind = editKind(edit);
    pending.current.set(`${edit.id}:${kind === "text" ? "t" : kind === "src" ? "s" : "p"}`, { edit, gen });
    if (timer.current) return;
    const flush = () => {
      const items = [...pending.current.values()].filter((p) => p.gen === o.current.generation());
      pending.current.clear();
      if (!items.length) {
        timer.current = undefined;
        return;
      }
      const hash = o.current.base()?.hash ?? "";
      for (const p of items) api.previewScene(o.current.path, hash, p.edit).catch(() => {});
      timer.current = setTimeout(flush, PREVIEW_MS);
    };
    flush();
  };
  /** The change was saved: the saved file carries it, so there's nothing to keep alive. */
  const saved = () => {
    unsaved.current = null;
  };

  useEffect(() => {
    const { path } = o.current;
    // A beacon survives pagehide (closing the tab, the iPad losing its cable).
    const revert = () => {
      const b = o.current.base();
      const back = o.current.unfinished();
      // A change from before a reload was never shown on this version, so there's nothing to put back.
      if (o.current.onAir() && b && back && back.gen === o.current.generation()) api.previewSceneBeacon(path, b.hash, back.edit);
    };
    window.addEventListener("pagehide", revert);
    // The program page drops a live change that goes quiet.
    const beat = setInterval(() => {
      const u = unsaved.current;
      const b = o.current.base();
      if (u && b && u.gen === o.current.generation() && o.current.onAir() && o.current.unfinished()) api.previewScene(path, b.hash, u.edit).catch(() => {});
    }, HEARTBEAT_MS);
    return () => {
      window.removeEventListener("pagehide", revert);
      clearInterval(beat);
      clearTimeout(timer.current);
      o.current.beforeLeave();
      revert();
    };
  }, [opts.path]);

  return { preview, saved };
}
