// The scene editor: retype text in place, drag and resize panels and camera boxes, add and delete
// things and swap images, live on stream when the scene is on air. Every finished change (Return,
// letting go, choosing from Add) is saved as a source-range patch on the server; the browser DOM is
// never written back. See packages/shared/src/html-scan.ts.
import {
  applyEdits, canRemove, changedElements, collapseHtmlSpace, decodeEntities, DEVICE_SLOTS, freeSlotName, isLibraryUrl, editKind, idsAfter, isStructural, markupFor, positionOf, restoreFor, retarget,
  scanElements, sceneRoot, setTitle, shortDate, sizeOf, snapMove, textOf, untagForEdit,
} from "@viewswitcher/shared";
import type { AddKind, Box, InsertEdit, Library, RemoveEdit, ScannedElement, SceneEdit } from "@viewswitcher/shared";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, SceneConflict } from "../lib/api";
import { useLibrary } from "../lib/library";
import { inApp, libraryUrl, useLive } from "../lib/live";
import { EDITOR_SANDBOX } from "../lib/scene-frame";
import { createSceneSaver } from "../lib/scene-saver";
import { attempt, toast } from "./ui";

const W = 1920;
const H = 1080;
const LONG_PRESS_MS = 550;
const DOUBLE_TAP_MS = 350;
const DRAG_START_PX = 6; // screen px before a press becomes a drag
const SNAP_PX = 7; // screen px
const PREVIEW_MS = 33; // live previews: about one per frame
const NUDGE_SAVE_MS = 500;
const HEARTBEAT_MS = 2000; // resend an unsaved live change, so the program page knows the editor is still here

type Base = { source: string; hash: string; els: ScannedElement[] };
type UndoEntry = { before: SceneEdit; after: SceneEdit };
type Hit = { leaf: number | null; move: number | null; image: number | null };
type Pos = { left: number; top: number };
type Size = { width: number; height: number };
type Corner = "nw" | "ne" | "sw" | "se";
const MIN_SIZE = 24;

/** The version the frame shows: stamped on <html>, or on a bare fragment's first element. */
const shownVersion = (d: Document) => d.documentElement.dataset.vsHash ?? d.querySelector<HTMLElement>("[data-vs-hash]")?.dataset.vsHash;
/** Pictures the editor takes from a drop (EDIT-22). */
const isPicture = (f: File) => /^image\/(png|jpe?g|gif|webp|avif|svg\+xml)$/.test(f.type) || /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(f.name);
/** A picture's own size, read locally before it's uploaded (0×0 when it can't be read, e.g. an SVG without one). */
const naturalSize = (f: File) =>
  new Promise<{ width: number; height: number }>((resolve) => {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => (URL.revokeObjectURL(url), resolve({ width: img.naturalWidth, height: img.naturalHeight }));
    img.onerror = () => (URL.revokeObjectURL(url), resolve({ width: 0, height: 0 }));
    img.src = url;
  });

const toBase = ({ html, hash }: { html: string; hash: string }): Base => {
  const source = untagForEdit(html);
  return { source, hash, els: scanElements(source) };
};
const posIn = (b: Base, id: number) => (b.els[id] ? positionOf(b.source, b.els[id]!) : null);
const movableIn = (b: Base, id: number) => !["html", "head", "body"].includes(b.els[id]?.tag ?? "html") && posIn(b, id) !== null;
const sizeIn = (b: Base, id: number) => (b.els[id] ? sizeOf(b.source, b.els[id]!) : null);
const attrIn = (b: Base, id: number, name: string) => {
  const a = b.els[id]?.attrs.find((x) => x.name === name);
  return a && a.valueStart >= 0 ? b.source.slice(a.valueStart, a.valueEnd) : null;
};
/** Camera, screen and guest boxes: the OBS sources go in them. */
const isSlot = (b: Base, id: number) => attrIn(b, id, "data-slot") !== null;
/** The scene's own <title>, as the browser shows it. */
const titleIn = (b: Base) => {
  const t = b.els.find((e) => e.tag === "title" && e.closed);
  return t ? collapseHtmlSpace(decodeEntities(b.source.slice(t.innerStart, t.innerEnd))) || null : null;
};
const slotsIn = (b: Base) => b.els.flatMap((e) => attrIn(b, e.id, "data-slot") ?? []);
/** The value an edit would put back: the element's text or position in `b`. */
function valueIn(b: Base, edit: SceneEdit): SceneEdit | null {
  const el = b.els[edit.id];
  if (!el) return null;
  if ("text" in edit) return el.leaf ? { id: edit.id, text: textOf(b.source, el) } : null;
  if ("src" in edit) {
    const src = attrIn(b, edit.id, "src");
    return el.tag === "img" && src !== null ? { id: edit.id, src } : null;
  }
  if (isStructural(edit)) return null;
  const p = posIn(b, edit.id);
  if ("width" in edit) {
    const z = sizeIn(b, edit.id);
    return z && (p || (edit.left === undefined && edit.top === undefined)) ? { id: edit.id, width: z.width, height: z.height, ...(p && edit.left !== undefined ? { left: p.left } : {}), ...(p && edit.top !== undefined ? { top: p.top } : {}) } : null;
  }
  return p ? { id: edit.id, left: p.left, top: p.top } : null;
}

/** A plain name for an element: "Camera box", "Footer", "Notes panel", "Footer title". */
function nameOf(b: Base, id: number): string {
  const el = b.els[id];
  if (!el) return "Element";
  const attr = (e: ScannedElement, n: string) => {
    const a = e.attrs.find((x) => x.name === n);
    return a && a.valueStart >= 0 ? b.source.slice(a.valueStart, a.valueEnd) : null;
  };
  const container = (e: ScannedElement): string => {
    const slot = attr(e, "data-slot");
    if (slot) return `${slot} box`;
    if (e.tag === "footer") return "Footer";
    if (e.tag === "header") return "Header";
    const label = b.els.find((c) => c.leaf && c.start > e.start && c.end <= e.end && textOf(b.source, c).length <= 24);
    return label ? `${textOf(b.source, label).replace(/^\w/, (c) => c.toUpperCase())} panel` : "Panel";
  };
  if (el.tag === "img") return "Image";
  if (!el.leaf) return container(el);
  const word = /^h[1-6]$/.test(el.tag) ? "title" : el.tag === "p" ? "text" : "label";
  let up = el.parent;
  while (up !== null && !movableIn(b, up)) up = b.els[up]?.parent ?? null;
  return up === null ? word.replace(/^\w/, (c) => c.toUpperCase()) : `${container(b.els[up]!)} ${word}`;
}

function describe(b: Base, edit: SceneEdit) {
  const what = nameOf(b, edit.id);
  switch (editKind(edit)) {
    case "text": return { what, value: (edit as { text: string }).text };
    case "insert": return { what: "Scene", value: "something you added" };
    case "remove": return { what, value: "deleted" };
    case "src": return { what, value: "a new picture" };
    case "size": {
      const e = edit as { width: number; height: number };
      return { what, value: `${e.width} × ${e.height}` };
    }
    default: {
      const e = edit as { left: number; top: number };
      return { what, value: `x ${e.left} · y ${e.top}` };
    }
  }
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    window.prompt("Copy this text:", text);
  }
}

/** Where a scene lives, for the crumb: "Bible Study · Day 1 · Nov 24". */
function placeOf(lib: Library | undefined, path: string) {
  if (!lib) return { crumb: "", title: path.split("/").pop()?.replace(/\.html$/, "") ?? "" };
  const t = lib.templates.find((s) => s.path === path);
  if (t) return { crumb: `${lib.org.name} · Templates`, title: t.label };
  for (const p of lib.projects) {
    const s = p.scenes.find((x) => x.path === path);
    if (s) return { crumb: `${lib.org.name} · ${p.name}`, title: s.label };
    for (const st of p.streams) {
      const x = st.scenes.find((y) => y.path === path);
      if (x) return { crumb: `${lib.org.name} · ${p.name} · ${st.date ? shortDate(st.date) : st.name}`, title: x.label };
    }
  }
  return { crumb: lib.org.name, title: path.split("/").pop()?.replace(/\.html$/, "") ?? "" };
}

const Icon = {
  back: <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>,
  undo: <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 010 11H11" /></svg>,
  code: <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6l-6 6 6 6" /><path d="M16 6l6 6-6 6" /></svg>,
  pen: <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13 7l4 4" /></svg>,
  copy: <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a1 1 0 011-1h9" /></svg>,
  move: <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18" /><path d="M3 12h18" /><path d="M9 6l3-3 3 3" /><path d="M9 18l3 3 3-3" /><path d="M6 9l-3 3 3 3" /><path d="M18 9l3 3-3 3" /></svg>,
  text: <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7V5h16v2" /><path d="M12 5v14" /><path d="M9 19h6" /></svg>,
  plus: <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>,
  trash: <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" /><path d="M9 7V4h6v3" /></svg>,
  image: <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></svg>,
  title: <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 16.5h7" /></svg>,
  camera: <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" /></svg>,
  screen: <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8" /><path d="M12 16v4" /></svg>,
  guest: <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></svg>,
  changed: <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 11-3-6.7" /><path d="M21 4v5h-5" /></svg>,
};

