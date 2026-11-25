// Renaming the scene from the editor's title: everything made so far is saved first, then the file's
// <title> (and a stream scene's file name) changes. A newer version meanwhile means no rename.
import { scanElements, setTitle, titleIn } from "@viewswitcher/shared";
import type { SceneBase } from "@viewswitcher/shared";
import { useRef, useState } from "react";
import { api, SceneConflict } from "../../lib/api";
import { attempt, toast } from "../ui";
import type { ModeStore } from "./useMode";

export function useRename(opts: {
  path: string;
  /** Open with the name ready to retype (a fresh copy). */
  initially: boolean;
  mode: ModeStore;
  base: SceneBase | null;
  current: () => SceneBase | null;
  /** The library's name for the scene, until the file is read. */
  fallback: string;
  onAir: () => boolean;
  /** Finish typing and nudges, then wait for every save, then run `then`; false if a conflict came up. */
  settle: (then?: () => void) => Promise<boolean>;
  setBase: (b: SceneBase) => void;
  load: () => Promise<unknown>;
  /** The file moved (a stream scene's name is its file name): edit it there. */
  moved: (path: string) => void;
}) {
  const o = useRef(opts);
  o.current = opts;
  const [naming, setNaming] = useState(opts.initially);
  /** The new name until the library catches up. */
  const [named, setNamed] = useState<string | null>(null);
  // The file's own <title> first: right after a duplicate, the library hasn't caught up with the copy yet.
  const title = named ?? (opts.base && titleIn(opts.base)) ?? opts.fallback;

  const rename = (name: string) =>
    attempt(async () => {
      const { mode, path } = o.current;
      setNaming(false);
      const clean = name.trim();
      if (!clean || clean === title) return;
      // The rename is saved straight after the saves before it, with nothing in between.
      if (!(await o.current.settle(() => mode.dispatch({ t: "structure" })))) return;
      const b = o.current.current();
      if (mode.now().kind !== "saving-structure") return;
      try {
        if (!b) return;
        const r = await api.renameScene(path, b.hash, clean);
        setNamed(clean);
        if (r.path !== path) {
          toast(o.current.onAir() ? `Renamed: ${clean}. It's still on air.` : `Renamed: ${clean}`);
          o.current.moved(r.path);
          return;
        }
        // Same file, new <title>: with one already there, every element keeps its id (and Undo still works).
        const source = setTitle(b.source, clean);
        const els = scanElements(source);
        if (els.length === b.els.length) o.current.setBase({ source, hash: r.hash, els });
        else await o.current.load();
        toast(`Renamed: ${clean}`);
      } catch (e) {
        if (!(e instanceof SceneConflict)) throw e;
        toast("The scene changed meanwhile, so it wasn't renamed. Try again.");
        await o.current.load();
      } finally {
        mode.dispatch({ t: "end", kind: "saving-structure" });
      }
    });

  return {
    naming,
    title,
    startNaming: () => setNaming(true),
    /** The title field closed: `null` is a cancel. */
    done: (v: string | null) => (v === null ? setNaming(false) : void rename(v)),
  };
}
