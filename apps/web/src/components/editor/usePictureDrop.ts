// A picture file dropped on the scene goes into the org's assets and lands where it was dropped, as
// one new image (a source patch like Add → Image, live and undoable). Dropped on an image the scene
// has, it asks: Replace this image, or Add as a new image. Choosing one from the asset picker works
// the same way.
//
// An upload takes a while, and the scene can change meanwhile (an add, a delete, a newer version).
// The image a picture replaces is the one it was dropped on: its id is checked against the version
// it came from, followed into the scene as it is now, and refused when it can't be found there.
import { replaceableImage, retarget, valueIn } from "@viewswitcher/shared";
import type { SceneBase, SceneEdit, SrcEdit } from "@viewswitcher/shared";
import { type DragEvent as ReactDragEvent, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { libraryUrl } from "../../lib/live";
import { toast } from "../ui";
import { canStart, idsUnsettled, type Made } from "./mode";
import type { ModeStore } from "./useMode";

/** Pictures the editor takes from a drop. */
const isPicture = (f: File) => /^image\/(png|jpe?g|gif|webp|avif|svg\+xml)$/.test(f.type) || /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(f.name);
const hasFiles = (e: { dataTransfer: DataTransfer | null }) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
/** A picture's own size, read locally before it's uploaded (0×0 when it can't be read, e.g. an SVG without one). */
const naturalSize = (src: string) =>
  new Promise<{ width: number; height: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = src;
  });