export function SceneEditor({ org, path, rename = false }: { org: string; path: string; /** Open with the name ready to retype (a fresh copy). */ rename?: boolean }) {
  const navigate = useNavigate();
  const router = useRouter();
  const { data: library } = useLibrary(org);
  const { state } = useLive();
  const onAir = state?.onAir?.path === path;
  const onAirRef = useRef(onAir);
  onAirRef.current = onAir;
  const place = placeOf(library, path);
  const isTemplate = path.startsWith(`${org}/templates/`);

  const [base, setBaseState] = useState<Base | null>(null);
  const baseRef = useRef<Base | null>(null);
  const setBase = (b: Base) => {
    baseRef.current = b;
    setBaseState(b);
  };
  const [loadError, setLoadError] = useState("");
  /** A scene is open but couldn't be read again: say so, with Reload, and keep everything else. */
  const [stuck, setStuck] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const [selected, setSelected] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  /** `at`: when a long-press opened it (the release of that press must not pick an item); 0 otherwise. */
  const [menu, setMenu] = useState<{ x: number; y: number; hit: Hit; at: number } | null>(null);
  const [editing, setEditing] = useState<{ id: number; original: string; gen: number } | null>(null);
  const [drag, setDrag] = useState<{ id: number; left: number; top: number; guides: { x: number[]; y: number[] } } | null>(null);
  const [undo, setUndo] = useState<UndoEntry[]>([]);
  const [conflict, setConflict] = useState<{ edits: SceneEdit[]; changed: number[]; prev: Base; latest: Base } | null>(null);
  const [resizing, setResizing] = useState<{ id: number; width: number; height: number } | null>(null);
  /** Adding or deleting: saved before the scene on screen changes, so nothing else happens meanwhile. */
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [addOpen, setAddOpen] = useState(false);
  /** Choosing a picture from the org's assets: for a new image, or to replace image `id`. */
  const [picker, setPicker] = useState<{ replace: number | null } | null>(null);
  /** A picture being dragged over the scene (EDIT-22): where it would land, and the image it would replace. */
  const [dropAt, setDropAt] = useState<{ x: number; y: number; image: number | null } | null>(null);
  /** Dropped on an image: Replace this image, or Add it as a new one. `x`/`y` are where the menu goes. */
  const [dropChoice, setDropChoice] = useState<{ file: File; at: { x: number; y: number }; image: number; x: number; y: number } | null>(null);
  const [dropping, setDropping] = useState(false);
  const [, setTick] = useState(0);
  const redraw = () => setTick((t) => t + 1);
  /** Where each movable element was when the editor opened, for Put it back. */
  const origins = useRef(new Map<number, Pos>());
  /** Bumped on every (re)load: element ids from before a reload may name different elements now. */
  const generation = useRef(0);
  const conflictOpen = useRef(false);
  /** A 409 whose latest version hasn't loaded yet. */
  const pendingConflict = useRef<{ edits: SceneEdit[]; prev: Base } | null>(null);
  const frameMismatches = useRef(0);

  // ------------------------------------------------------------ loading

  const load = useCallback(async () => {
    try {
      const b = toBase(await api.sceneForEdit(path));
      generation.current++;
      origins.current = new Map();
      b.els.forEach((e) => {
        const p = posIn(b, e.id);
        if (p) origins.current.set(e.id, { left: p.left, top: p.top });
      });
      setBase(b);
      setLoadError("");
      setStuck(null);
      // Anything in progress refers to ids from the old version: end it (unsaved, it's stale anyway).
      editingRef.current = null;
      setEditing(null);
      setMenu(null);
      setSelected(null);
      setHover(null);
      setDrag(null);
      gesture.current = null;
      if (nudge.current) clearTimeout(nudge.current.timer);
      nudge.current = null;
      // An open conflict follows the newest version: its marks and Apply my change again use it.
      // Undo entries name elements of the old version: they can't be replayed on this one.
      setUndo([]);
      const pending = pendingConflict.current;
      pendingConflict.current = null;
      if (pending) {
        conflictOpen.current = true;
        setConflict({ ...pending, changed: changedElements(pending.prev.source, b.source), latest: b });
      } else if (conflictOpen.current) setConflict((c) => (c ? { ...c, latest: b, changed: changedElements(c.prev.source, b.source) } : c));
      setReady(false);
      setFrameKey((k) => k + 1);
      return b;
    } catch (e) {
      // With a scene already open, a failed reload is a message, not the end of the editor.
      if (baseRef.current) {
        setReady(false);
        setStuck(`Couldn't read the scene again: ${(e as Error).message}`);
      } else setLoadError((e as Error).message);
      return null;
    }
  }, [path]);
  useEffect(() => void load(), [load]);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const fit = () => setScale(Math.max(0.05, Math.min(el.clientWidth / W, el.clientHeight / H)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [base !== null]);

  // ------------------------------------------------------------ the scene's DOM (in the iframe)

  const doc = () => frame.current?.contentDocument ?? null;
  const node = (id: number) => doc()?.querySelector<HTMLElement>(`[data-vs="${id}"]`) ?? null;
  const rectOf = (id: number | null): Box | null => {
    if (id === null || !ready) return null;
    const r = node(id)?.getBoundingClientRect();
    return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
  };
  const posNow = (id: number): Pos | null => {
    const el = node(id);
    const b = baseRef.current;
    const p = b ? posIn(b, id) : null;
    if (!p) return null;
    const left = parseFloat(el?.style.left ?? "");
    const top = parseFloat(el?.style.top ?? "");
    return { left: Number.isFinite(left) ? left : p.left, top: Number.isFinite(top) ? top : p.top };
  };
  const sizeNow = (id: number): Size | null => {
    const el = node(id);
    const b = baseRef.current;
    const z = b ? sizeIn(b, id) : null;
    if (!z) return null;
    const width = parseFloat(el?.style.width ?? "");
    const height = parseFloat(el?.style.height ?? "");
    return { width: Number.isFinite(width) ? width : z.width, height: Number.isFinite(height) ? height : z.height };
  };
  const applyDom = (edit: SceneEdit) => {
    const el = node(edit.id);
    if (!el) return;
    if ("text" in edit) el.textContent = edit.text;
    else if ("src" in edit) el.setAttribute("src", edit.src);
    else if (!isStructural(edit)) {
      if ("width" in edit) {
        el.style.width = `${edit.width}px`;
        el.style.height = `${edit.height}px`;
      }
      if (edit.left !== undefined) el.style.left = `${edit.left}px`;
      if (edit.top !== undefined) el.style.top = `${edit.top}px`;
    }
    redraw();
  };

  /** Element ids under a scene point: the text there, and the box that moves with it. */
  const hit = (x: number, y: number): Hit => {
    const b = baseRef.current;
    const d = doc();
    const out: Hit = { leaf: null, move: null, image: null };
    if (!b || !d) return out;
    let el: Element | null = d.elementFromPoint(x, y);
    while (el) {
      const id = Number((el as HTMLElement).dataset?.vs);
      if (Number.isInteger(id) && b.els[id]) {
        if (out.leaf === null && out.move === null && b.els[id]!.leaf) out.leaf = id;
        if (out.move === null && movableIn(b, id)) out.move = id;
        if (out.image === null && (out.move === null || out.move === id) && b.els[id]!.tag === "img") out.image = id;
      }
      el = el.parentElement;
    }
    return out;
  };

  // ------------------------------------------------------------ live preview (on air only) and saving

  const pending = useRef(new Map<string, { edit: SceneEdit; gen: number }>());
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The latest live change not saved yet (typing, mid-drag, nudging); resent as a heartbeat. */
  const unsaved = useRef<{ edit: SceneEdit; gen: number } | null>(null);
  /**
   * Show a change live on stream. `gen` is the generation its id came from (when the drag, typing or
   * nudge started). After a reload the ids may name other elements, so an older one is never sent:
   * the hash it would carry is the new version's, which the program page would accept.
   */
  const preview = (edit: SceneEdit, gen = generation.current) => {
    if (gen !== generation.current) return;
    unsaved.current = { edit, gen };
    if (!onAirRef.current) return;
    if (isStructural(edit)) return; // reaches the stream as the saved file
    const kind = editKind(edit);
    pending.current.set(`${edit.id}:${kind === "text" ? "t" : kind === "src" ? "s" : "p"}`, { edit, gen });
    if (previewTimer.current) return;
    const flush = () => {
      const items = [...pending.current.values()].filter((p) => p.gen === generation.current);
      pending.current.clear();
      if (!items.length) {
        previewTimer.current = undefined;
        return;
      }
      const hash = baseRef.current?.hash ?? "";
      for (const p of items) api.previewScene(path, hash, p.edit).catch(() => {});
      previewTimer.current = setTimeout(flush, PREVIEW_MS);
    };
    flush();
  };
  useEffect(() => () => clearTimeout(previewTimer.current), []);

  // Save edits one at a time against the version their ids came from (see lib/scene-saver.ts).
  const saverRef = useRef<ReturnType<typeof createSceneSaver<Base, UndoEntry[]>> | null>(null);
  if (!saverRef.current) {
    saverRef.current = createSceneSaver<Base, UndoEntry[]>({
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
        if (conflictOpen.current) setConflict((c) => (c ? { ...c, edits: [...c.edits, ...edits] } : c));
        else if (pendingConflict.current) pendingConflict.current.edits.push(...edits);
        else toast("The scene reloaded, so your last change didn't save");
      },
      onError: async (e) => {
        toast(`Couldn't save: ${(e as Error).message}`);
        setUndo([]);
        await load();
      },
    });
  }
  const save = (edits: SceneEdit[], undoEntries: UndoEntry[] = [], madeIn = generation.current) => {
    unsaved.current = null;
    // Undo is in the order changes were made, so its entry goes on now, not when the server answers.
    // (A conflict or failed save reloads, and every reload clears Undo.) A change from before a
    // reload gets none: its ids are the old version's.
    if (undoEntries.length && madeIn === generation.current) setUndo((u) => [...u, ...undoEntries]);
    return saverRef.current!(edits, undoEntries, madeIn);
  };

  /** Change an element now: on screen, live on stream, and saved. */
  const change = (edit: SceneEdit, before: SceneEdit | null) => {
    flushNudge(); // a pending nudge saves first, so it can't land after (and over) this change
    applyDom(edit);
    preview(edit);
    save([edit], before ? [{ before, after: edit }] : []);
  };

  // Undo and "is this a change?" compare with what's on screen now, not the last saved base: a save
  // may still be on its way.
  const setPos = (id: number, left: number, top: number) => {
    const now = posNow(id);
    const next = { id, left: Math.round(left), top: Math.round(top) };
    if (!now || (now.left === next.left && now.top === next.top)) {
      applyDom(next);
      return;
    }
    change(next, { id, ...now });
  };

  const setBoxSize = (id: number, width: number, height: number) => {
    const now = sizeNow(id);
    const next = { id, width: Math.max(MIN_SIZE, Math.round(width)), height: Math.max(MIN_SIZE, Math.round(height)) };
    if (!now || (now.width === next.width && now.height === next.height)) return;
    change(next, { id, ...now });
  };

  // ------------------------------------------------------------ adding and deleting (EDIT-16 · EDIT-17)

  /**
   * Add or delete an element. Unlike other changes, element ids after it change, so it's saved first
   * (after every change before it), and only then does the scene on screen follow: the frame's DOM
   * gets the same change and its data-vs ids renumbered to match the saved file. The stream gets the
   * saved file, which swaps in without a transition. Undo entries below it were made in the ids from
   * before it, and are only reached once Undo has taken it back out, so they stay right.
   */
  /** Resolves to the inserted element's id (null for a delete) once saved and shown; to false if it didn't happen. */
  const structural = async (edit: InsertEdit | RemoveEdit, record = true): Promise<{ added: number | null } | false> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      flushNudge();
      if (editingRef.current) finishRef.current(true);
      // The edit's ids are from now: if waiting reloads the scene (a failed save before it), they may name something else.
      const madeIn = generation.current;
      await saverRef.current!.idle();
      if (generation.current !== madeIn) return false;
      const b = baseRef.current;
      const d = doc();
      if (!b || !d || conflictOpen.current || pendingConflict.current) return false;
      let ids: ReturnType<typeof idsAfter>, undoIt: SceneEdit;
      try {
        ids = idsAfter(b.source, edit);
        undoIt = "insert" in edit ? { id: ids.added!, remove: true } : restoreFor(b.source, edit.id);
      } catch (e) {
        toast((e as Error).message);
        return false;
      }
      const gen = generation.current;
      await save([edit], [], gen);
      // Not saved (a conflict or an error reloaded the scene): nothing to show.
      if (generation.current !== gen || baseRef.current === b) return false;
      // The frame follows the saved file.
      const gone = "remove" in edit ? node(edit.id) : null;
      gone?.remove();
      const nodes = [...d.querySelectorAll<HTMLElement>("[data-vs]")];
      for (const n of nodes) {
        const m = ids.map(Number(n.dataset.vs));
        if (m !== null) n.dataset.vs = String(m);
      }
      if ("insert" in edit) {
        const tpl = d.createElement("template");
        tpl.innerHTML = edit.insert;
        const fresh = tpl.content.firstElementChild as HTMLElement | null;
        if (fresh) {
          [fresh, ...fresh.querySelectorAll<HTMLElement>("*")].forEach((n, i) => (n.dataset.vs = String(ids.added! + i)));
          const parent = node(edit.id);
          const before = edit.before !== undefined ? node(ids.map(edit.before) ?? -1) : null;
          parent?.insertBefore(fresh, before);
        }
      }
      // Everything that names an element by id moves to the new ids.
      const moved = new Map<number, Pos>();
      origins.current.forEach((pos, id) => {
        const m = ids.map(id);
        if (m !== null) moved.set(m, pos);
      });
      origins.current = moved;
      if (record) setUndo((u) => [...u, { before: undoIt, after: edit }]);
      setHover(null);
      setMenu(null);
      if (ids.added !== null) {
        const p = posIn(baseRef.current!, ids.added);
        if (p) origins.current.set(ids.added, p);
        setSelected(movableIn(baseRef.current!, ids.added) ? ids.added : null);
      } else setSelected((sel) => (sel === null ? null : ids.map(sel)));
      redraw();
      return { added: ids.added };
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const add = (kind: AddKind, image?: { src: string; width: number; height: number }, at?: { x: number; y: number }) => {
    setAddOpen(false);
    const b = baseRef.current;
    if (!b) return;
    const root = sceneRoot(b.source);
    if (root === null) return toast("This scene has no place to add things. Ask your agent to add it.");
    const slots = slotsIn(b);
    const slot = DEVICE_SLOTS[kind] ? freeSlotName(DEVICE_SLOTS[kind]!, slots) : null;
    void structural({ id: root, insert: markupFor(kind, { slots, image, at }) }).then((done) => {
      if (done && slot && onAirRef.current) toast(`On air: OBS puts its "${slot}" source in the new box`);
      else if (done && slot && slot !== DEVICE_SLOTS[kind]) toast(`This box asks OBS for a source named "${slot}"`);
    });
  };

  const remove = (id: number) => {
    const b = baseRef.current;
    if (!b) return;
    if (!canRemove(b.source, id)) return toast("This can't be deleted here. Ask your agent, or open the file.");
    setMenu(null);
    void structural({ id, remove: true }).then((done) => done && toast("Deleted. Undo puts it back."));
  };

  const doUndo = () => {
    if (busyRef.current) return;
    // A nudge still waiting to save is the latest change: Undo cancels it (nothing was saved yet).
    const n = nudge.current;
    if (n) {
      clearTimeout(n.timer);
      nudge.current = null;
      applyDom(n.before);
      preview(n.before, n.gen);
      return;
    }
    const last = undo[undo.length - 1];
    if (!last) return;
    setUndo((u) => u.slice(0, -1));
    if (isStructural(last.before)) {
      void structural(last.before, false);
      return;
    }
    applyDom(last.before);
    preview(last.before);
    save([last.before]);
  };

  // ------------------------------------------------------------ editing text in place

  const startEdit = (id: number) => {
    const el = node(id);
    const d = doc();
    if (!el || !d) return;
    setMenu(null);
    setSelected(null);
    setHover(null);
    const original = el.textContent ?? "";
    el.setAttribute("contenteditable", "plaintext-only");
    if (el.contentEditable !== "plaintext-only") el.setAttribute("contenteditable", "true");
    el.spellcheck = false;
    el.focus();
    const range = d.createRange();
    range.selectNodeContents(el);
    const sel = d.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    setEditing({ id, original, gen: generation.current });
  };

  const finishEdit = (commit: boolean) => {
    if (!editing) return;
    const el = node(editing.id);
    const b = baseRef.current;
    editingRef.current = null; // finished: leaving now mustn't put the old text back on air
    setEditing(null);
    if (!el || !b) return;
    el.removeAttribute("contenteditable");
    el.blur();
    // Collapse only HTML whitespace, as the server does: a non-breaking space is part of the text.
    const collapse = collapseHtmlSpace;
    // Browsers type a space at the start or end of editable text as U+00A0. That's typing, not text:
    // drop it at an edge unless the original had one there.
    const original = collapse(editing.original);
    let text = collapse(el.textContent ?? "");
    if (!original.startsWith("\u00a0")) text = text.replace(/^\u00a0+/, "");
    if (!original.endsWith("\u00a0")) text = text.replace(/\u00a0+$/, "");
    text = collapse(text);
    const before = { id: editing.id, text: original };
    if (!commit || !text.trim()) {
      if (commit && !text.trim()) toast("Text can't be empty: put back what was there");
      el.textContent = editing.original;
      preview({ id: editing.id, text: editing.original }, editing.gen);
      redraw();
      return;
    }
    if (text === before.text) {
      el.textContent = editing.original;
      redraw();
      return;
    }
    el.textContent = text;
    save([{ id: editing.id, text }], [{ before, after: { id: editing.id, text } }], editing.gen);
    redraw();
  };
  const finishRef = useRef(finishEdit);
  finishRef.current = finishEdit;

  useEffect(() => {
    if (!editing) return;
    const el = node(editing.id);
    const d = doc();
    if (!el || !d) return;
    const onInput = () => {
      preview({ id: editing.id, text: el.textContent ?? "" }, editing.gen);
      redraw();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finishRef.current(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finishRef.current(false);
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      const text = (e.clipboardData?.getData("text/plain") ?? "").replace(/[ \t\n\r\f]+/g, " ");
      d.execCommand("insertText", false, text);
    };
    const onOutside = (e: PointerEvent) => {
      if (!el.contains(e.target as Node)) finishRef.current(true);
    };
    el.addEventListener("input", onInput);
    el.addEventListener("keydown", onKey);
    el.addEventListener("paste", onPaste);
    d.addEventListener("pointerdown", onOutside, true);
    return () => {
      el.removeEventListener("input", onInput);
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("paste", onPaste);
      d.removeEventListener("pointerdown", onOutside, true);
    };
  }, [editing]);

  // Leaving mid-change (navigating away, closing the tab, the iPad losing its cable) puts the on-air
  // scene back the way the file has it. A beacon survives pagehide.
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const revertLive = useRef(() => {});
  revertLive.current = () => {
    const b = baseRef.current;
    if (!onAirRef.current || !b) return;
    const g = gesture.current?.drag;
    const r = gesture.current?.resize;
    const n = nudge.current;
    const e = editingRef.current;
    const back = e ? { edit: { id: e.id, text: e.original }, gen: e.gen } : g ? { edit: { id: g.id, ...g.start }, gen: g.gen } : r ? { edit: { id: r.id, ...r.start }, gen: r.gen } : n ? { edit: n.before, gen: n.gen } : null;
    // A change from before a reload was never shown on this version, so there's nothing to put back.
    if (back && back.gen === generation.current) api.previewSceneBeacon(path, b.hash, back.edit);
  };
  useEffect(() => {
    const onHide = () => revertLive.current();
    window.addEventListener("pagehide", onHide);
    // Keep an unsaved change alive on stream while the editor is here (the program page drops one that goes quiet).
    const beat = setInterval(() => {
      const u = unsaved.current;
      const b = baseRef.current;
      if (u && b && u.gen === generation.current && onAirRef.current && (editingRef.current || gesture.current?.drag || gesture.current?.resize || nudge.current)) {
        api.previewScene(path, b.hash, u.edit).catch(() => {});
      }
    }, HEARTBEAT_MS);
    return () => {
      window.removeEventListener("pagehide", onHide);
      clearInterval(beat);
      // A pending nudge is saved first (so the stream doesn't snap back before it lands); then
      // anything still unfinished goes back to what the file has.
      flushNudgeRef.current();
      revertLive.current();
    };
  }, [path]);

  // ------------------------------------------------------------ pointer: select, drag, long-press, double-tap

  type Gesture = {
    pointerId: number; cx: number; cy: number; hit: Hit; moved: boolean; long: boolean; timer?: ReturnType<typeof setTimeout>;
    drag?: { id: number; start: Pos; rect: Box; others: Box[]; x0: number; y0: number; last: Pos; gen: number };
    resize?: { id: number; corner: Corner; start: Pos & Size; x0: number; y0: number; last: Pos & Size; slot: boolean; gen: number };
  };
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ t: number; cx: number; cy: number; leaf: number | null } | null>(null);

  const toScene = (e: { clientX: number; clientY: number }) => {
    const r = overlay.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scaleRef.current, y: (e.clientY - r.top) / scaleRef.current };
  };
  const openMenu = (cx: number, cy: number, h: Hit, longPress = false) => {
    const r = overlay.current!.getBoundingClientRect();
    if (h.leaf === null && h.move === null) return;
    // Just off the finger, so the touch that opened it can't land on an item.
    setMenu({ x: cx - r.left + 10, y: cy - r.top + 10, hit: h, at: longPress ? performance.now() : 0 });
    if (h.move !== null) setSelected(h.move);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (editing || conflict || !ready || busyRef.current || e.button > 0) return;
    setMenu(null);
    const p = toScene(e);
    // A corner handle of the selected box: resize it (EDIT-17).
    const corner = (e.target as HTMLElement).closest?.("[data-corner]")?.getAttribute("data-corner") as Corner | null;
    const b = baseRef.current;
    if (corner && selected !== null && b) {
      const pos = posNow(selected), size = sizeNow(selected);
      if (pos && size) {
        e.preventDefault();
        flushNudge();
        overlay.current!.setPointerCapture(e.pointerId);
        const start = { ...pos, ...size };
        gesture.current = {
          pointerId: e.pointerId, cx: e.clientX, cy: e.clientY, hit: { leaf: null, move: selected, image: null }, moved: true, long: false,
          resize: { id: selected, corner, start, x0: p.x, y0: p.y, last: start, slot: isSlot(b, selected), gen: generation.current },
        };
        setResizing({ id: selected, ...size });
        return;
      }
    }
    const h = hit(p.x, p.y);
    overlay.current!.setPointerCapture(e.pointerId);
    const g: Gesture = { pointerId: e.pointerId, cx: e.clientX, cy: e.clientY, hit: h, moved: false, long: false };
    if (h.leaf !== null || h.move !== null) {
      g.timer = setTimeout(() => {
        g.long = true;
        openMenu(g.cx, g.cy, h, true);
      }, LONG_PRESS_MS);
    }
    gesture.current = g;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (g?.resize && g.pointerId === e.pointerId) {
      const r = g.resize;
      const p = toScene(e);
      const dx = p.x - r.x0, dy = p.y - r.y0;
      const west = r.corner === "nw" || r.corner === "sw", north = r.corner === "nw" || r.corner === "ne";
      let w = r.start.width + (west ? -dx : dx);
      let h = r.start.height + (north ? -dy : dy);
      // Device boxes keep 16:9 (the camera's own shape) unless Shift is held; sizes go on the 8 px grid.
      if (r.slot && !e.shiftKey) {
        w = Math.max(MIN_SIZE * 16 / 9, Math.abs(dx) * 9 >= Math.abs(dy) * 16 ? w : h * 16 / 9);
        w = Math.round(w / 16) * 16;
        h = (w * 9) / 16;
      } else {
        w = Math.max(MIN_SIZE, Math.round(w / 8) * 8);
        h = Math.max(MIN_SIZE, Math.round(h / 8) * 8);
      }
      const next = {
        width: Math.round(w), height: Math.round(h),
        left: west ? r.start.left + r.start.width - Math.round(w) : r.start.left,
        top: north ? r.start.top + r.start.height - Math.round(h) : r.start.top,
      };
      if (next.width === r.last.width && next.height === r.last.height && next.left === r.last.left && next.top === r.last.top) return;
      r.last = next;
      const edit = { id: r.id, width: next.width, height: next.height, ...(west ? { left: next.left } : {}), ...(north ? { top: next.top } : {}) };
      applyDom(edit);
      preview(edit, r.gen);
      setResizing({ id: r.id, width: next.width, height: next.height });
      return;
    }
    if (!g || g.pointerId !== e.pointerId) {
      if (e.pointerType === "mouse" && !editing && ready) {
        const p = toScene(e);
        setHover(hit(p.x, p.y).leaf);
      }
      return;
    }
    if (!g.moved && Math.hypot(e.clientX - g.cx, e.clientY - g.cy) < DRAG_START_PX) return;
    if (!g.moved) {
      g.moved = true;
      clearTimeout(g.timer);
      const id = g.hit.move;
      const b = baseRef.current;
      if (id === null || g.long || !b) return;
      const self = node(id);
      const start = posNow(id);
      const rect = rectOf(id);
      if (!self || !start || !rect) return;
      // Snap to every other movable box that isn't this one, inside it, or around it.
      const others = b.els.filter((x) => x.id !== id && movableIn(b, x.id)).flatMap((x) => {
        const n = node(x.id);
        if (!n || n.contains(self) || self.contains(n)) return [];
        const r = rectOf(x.id);
        return r ? [r] : [];
      });
      const p = toScene({ clientX: g.cx, clientY: g.cy });
      flushNudge();
      g.drag = { id, start, rect, others, x0: p.x, y0: p.y, last: start, gen: generation.current };
      setSelected(id);
      setHover(null);
    }
    const d = g.drag;
    if (!d) return;
    const p = toScene(e);
    const s = snapMove({ ...d.rect, x: d.rect.x + p.x - d.x0, y: d.rect.y + p.y - d.y0 }, d.others, { threshold: SNAP_PX / scaleRef.current });
    // Snapped to an edge: exact. Otherwise the saved left/top go on the 8 px grid themselves (the box's
    // screen position can be offset by its parent or margins).
    const grid = (v: number, snapped: boolean) => (snapped ? Math.round(v) : Math.round(v / 8) * 8);
    const next = {
      left: grid(d.start.left + s.x - d.rect.x, s.guides.x.length > 0),
      top: grid(d.start.top + s.y - d.rect.y, s.guides.y.length > 0),
    };
    if (next.left === d.last.left && next.top === d.last.top) return;
    d.last = next;
    applyDom({ id: d.id, ...next });
    preview({ id: d.id, ...next }, d.gen);
    setDrag({ id: d.id, ...next, guides: s.guides });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    clearTimeout(g.timer);
    if (g.resize) {
      const { id, start, last, gen, corner } = g.resize;
      setResizing(null);
      const west = corner === "nw" || corner === "sw", north = corner === "nw" || corner === "ne";
      const pick = (v: Pos & Size) => ({ id, width: v.width, height: v.height, ...(west ? { left: v.left } : {}), ...(north ? { top: v.top } : {}) });
      if (last.width !== start.width || last.height !== start.height) save([pick(last)], [{ before: pick(start), after: pick(last) }], gen);
      return;
    }
    if (g.drag) {
      const { id, start, last, gen } = g.drag;
      setDrag(null);
      if (last.left !== start.left || last.top !== start.top) {
        save([{ id, ...last }], [{ before: { id, ...start }, after: { id, ...last } }], gen);
      }
      return;
    }
    if (g.moved || g.long) return;
    // A tap: a second one on the same text edits it; otherwise select what's under it.
    const t = lastTap.current;
    const now = performance.now();
    if (t && now - t.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - t.cx, e.clientY - t.cy) < 30 && g.hit.leaf !== null && t.leaf === g.hit.leaf) {
      lastTap.current = null;
      startEdit(g.hit.leaf);
      return;
    }
    lastTap.current = { t: now, cx: e.clientX, cy: e.clientY, leaf: g.hit.leaf };
    setSelected(g.hit.move);
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    clearTimeout(g.timer);
    if (g.resize) {
      const { id, start, gen } = g.resize;
      applyDom({ id, ...start });
      preview({ id, ...start }, gen);
      setResizing(null);
      return;
    }
    if (g.drag) {
      applyDom({ id: g.drag.id, ...g.drag.start });
      preview({ id: g.drag.id, ...g.drag.start }, g.drag.gen);
      setDrag(null);
    }
  };

  // ------------------------------------------------------------ keyboard: nudges, undo, escape

  const nudge = useRef<{ id: number; before: SceneEdit; last: Pos; gen: number; timer?: ReturnType<typeof setTimeout> } | null>(null);
  const flushNudge = () => {
    const n = nudge.current;
    if (!n) return;
    clearTimeout(n.timer);
    nudge.current = null;
    const now = n.last;
    if (!("left" in n.before) || (now.left === n.before.left && now.top === n.before.top)) return;
    save([{ id: n.id, ...now }], [{ before: n.before, after: { id: n.id, ...now } }], n.gen);
  };
  const flushNudgeRef = useRef(flushNudge);
  flushNudgeRef.current = flushNudge;

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return; // already handled (e.g. Return/Esc in the text being typed)
    // An add or delete is saving: element ids are about to change, so nothing may start on the old ones.
    if (busyRef.current) {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Delete", "Backspace"].includes(e.key) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z")) e.preventDefault();
      return;
    }
    // The picture picker is open: it names an image by id, so the scene stays as it is until it closes.
    if (picker) {
      if (e.key === "Escape") setPicker(null);
      return;
    }
    if (editing) {
      if (e.key === "Escape") finishEdit(false);
      return;
    }
    const inField = (e.target as HTMLElement)?.closest?.("input, textarea, select");
    if (inField) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      doUndo();
      return;
    }
    if (e.key === "Escape") {
      if (addOpen) setAddOpen(false);
      else if (menu) setMenu(null);
      else setSelected(null);
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selected !== null && !conflict && !picker) {
      e.preventDefault();
      remove(selected);
      return;
    }
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const dir = dirs[e.key];
    if (!dir || selected === null || conflict) return;
    e.preventDefault();
    const now = posNow(selected);
    if (!now) return;
    if (!nudge.current || nudge.current.id !== selected) {
      flushNudge();
      nudge.current = { id: selected, before: { id: selected, ...now }, last: now, gen: generation.current };
    }
    const step = e.shiftKey ? 10 : 1;
    const next = { id: selected, left: now.left + dir[0] * step, top: now.top + dir[1] * step };
    applyDom(next);
    preview(next, nudge.current.gen);
    nudge.current.last = { left: next.left, top: next.top };
    clearTimeout(nudge.current.timer);
    nudge.current.timer = setTimeout(flushNudge, NUDGE_SAVE_MS);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", onKey);
    const d = ready ? doc() : null;
    d?.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      d?.removeEventListener("keydown", onKey);
    };
  }, [ready, frameKey]);

  // ------------------------------------------------------------ dropping a picture in (EDIT-22)
  // A picture file dropped on the scene goes into the org's assets and lands where it was dropped, as
  // one new image (a source patch like Add → Image, live and undoable). Dropped on an image the scene
  // has, it asks: Replace this image, or Add as a new image.

  /** The image under scene point `p` that a picture could replace (a library picture, no srcset), or null. */
  const replaceable = (p: { x: number; y: number }) => {
    const b = baseRef.current;
    const id = hit(p.x, p.y).image;
    return b && id !== null && isLibraryUrl(attrIn(b, id, "src") ?? "") && attrIn(b, id, "srcset") === null ? id : null;
  };
  const canDrop = () => ready && !editing && !conflict && !busyRef.current && !dropping;
  const hasFiles = (e: ReactDragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

  const placePicture = async (file: File, at: { x: number; y: number }, replace: number | null) => {
    setDropping(true);
    try {
      const [{ saved }, size] = await Promise.all([api.upload(org, [file]), naturalSize(file)]);
      if (!saved[0]) throw new Error("The picture didn't upload");
      const src = libraryUrl(saved[0].path).replace(/'/g, "%27");
      if (replace !== null) {
        const b = baseRef.current;
        change({ id: replace, src }, b ? valueIn(b, { id: replace, src }) : null);
        toast("Replaced. Undo puts the old picture back.");
      } else add("image", { src, width: size.width || 1, height: size.height || 1 }, at);
    } catch (e) {
      toast(`Couldn't add the picture: ${(e as Error).message}`);
    } finally {
      setDropping(false);
    }
  };

  const onDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = canDrop() ? "copy" : "none";
    if (!canDrop()) return;
    const p = toScene(e);
    setDropAt((d) => (d && Math.abs(d.x - p.x) < 4 && Math.abs(d.y - p.y) < 4 ? d : { ...p, image: replaceable(p) }));
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
    const at = toScene(e);
    const image = replaceable(at);
    if (image !== null) {
      const r = overlay.current!.getBoundingClientRect();
      setDropChoice({ file: pictures[0]!, at, image, x: e.clientX - r.left + 10, y: e.clientY - r.top + 10 });
      setSelected(null);
      return;
    }
    void placePicture(pictures[0]!, at, null);
  };
  // A picture dropped just outside the scene would make the browser open the file instead of the
  // editor: the editor page takes every file drop, and only the scene uses them.
  useEffect(() => {
    const stop = (e: DragEvent) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  // ------------------------------------------------------------ conflict

  const applyAgain = async () => {
    if (!conflict) return;
    const { edits, prev } = conflict;
    const latest = baseRef.current ?? conflict.latest; // the newest version, if it moved on again
    const pairs = edits.map((e) => ({ e, m: retarget(prev.source, latest.source, e) }));
    conflictOpen.current = false;
    setConflict(null);
    // The ones that can be placed go through; the others are said so. (Their earlier live previews
    // were on the old version, which the stream already replaced.)
    const lost = pairs.filter((p) => p.m === null).length;
    if (lost) toast(lost === pairs.length ? "That part of the scene isn't in the new version, so your change can't go there" : "Some of your changes can't go anywhere in the new version, so only the others were saved");
    // Several lost changes of one kind to one element (a drag, then a nudge) become its last one.
    // Each goes as its own save: a move and a resize of one box both change its left.
    const last = new Map<string, SceneEdit>();
    for (const { m } of pairs) if (m && !isStructural(m)) last.set(`${m.id}:${editKind(m)}`, m);
    for (const e of last.values()) {
      const before = valueIn(latest, e);
      applyDom(e);
      preview(e);
      save([e], before ? [{ before, after: e }] : []);
    }
    // Adding and deleting go through the same path as the first time (saved, then the frame follows),
    // one at a time, each placed in the version as it is by then.
    for (const { e, m } of pairs) {
      if (!m || !isStructural(m)) continue;
      const now = baseRef.current;
      let again = now ? retarget(prev.source, now.source, e) : null;
      // A box's slot name was picked against the old version: pick again if the new one already uses it.
      if (now && again && "insert" in again) {
        const taken = slotsIn(now);
        const m = /data-slot="([^"]*)"/.exec(again.insert);
        const base = m?.[1]?.replace(/ \d+$/, "");
        if (m && base && taken.includes(m[1]!)) again = { ...again, insert: again.insert.replace(m[0], `data-slot="${freeSlotName(base, taken)}"`) };
      }
      if (again && isStructural(again)) await structural(again);
    }
  };
  const keepNew = () => {
    if (!conflict) return;
    // The stream may still show the preview of the change that didn't save: put the latest back.
    for (const e of conflict.edits) {
      const m = retarget(conflict.prev.source, conflict.latest.source, e);
      const v = m && valueIn(conflict.latest, m);
      if (v) preview(v);
    }
    conflictOpen.current = false;
    setConflict(null);
  };

  // ------------------------------------------------------------ actions

  const [leaving, setLeaving] = useState(false);
  /** Every queued save has finished, and none of them hit a conflict (that screen is up instead). */
  const settle = async () => {
    setLeaving(true);
    try {
      await saverRef.current!.idle();
    } finally {
      setLeaving(false);
    }
    return !conflictOpen.current && !pendingConflict.current;
  };
  const leave = async () => {
    // Done or Back while typing saves what was typed, as Return would. Then wait for the saves to
    // land: if one hits a conflict, stay so it can be dealt with.
    if (editing) finishEdit(true);
    flushNudge();
    if (!(await settle())) return;
    if (window.history.length > 1) router.history.back();
    else navigate({ to: "/$org", params: { org } });
  };
  // ------------------------------------------------------------ rename (EDIT-19)

  const [naming, setNaming] = useState(rename);
  /** The new name until the library catches up. */
  const [named, setNamed] = useState<string | null>(null);
  // The file's own <title> first: right after a duplicate, the library hasn't caught up with the copy yet.
  const shownTitle = named ?? (base && titleIn(base)) ?? place.title;
  const doRename = (name: string) =>
    attempt(async () => {
      setNaming(false);
      const clean = name.trim();
      if (!clean || clean === shownTitle || busyRef.current) return;
      if (editing) finishEdit(true);
      flushNudge();
      if (!(await settle())) return;
      const b = baseRef.current;
      if (!b) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const r = await api.renameScene(path, b.hash, clean);
        setNamed(clean);
        if (r.path !== path) {
          toast(onAirRef.current ? `Renamed: ${clean}. It's still on air.` : `Renamed: ${clean}`);
          navigate({ to: "/$org/edit", params: { org }, search: { path: r.path }, replace: true });
          return;
        }
        // Same file, new <title>: with one already there, every element keeps its id (and Undo still works).
        const source = setTitle(b.source, clean);
        const els = scanElements(source);
        if (els.length === b.els.length) setBase({ source, hash: r.hash, els });
        else await load();
        toast(`Renamed: ${clean}`);
      } catch (e) {
        if (!(e instanceof SceneConflict)) throw e;
        toast("The scene changed meanwhile, so it wasn't renamed. Try again.");
        await load();
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    });

  const editCopy = () =>
    attempt(async () => {
      // Nothing unfinished may land on the on-air scene on the way out: drop a pending nudge (and put
      // the stream back), and cancel typing.
      const n = nudge.current;
      if (n) {
        clearTimeout(n.timer);
        nudge.current = null;
        applyDom(n.before);
        preview(n.before, n.gen);
      }
      if (editing) finishEdit(false);
      // Changes already made are saved before copying, so the copy has them (and a conflict stays here).
      if (!(await settle())) return;
      const { name } = await api.duplicate(path);
      const copyPath = `${path.slice(0, path.lastIndexOf("/"))}/${name}.html`;
      toast("Editing a copy: it isn't on air");
      navigate({ to: "/$org/edit", params: { org }, search: { path: copyPath }, replace: true });
    });

  // ------------------------------------------------------------ render

  if (loadError) {
    return (
      <div className="editor">
        <header className="editor-top" data-drag-region>
          <button type="button" className="icon-btn" aria-label="Back" onClick={leave}>{Icon.back}</button>
          <div className="editor-titles"><span className="crumb">{place.crumb}</span><span className="title">{place.title}</span></div>
        </header>
        <p className="empty" style={{ padding: 24 }}>{loadError}</p>
      </div>
    );
  }

  const sel = selected !== null && base && movableIn(base, selected) ? selected : null;
  const selRect = rectOf(sel);
  const hoverRect = hover !== null && hover !== editing?.id ? rectOf(hover) : null;
  const editRect = editing ? rectOf(editing.id) : null;
  // The typing bar sits above the panel being typed in, so it covers none of it.
  const editBox = (() => {
    if (!editing || !base) return editRect;
    let up = base.els[editing.id]?.parent ?? null;
    while (up !== null && !movableIn(base, up)) up = base.els[up]?.parent ?? null;
    return (up !== null ? rectOf(up) : null) ?? editRect;
  })();
  const marks = conflict && ready
    ? [...new Set(conflict.changed.map((id) => {
        // Mark the text or box that changed, not the page around it.
        let at: number | null = id;
        while (at !== null && !(conflict.latest.els[at]?.leaf || movableIn(conflict.latest, at))) at = conflict.latest.els[at]?.parent ?? null;
        return at;
      }).filter((x): x is number => x !== null))]
    : [];
  const s = scale;
  const px = (b: Box) => ({ left: b.x * s, top: b.y * s, width: b.w * s, height: b.h * s });
  const selPos = sel !== null ? posNow(sel) : null;

  return (
    <div className="editor">
      <header className="editor-top" data-drag-region>
        <button type="button" className="icon-btn" aria-label="Back" onClick={leave}>{Icon.back}</button>
        <div className="editor-titles">
          <span className="crumb">{place.crumb}</span>
          {naming && base ? (
            <TitleField value={shownTitle} onDone={(v) => (v === null ? setNaming(false) : void doRename(v))} />
          ) : (
            <button type="button" className="title title-btn" title="Rename" aria-label={`Rename ${shownTitle}`} disabled={busy} onClick={() => setNaming(true)}>
              {shownTitle}{Icon.pen}
            </button>
          )}
        </div>
        {onAir && <span className="onair-pill"><span className="dot" />ON AIR</span>}
        <div style={{ flex: 1 }} />
        <div className="add-wrap">
          <button type="button" className="btn add-btn" aria-haspopup="menu" aria-expanded={addOpen} disabled={!ready || busy || !!conflict || !!editing}
            onClick={() => setAddOpen((o) => !o)}>{Icon.plus}Add</button>
          {addOpen && (
            <>
              <button type="button" className="backdrop" aria-label="Close menu" onClick={() => setAddOpen(false)} />
              <div role="menu" aria-label="Add to the scene" className="ed-menu add-menu">
                {ADD_ITEMS.map((it) => (
                  <button key={it.kind} type="button" role="menuitem" onClick={() => (it.kind === "image" ? (setAddOpen(false), setPicker({ replace: null })) : add(it.kind))}>
                    {Icon[it.icon]}<span>{it.label}<small>{it.hint}</small></span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button type="button" className="btn ghost" disabled={!undo.length || !!conflict || busy} onClick={doUndo}>{Icon.undo}Undo</button>
        <button type="button" className="btn" onClick={() => attempt(() => api.open(path))}>{Icon.code}Open the file</button>
        <button type="button" className="btn primary" disabled={leaving} onClick={leave}>{leaving ? "Saving…" : "Done"}</button>
      </header>

      {isTemplate && !onAir && (
        <div className="note-banner" role="note">
          <b>Template.</b> Changes here go into every new copy made from it. Scenes already made from it keep their own.
        </div>
      )}
      {onAir && (
        <div className="live-banner" role="status">
          <span className="dot" />
          <span><b>Live.</b> This scene is on air: what you type, drag, resize and add shows on stream as you do it.</span>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={editCopy}>Edit a copy instead</button>
        </div>
      )}

      <div className="editor-area" ref={area}>
        {base && (
          <div className={`editor-stage${onAir ? " live" : ""}`} style={{ width: W * s, height: H * s }}>
            <iframe
              key={frameKey}
              ref={frame}
              title={`${place.title} (editing)`}
              // The scene's DOM, without its scripts (EDIT-26): a pack's code never runs where the
              // editor can reach it. ?inert serves it with a CSP sandbox that has no scripts either.
              src={`${libraryUrl(path)}?edit&inert&preview&k=${frameKey}`}
              sandbox={EDITOR_SANDBOX}
              onLoad={() => {
                // Editor-only styling inside the scene (never saved): no browser focus ring while typing.
                const d = frame.current?.contentDocument;
                // What scene.js does for ?preview (it doesn't run here): the ground and device slot labels.
                d?.documentElement.classList.add("preview");
                // While typing, the scene itself is under the pointer: a file dropped there mustn't open in it.
                if (d) for (const t of ["dragover", "drop"]) d.addEventListener(t, (e) => (e as DragEvent).dataTransfer?.types.includes("Files") && e.preventDefault());
                if (d?.head && !d.getElementById("vs-editor-style")) {
                  const style = d.createElement("style");
                  style.id = "vs-editor-style";
                  style.textContent = "[contenteditable]{outline:none;caret-color:currentColor;cursor:text}[contenteditable]::selection{background:rgba(244,245,247,.28)}";
                  d.head.append(style);
                }
                // The frame loads the scene on its own: if the file changed since the base was read, its ids
                // aren't the base's. Read both again.
                // (The stamp is on <html>, or on a bare fragment's first element; with no stamp at all there's nothing to check.)
                const b = baseRef.current;
                const stamp = d ? shownVersion(d) : undefined;
                if (b && stamp !== undefined && stamp !== b.hash) {
                  // Once is a file that just changed; again means it keeps changing: stop and offer Reload.
                  if (frameMismatches.current++ === 0) void load();
                  else setStuck("This scene keeps changing while it opens.");
                  return;
                }
                frameMismatches.current = 0;
                setReady(true);
                redraw();
              }}
              style={{ transform: `scale(${s})`, pointerEvents: editing ? "auto" : "none" }}
            />
            <div
              ref={overlay}
              className={`editor-overlay${editing ? " passive" : ""}${drag ? " dragging" : ""}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              onPointerLeave={() => setHover(null)}
              onDragOver={onDragOver}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null);
              }}
              onDrop={onDrop}
              onContextMenu={(e) => {
                e.preventDefault();
                if (editing || conflict) return;
                const g = gesture.current;
                if (g) clearTimeout(g.timer);
                if (g) g.long = true;
                const p = toScene(e);
                openMenu(e.clientX, e.clientY, hit(p.x, p.y));
              }}
            >
              {hoverRect && !drag && <div className="ed-hover" style={px(hoverRect)} />}
              {selRect && !editing && <div className={`ed-selected${drag ? " lifted" : ""}`} style={px(selRect)} />}
              {selRect && !editing && !drag && sel !== null && base && sizeIn(base, sel) && (["nw", "ne", "sw", "se"] as const).map((c) => (
                <div key={c} data-corner={c} className={`ed-handle ${c}`} aria-hidden="true"
                  style={{ left: (selRect.x + (c[1] === "e" ? selRect.w : 0)) * s, top: (selRect.y + (c[0] === "s" ? selRect.h : 0)) * s }} />
              ))}
              {resizing && selRect && (
                <div className="ed-readout" style={{ left: (selRect.x + selRect.w) * s + 14, top: (selRect.y + selRect.h) * s - 30 }}>{resizing.width} × {resizing.height}</div>
              )}
              {drag && drag.guides.x.map((x) => <div key={`x${x}`} className="ed-guide v" style={{ left: x * s }} />)}
              {drag && drag.guides.y.map((y) => <div key={`y${y}`} className="ed-guide h" style={{ top: y * s }} />)}
              {drag && selRect && (
                <div className="ed-readout" style={{ left: (selRect.x + selRect.w) * s + 10, top: selRect.y * s }}>x {drag.left} · y {drag.top}</div>
              )}
              {dropAt && (() => {
                const r = dropAt.image !== null ? rectOf(dropAt.image) : null;
                return r ? (
                  <div className="ed-drop replace" style={px(r)}><span>Replace this image?</span></div>
                ) : (
                  <div className="ed-drop-point" style={{ left: dropAt.x * s, top: dropAt.y * s }}><span>Drop to add the picture here</span></div>
                );
              })()}
              {marks.map((id) => {
                const r = rectOf(id);
                return r ? (
                  <div key={id} className="ed-changed" style={px(r)}><span>CHANGED</span></div>
                ) : null;
              })}
            </div>
            {editing && editRect && (
              <div className="ed-editing" style={px(editRect)} aria-hidden="true" />
            )}
            {editing && editRect && editBox && (
              <div className="typing-bar" style={{ left: Math.max(8, Math.min(editRect.x * s, W * s - 330)), top: editBox.y * s > 60 ? editBox.y * s - 56 : Math.min((editBox.y + editBox.h) * s + 12, H * s - 52) }}>
                <span className="what">Typing in the scene</span>
                <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => finishEdit(false)}>Cancel <small>Esc</small></button>
                <button type="button" className="save" onPointerDown={(e) => e.preventDefault()} onClick={() => finishEdit(true)}>Save <small>Return</small></button>
              </div>
            )}
            {dropChoice && (
              <>
                <button type="button" className="backdrop" aria-label="Cancel" onClick={() => setDropChoice(null)} />
                <div role="menu" aria-label="Dropped on an image" className="ed-menu" style={{ left: Math.min(dropChoice.x, W * s - 250), top: Math.max(4, Math.min(dropChoice.y, H * s - 170)) }}>
                  <button type="button" role="menuitem" className="first" onClick={() => {
                    const c = dropChoice;
                    setDropChoice(null);
                    void placePicture(c.file, c.at, c.image);
                  }}>
                    {Icon.image}<span>Replace this image</span>
                  </button>
                  <button type="button" role="menuitem" onClick={() => {
                    const c = dropChoice;
                    setDropChoice(null);
                    void placePicture(c.file, c.at, null);
                  }}>
                    {Icon.plus}<span>Add as a new image</span>
                  </button>
                  <hr />
                  <button type="button" role="menuitem" className="quiet" onClick={() => setDropChoice(null)}><span>Cancel</span></button>
                </div>
              </>
            )}
            {dropping && <div className="ed-uploading" role="status">Adding the picture…</div>}
            {menu && base && (
              <>
                {/* Closes on a new press, not on the click that ends the long-press that opened it. */}
                <button type="button" className="backdrop" aria-label="Close menu"
                  onPointerDown={(e) => { e.preventDefault(); setMenu(null); }}
                  onClick={() => performance.now() - menu.at > 400 && setMenu(null)} />
                <div role="menu" aria-label="Edit options" className="ed-menu" style={{ left: Math.min(menu.x, W * s - 250), top: Math.max(4, Math.min(menu.y, H * s - 230)) }}
                  onClickCapture={(e) => { if (performance.now() - menu.at < 350) e.stopPropagation(); }}>
                  {menu.hit.leaf !== null && (
                    <>
                      <button type="button" role="menuitem" className="first" onClick={() => startEdit(menu.hit.leaf!)}>
                        {Icon.pen}<span>Edit text</span><small>Double-tap</small>
                      </button>
                      <button type="button" role="menuitem" onClick={() => {
                        const id = menu.hit.leaf!;
                        setMenu(null);
                        void copyText(node(id)?.textContent?.trim() ?? textOf(base.source, base.els[id]!));
                      }}>
                        {Icon.copy}<span>Copy text</span>
                      </button>
                    </>
                  )}
                  {menu.hit.image !== null && isLibraryUrl(attrIn(base, menu.hit.image, "src") ?? "") && attrIn(base, menu.hit.image, "srcset") === null && (
                    <button type="button" role="menuitem" className={menu.hit.leaf === null ? "first" : ""} onClick={() => {
                      setPicker({ replace: menu.hit.image });
                      setMenu(null);
                    }}>
                      {Icon.image}<span>Replace image</span>
                    </button>
                  )}
                  {(menu.hit.leaf !== null || menu.hit.image !== null) && menu.hit.move !== null && <hr />}
                  {menu.hit.move !== null && (
                    <button type="button" role="menuitem" className="quiet" onClick={() => {
                      setSelected(menu.hit.move);
                      setMenu(null);
                    }}>
                      {Icon.move}<span>Move the {nameOf(base, menu.hit.move).replace(/^\w/, (c) => c.toLowerCase())}</span><small>or drag it</small>
                    </button>
                  )}
                  {(() => {
                    const target = menu.hit.move ?? menu.hit.image;
                    return target !== null && canRemove(base.source, target) ? (
                      <button type="button" role="menuitem" className="quiet" onClick={() => remove(target)}>
                        {Icon.trash}<span>Delete the {nameOf(base, target).replace(/^\w/, (c) => c.toLowerCase())}</span><small>Delete</small>
                      </button>
                    ) : null;
                  })()}
                </div>
              </>
            )}
            {stuck && (
              <div className="conflict stuck" role="alert">
                <div className="head"><div><b>{stuck}</b><p>Nothing you've saved is lost.</p></div></div>
                <div className="actions">
                  <button type="button" className="btn primary" onClick={() => {
                    frameMismatches.current = 0;
                    void load();
                  }}>Reload</button>
                </div>
              </div>
            )}
            {conflict && (
              <div className="conflict" role="alertdialog" aria-label="This scene changed while you were editing"
                // Stay clear of what changed: low on the stage when the change is in the top half.
                style={(() => {
                  const r = marks.length ? rectOf(marks[0]!) : null;
                  return r && r.y + r.h / 2 < H / 2 ? { top: "auto", bottom: "8%" } : undefined;
                })()}>
                <div className="head">
                  {Icon.changed}
                  <div>
                    <b>This scene changed while you were editing</b>
                    <p>Your agent (or someone with the file open) saved a new version, so you're now looking at the latest. Your last change didn't save:</p>
                  </div>
                </div>
                {conflict.edits.map((e, i) => {
                  const d = describe(conflict.prev, e);
                  return <div key={i} className="lost"><span>{d.what} → </span>{d.value}</div>;
                })}
                <div className="actions">
                  <button type="button" className="btn primary" onClick={() => void applyAgain()}>Apply my change again</button>
                  <button type="button" className="btn" onClick={keepNew}>Keep the new version</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="editor-bottom">
        {sel !== null && base && selPos ? (
          <PositionBar
            key={sel}
            name={nameOf(base, sel)}
            pos={selPos}
            size={sizeIn(base, sel) ? sizeNow(sel) : null}
            onSize={(w, h) => setBoxSize(sel, w, h)}
            onDelete={canRemove(base.source, sel) ? () => remove(sel) : undefined}
            canPutBack={(() => {
              const o = origins.current.get(sel);
              return !!o && (o.left !== selPos.left || o.top !== selPos.top);
            })()}
            onSet={(left, top) => setPos(sel, left, top)}
            onPutBack={() => {
              const o = origins.current.get(sel);
              if (o) setPos(sel, o.left, o.top);
            }}
          />
        ) : (
          <>
            <span className="hint">{Icon.text}Right-click, long-press or double-tap text to edit it</span>
            <span className="hint">{Icon.move}Drag panels and camera boxes to move them</span>
            <span className="hint">{Icon.plus}Add text, a title bar or a camera box, or drop a picture in</span>
          </>
        )}
        {sel !== null && onAir && <span className="live-note"><span className="dot" />On air: it moves on stream as you drag</span>}
        <div style={{ flex: 1 }} />
        {sel !== null ? <span className="quiet">Snaps to edges · 8 px grid · arrows nudge{base && isSlot(base, sel) ? " · corners keep 16:9 (Shift: free)" : ""}</span> : <span className="path">{path}</span>}
      </footer>
      {picker && (
        <AssetPicker
          org={org}
          library={library}
          replacing={picker.replace !== null}
          onClose={() => setPicker(null)}
          onPick={(asset) => {
            const { replace } = picker;
            setPicker(null);
            const src = libraryUrl(asset.path).replace(/'/g, "%27");
            if (replace !== null) {
              // Undo puts back what the file has (the menu offers Replace only when that's a library path).
              const b = baseRef.current;
              change({ id: replace, src }, b ? valueIn(b, { id: replace, src }) : null);
              return;
            }
            // Its natural size keeps its shape.
            const img = new Image();
            img.onload = () => add("image", { src, width: img.naturalWidth, height: img.naturalHeight });
            img.onerror = () => add("image", { src, width: 1, height: 1 });
            img.src = src;
          }}
        />
      )}
    </div>
  );
}

const ADD_ITEMS: { kind: AddKind; label: string; hint: string; icon: "text" | "title" | "image" | "camera" | "screen" | "guest" }[] = [
  { kind: "text", label: "Text", hint: "A line to retype", icon: "text" },
  { kind: "title", label: "Title bar", hint: "A name and a line", icon: "title" },
  { kind: "image", label: "Image", hint: "From your assets, or upload one", icon: "image" },
  { kind: "camera", label: "Camera box", hint: "OBS puts the camera in it", icon: "camera" },
  { kind: "screen", label: "Screen box", hint: "OBS puts the screen in it", icon: "screen" },
  { kind: "guest", label: "Guest box", hint: "For a guest or second camera", icon: "guest" },
];

/** The scene's name, retyped in place: Return saves, Esc cancels. */
function TitleField({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (out: string | null) => {
    if (done.current) return;
    done.current = true;
    // Unchanged (or emptied) is a cancel: nothing to save.
    onDone(out === null || !out.trim() || out.trim() === value.trim() ? null : out);
  };
  return (
    <input ref={ref} className="title-input" aria-label="Scene name" value={v} maxLength={120} enterKeyHint="done"
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(v);
        if (e.key === "Escape") finish(null);
      }}
      onBlur={() => finish(v)} />
  );
}

/** The org's images to choose from, and Upload. */
function AssetPicker({ org, library, replacing, onPick, onClose }: {
  org: string;
  library: Library | undefined;
  replacing: boolean;
  onPick: (asset: { path: string }) => void;
  onClose: () => void;
}) {
  const images = library?.assets.filter((a) => a.kind === "image") ?? [];
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const upload = (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    void attempt(async () => {
      try {
        const { saved } = await api.upload(org, [files[0]!]);
        if (saved[0]) onPick(saved[0]);
      } finally {
        setUploading(false);
      }
    });
  };
  return (
    <div className="modal-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal picker" role="dialog" aria-label={replacing ? "Replace image" : "Add an image"}>
        <h2>{replacing ? "Replace image" : "Add an image"}</h2>
        <p className="picker-note">From {library?.org.name ?? org}'s assets, or upload one{inApp ? " from Photos or Files" : ""}. You can also drop a picture straight onto the scene.</p>
        <div className="picker-grid">
          {images.map((a) => (
            <button key={a.path} type="button" className="picker-item" onClick={() => onPick(a)} aria-label={a.name}>
              <img src={libraryUrl(a.path)} alt="" loading="lazy" />
              <span>{a.name}</span>
            </button>
          ))}
          {images.length === 0 && <p className="empty">No images yet. Upload one: it goes into the org's assets.</p>}
        </div>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files)} />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={uploading} onClick={() => file.current?.click()}>{uploading ? "Uploading…" : inApp ? "Photos or Files…" : "Upload an image"}</button>
        </div>
      </div>
    </div>
  );
}

function PositionBar({ name, pos, size, canPutBack, onSet, onSize, onPutBack, onDelete }: {
  name: string;
  pos: Pos;
  size: Size | null;
  canPutBack: boolean;
  onSet: (left: number, top: number) => void;
  onSize: (width: number, height: number) => void;
  onPutBack: () => void;
  onDelete?: () => void;
}) {
  const [x, setX] = useState(String(pos.left));
  const [y, setY] = useState(String(pos.top));
  const [w, setW] = useState(String(size?.width ?? ""));
  const [h, setH] = useState(String(size?.height ?? ""));
  const bar = useRef<HTMLDivElement>(null);
  // Follow drags, resizes and nudges, except while someone is typing a number.
  useEffect(() => {
    if (bar.current?.contains(document.activeElement)) return;
    setX(String(pos.left));
    setY(String(pos.top));
    setW(String(size?.width ?? ""));
    setH(String(size?.height ?? ""));
  }, [pos.left, pos.top, size?.width, size?.height]);
  const reset = () => {
    setX(String(pos.left));
    setY(String(pos.top));
    setW(String(size?.width ?? ""));
    setH(String(size?.height ?? ""));
  };
  const cancelled = useRef(false);
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const l = Number(x), t = Number(y);
    if (!Number.isFinite(l) || !Number.isFinite(t) || x.trim() === "" || y.trim() === "") return reset();
    if (Math.abs(l) > 100_000 || Math.abs(t) > 100_000) {
      toast("That's far outside the scene (1920 × 1080)");
      return reset();
    }
    if (l !== pos.left || t !== pos.top) onSet(l, t);
    if (size) {
      const ww = Number(w), hh = Number(h);
      if (!Number.isFinite(ww) || !Number.isFinite(hh) || w.trim() === "" || h.trim() === "" || ww < MIN_SIZE || hh < MIN_SIZE || ww > 100_000 || hh > 100_000) {
        if (ww < MIN_SIZE || hh < MIN_SIZE) toast(`At least ${MIN_SIZE} px`);
        return reset();
      }
      if (ww !== size.width || hh !== size.height) onSize(ww, hh);
    }
  };
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") {
      reset();
      cancelled.current = true; // the blur below must not save what was typed
      (e.target as HTMLInputElement).blur();
    }
  };
  return (
    <div className="pos-bar" ref={bar} onBlur={(e) => {
      // Moving between the fields isn't done yet; leaving them is.
      if (!bar.current?.contains(e.relatedTarget as Node)) commit();
    }}>
      <b>{name}</b>
      <span className="sep" />
      <label>X<input inputMode="numeric" value={x} aria-label="X position" onChange={(e) => setX(e.target.value)} onKeyDown={onKey} /></label>
      <label>Y<input inputMode="numeric" value={y} aria-label="Y position" onChange={(e) => setY(e.target.value)} onKeyDown={onKey} /></label>
      {size && (
        <>
          <span className="sep" />
          <label>W<input inputMode="numeric" value={w} aria-label="Width" onChange={(e) => setW(e.target.value)} onKeyDown={onKey} /></label>
          <label>H<input inputMode="numeric" value={h} aria-label="Height" onChange={(e) => setH(e.target.value)} onKeyDown={onKey} /></label>
        </>
      )}
      <button type="button" className="btn ghost small" disabled={!canPutBack} onClick={onPutBack}>Put it back</button>
      {onDelete && <button type="button" className="btn ghost small" aria-label={`Delete the ${name.toLowerCase()}`} onClick={onDelete}>{Icon.trash}Delete</button>}
    </div>
  );
}