const fileSize = async (f: File) => {
  const url = URL.createObjectURL(f);
  try {
    return await naturalSize(url);
  } finally {
    URL.revokeObjectURL(url);
  }
};
const srcFor = (path: string) => libraryUrl(path).replace(/'/g, "%27");

export type Point = { x: number; y: number };
/** Where a picture being dragged over would land, and the image it would replace. */
export type DropAt = Point & { image: number | null };

/**
 * Image `id` of version `made`, in the scene as it is now: the same id while no element ids have
 * changed, else the one element that is the same image, else null.
 */
export function imageNow(made: Made, now: { base: SceneBase | null; layout: number }, id: number, src: string): SrcEdit | null {
  const b = now.base;
  if (!b) return null;
  const edit = made.layout === now.layout ? { id, src } : retarget(made.base.source, b.source, { id, src });
  return edit && "src" in edit && replaceableImage(b, edit.id) ? edit : null;
}

/**
 * Where a replacing picture goes once it has uploaded. It waits while an add or delete is saving,
 * because ids change when that lands and the id it holds would name another image. Then it follows
 * image `id` of version `made` into the scene as it is. Null when it can't: the image is gone or has
 * a twin, or a conflict came up.
 */
export async function replaceTarget(
  env: { mode: Pick<ModeStore, "until">; base: () => SceneBase | null; layout: () => number },
  made: Made,
  id: number,
  src: string,
): Promise<SrcEdit | null> {
  const m = await env.mode.until((m) => !idsUnsettled(m));
  if (m.kind === "conflict") return null;
  return imageNow(made, { base: env.base(), layout: env.layout() }, id, src);
}

export function usePictureDrop(opts: {
  org: string;
  mode: ModeStore;
  base: () => SceneBase | null;
  /** Bumped whenever element ids change. */
  layout: () => number;
  ready: boolean;
  /** The replaceable image at scene point `p`, or null. */
  replaceableAt: (p: Point) => number | null;
  toScene: (e: { clientX: number; clientY: number }) => Point;
  /** Where the drop menu goes, relative to the stage. */
  menuAt: (e: { clientX: number; clientY: number }) => Point;
  /** Replace a picture now: on screen, live, saved, undoable. */
  replace: (edit: SrcEdit, before: SceneEdit | null) => void;
  /** Add a new image (an add, saved first). */
  add: (image: { src: string; width: number; height: number }, at?: Point) => void;
  /** Typing is finished (saved) before a picture goes in, as an add does. */
  finishTyping: () => void;
  deselect: () => void;
}) {
  const o = useRef(opts);
  o.current = opts;
  const { mode } = opts;
  const [dropAt, setDropAt] = useState<DropAt | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);

  const made = (): Made | null => {
    const b = o.current.base();
    return b ? { base: b, layout: o.current.layout() } : null;
  };
  const canDrop = () => opts.ready && canStart(mode.now()) && !uploadingRef.current;

  /** Put `src` in place of image `id` of version `from`, if it's still there. */
  const replaceWith = async (from: Made, id: number, src: string) => {
    const k = o.current;
    const edit = await replaceTarget({ mode, base: k.base, layout: k.layout }, from, id, src);
    const b = o.current.base();
    if (!alive.current) return false;
    if (!edit || !b) {
      toast("The scene changed meanwhile, so the image wasn't replaced. Try again.");
      return false;
    }
    // Undo puts back what the file has (Replace is offered only when that's a library picture).
    o.current.replace(edit, valueIn(b, edit));
    return true;
  };

  /** Wait until nothing else is under way (a drag lets go, an add finishes saving); false if a conflict came up or the editor went. */
  const whenFree = async () => {
    o.current.finishTyping();
    const m = await mode.until((m) => canStart(m) || m.kind === "conflict");
    return m.kind !== "conflict" && alive.current;
  };

  /** The picture going in now, if any: leaving waits for it, so Done never drops a picture on the floor. */
  const inFlight = useRef<Promise<void> | null>(null);
  const track = (work: Promise<void>) => {
    const p = work.finally(() => {
      if (inFlight.current === p) inFlight.current = null;
    });
    inFlight.current = p;
    return p;
  };
  const place = (file: File, at: Point, image: { id: number; made: Made } | null) => track(placeNow(file, at, image));
  const placeNow = async (file: File, at: Point, image: { id: number; made: Made } | null) => {
    uploadingRef.current = true;
    setUploading(true);
    try {
      const [{ saved }, size] = await Promise.all([api.upload(o.current.org, [file]), fileSize(file)]);
      if (!saved[0]) throw new Error("The picture didn't upload");
      const src = srcFor(saved[0].path);
      if (image) {
        if (await replaceWith(image.made, image.id, src)) toast("Replaced");
        return;
      }
      if (!(await whenFree())) {
        if (alive.current) toast("The scene changed meanwhile, so the picture wasn't added. Try again.");
        return;
      }
      o.current.add({ src, width: size.width || 1, height: size.height || 1 }, at);
    } catch (e) {
      toast(`Couldn't add the picture: ${(e as Error).message}`);
    } finally {
      uploadingRef.current = false;
      if (alive.current) setUploading(false);
    }
  };

  const onDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = canDrop() ? "copy" : "none";
    if (!canDrop()) return;
    const p = o.current.toScene(e);
    setDropAt((d) => (d && Math.abs(d.x - p.x) < 4 && Math.abs(d.y - p.y) < 4 ? d : { ...p, image: o.current.replaceableAt(p) }));
  };
  const onDragLeave = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null);
  };
  const onDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDropAt(null);
    if (!canDrop()) return;
    const files = Array.from(e.dataTransfer.files);
    const pictures = files.filter(isPicture);
    if (!pictures.length) return toast(files.some((f) => /\.zip$/i.test(f.name)) ? "That's a template pack: drop it on the Templates page to install it" : "Drop a picture: PNG, JPG, GIF, WebP, AVIF or SVG");
    if (pictures.length > 1) toast("One picture at a time: added the first");
    const at = o.current.toScene(e);
    const image = o.current.replaceableAt(at);
    const m = made();
    if (image !== null && m) {
      const menu = o.current.menuAt(e);
      mode.dispatch({ t: "dropChoice", choice: { file: pictures[0]!, at, image, x: menu.x, y: menu.y, made: m } });
      o.current.deselect();
      return;
    }
    void place(pictures[0]!, at, null);
  };

  /** The answer to Replace this image / Add as a new image / Cancel. */
  const choose = (choice: "replace" | "add" | null) => {
    const c = mode.now();
    if (c.kind !== "dropChoice") return;
    mode.dispatch({ t: "end", kind: "dropChoice" });
    if (choice === null) return;
    void place(c.file, c.at, choice === "replace" ? { id: c.image, made: c.made } : null);
  };

  /** Open the asset picker: for a new image, or to replace image `replace`. */
  const openPicker = (replace: number | null) => {
    const m = made();
    if (m) mode.dispatch({ t: "pick", replace, made: m });
  };
  /** A picture chosen (or uploaded) in the picker. */
  const picked = (asset: { path: string }) => {
    const c = mode.now();
    // The picker was closed by something else (a conflict came up): this choice is for a scene that's gone.
    if (c.kind !== "picking") return;
    mode.dispatch({ t: "end", kind: "picking" });
    const src = srcFor(asset.path);
    if (c.replace !== null) {
      void replaceWith(c.made, c.replace, src);
      return;
    }
    // Its natural size keeps its shape.
    void track(naturalSize(src).then(async ({ width, height }) => {
      if (await whenFree()) o.current.add({ src, width: width || 1, height: height || 1 });
    }));
  };

  // A picture dropped just outside the scene would make the browser open the file instead of the
  // editor: the editor page takes every file drop, and only the scene uses them.
  useEffect(() => {
    const stop = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  return { dropAt, uploading, isUploading: () => uploadingRef.current, settled: () => inFlight.current ?? Promise.resolve(), onDragOver, onDragLeave, onDrop, choose, openPicker, picked };
}
