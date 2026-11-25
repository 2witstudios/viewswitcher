// The scene editor: retype text in place, drag and resize panels and camera boxes, add and delete
// things and swap images, live on stream when the scene is on air. Every finished change (Return,
// letting go, choosing from Add) is saved as a source-range patch on the server; the browser DOM is
// never written back. See packages/shared/src/html-scan.ts.
//
// This file wires the parts in ./editor together: what the editor is doing (mode.ts), the file and
// its saves (useSceneDocument), the frame's DOM (frame-dom.ts), drag and resize maths (geometry.ts),
// live previews, dropped pictures and Undo, and the bars and menus around the scene.
import {
  canRemove, collapseHtmlSpace, DEVICE_SLOTS, editKind, freeSlotName, idsAfter, isSlot, isStructural, markFor, markupFor, movableAround, movableIn, nameOf, posIn,
  replaceableImage, restoreFor, retarget, sceneRoot, scanElements, setTitle, shortDate, sizeIn, slotsIn, textOf, titleIn, valueIn,
} from "@viewswitcher/shared";
import type { AddKind, InsertEdit, Library, RemoveEdit, SceneEdit } from "@viewswitcher/shared";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, SceneConflict } from "../lib/api";
import { useLibrary } from "../lib/library";
import { libraryUrl, useLive } from "../lib/live";
import { modalOpen } from "../lib/modal";
import { EDITOR_SANDBOX } from "../lib/scene-frame";
import { openAgentSheet } from "./AgentSheet";
import { AssetPicker } from "./editor/AssetPicker";
import { ConflictCard, StuckCard } from "./editor/ConflictCard";
import { DropChoiceMenu, EditMenu, type MenuState } from "./editor/EditMenu";
import { EditorBanner, EditorHeader } from "./editor/EditorHeader";
import { EditorOverlay } from "./editor/EditorOverlay";
import {
  applyEdit, applyStructure, beginTyping, endTyping, frameDoc, type Hit, hitAt, type IdBaseline, idBaseline, idsMatch, listenKeys, listenWhileTyping, nodeOf, prepareFrame,
  rectIn, setShownText, shownPos, shownSize, shownVersion, textShown,
} from "./editor/frame-dom";
import { clampSize, isArrow, nudge as nudged, type Pos, samePos, SCENE_H, SCENE_W, type Size, sameSize } from "./editor/geometry";
import { canStart, canUndo } from "./editor/mode";
import { PositionBar } from "./editor/PositionBar";
import { useLivePreview } from "./editor/useLivePreview";
import { useGestures } from "./editor/useGestures";
import { useMode } from "./editor/useMode";
import { usePictureDrop } from "./editor/usePictureDrop";
import { useSceneDocument } from "./editor/useSceneDocument";
import { type UndoEntry, useUndo } from "./editor/useUndo";
import { attempt, toast } from "./ui";

const NUDGE_SAVE_MS = 500;

/** Arrow-key moves of one box, saved together once the keys stop. */
type Nudge = { id: number; before: SceneEdit; last: Pos; gen: number; timer?: ReturnType<typeof setTimeout> };

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

const fieldFocused = () => !!(document.activeElement as HTMLElement | null)?.closest?.("input, textarea, select");

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

  const modes = useMode();
  const { mode, dispatch } = modes;
  const undo = useUndo();

  const [frameKey, setFrameKey] = useState(0);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  readyRef.current = ready;
  const frame = useRef<HTMLIFrameElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const [selected, setSelected] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [, setTick] = useState(0);
  const redraw = () => setTick((t) => t + 1);
  /** Where each movable element was when the editor opened, for Put it back. */
  const origins = useRef(new Map<number, Pos>());
  const frameMismatches = useRef(0);
  /** How the frame's ids lined up with the file when it loaded; checked after every add or delete. */
  const ids0 = useRef<IdBaseline | null>(null);
  const nudge = useRef<Nudge | null>(null);

  const reloadFrame = () => {
    setReady(false);
    setFrameKey((k) => k + 1);
  };

  const doc = useSceneDocument(path, {
    mode: modes,
    // Anything in progress refers to ids from the old version: end it (unsaved, it's stale anyway).
    // Undo entries name elements of the old version: they can't be replayed on this one.
    onLoaded: (b) => {
      origins.current = new Map();
      b.els.forEach((e) => {
        const p = posIn(b, e.id);
        if (p) origins.current.set(e.id, { left: p.left, top: p.top });
      });
      setMenu(null);
      setSelected(null);
      setHover(null);
      gestures.drop();
      clearTimeout(nudge.current?.timer);
      nudge.current = null;
      undo.clear();
      reloadFrame();
    },
    onStuck: () => setReady(false),
    onSaveFailed: () => undo.clear(),
    quiet: () => !gesture.current && !nudge.current && !fieldFocused() && !pictures.isUploading(),
  });
  const { base, baseRef, generation } = doc;

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const fit = () => setScale(Math.max(0.05, Math.min(el.clientWidth / SCENE_W, el.clientHeight / SCENE_H)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [base !== null]);

  // ------------------------------------------------------------ the scene's DOM (in the frame)

  const fd = () => frameDoc(frame.current);
  const rectOf = (id: number | null) => (ready ? rectIn(fd(), id) : null);
  const posNow = (id: number): Pos | null => {
    const b = baseRef.current;
    return b ? shownPos(fd(), id, posIn(b, id)) : null;
  };
  const sizeNow = (id: number): Size | null => {
    const b = baseRef.current;
    return b ? shownSize(fd(), id, sizeIn(b, id)) : null;
  };
  const applyDom = (edit: SceneEdit) => {
    applyEdit(fd(), edit);
    redraw();
  };
  const hit = (x: number, y: number) => hitAt(fd(), baseRef.current, x, y);

  // ------------------------------------------------------------ live preview (on air only) and saving

  const live = useLivePreview({
    path,
    onAir: () => onAirRef.current,
    base: () => baseRef.current,
    generation: () => generation.current,
    unfinished: () => {
      const m = modes.now();
      const g = gesture.current;
      const n = nudge.current;
      if (m.kind === "typing") return { edit: { id: m.id, text: m.original }, gen: m.gen };
      if (g?.drag) return { edit: { id: g.drag.id, ...g.drag.start }, gen: g.drag.gen };
      if (g?.resize) return { edit: { id: g.resize.id, ...g.resize.start }, gen: g.resize.gen };
      return n ? { edit: n.before, gen: n.gen } : null;
    },
    beforeLeave: () => flushNudgeRef.current(),
  });
  const preview = live.preview;

  const save = (edits: SceneEdit[], undoEntries: UndoEntry[] = [], madeIn = generation.current) => {
    live.saved();
    // Undo is in the order changes were made, so its entry goes on now, not when the server answers.
    // (A conflict or failed save reloads, and every reload clears Undo.) A change from before a
    // reload gets none: its ids are the old version's.
    if (madeIn === generation.current) undo.push(undoEntries);
    return doc.saver(edits, undoEntries, madeIn);
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
    if (!now || samePos(now, next)) {
      applyDom(next);
      return;
    }
    change(next, { id, ...now });
  };

  const setBoxSize = (id: number, width: number, height: number) => {
    const now = sizeNow(id);
    const next = { id, ...clampSize(width, height) };
    if (!now || sameSize(now, next)) return;
    change(next, { id, ...now });
  };

  // ------------------------------------------------------------ adding and deleting

  /**
   * Add or delete an element. Unlike other changes, element ids after it change, so it's saved first
   * (after every change before it), and only then does the scene on screen follow: the frame's DOM
   * gets the same change and its data-vs ids renumbered to match the saved file (checked, and the
   * frame loaded again if they don't). The stream gets the saved file, which swaps in without a
   * transition. Undo entries below it were made in the ids from before it, and are only reached once
   * Undo has taken it back out, so they stay right.
   *
   * Resolves to the inserted element's id (null for a delete) once saved and shown; to false if it didn't happen.
   */
  const structural = async (edit: InsertEdit | RemoveEdit, record = true): Promise<{ added: number | null } | false> => {
    if (modes.now().kind === "typing") finishEdit(true);
    if (dispatch({ t: "structure" }).kind !== "saving-structure") return false;
    try {
      flushNudge();
      // The edit's ids are from now: if waiting reloads the scene (a failed save before it), they may name something else.
      const madeIn = generation.current;
      await doc.saver.idle();
      if (generation.current !== madeIn) return false;
      const b = baseRef.current;
      if (!b || modes.now().kind !== "saving-structure" || doc.pendingConflict.current) return false;
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
      const saved = baseRef.current!;
      doc.layout.current++;
      // The frame follows the saved file. If it's loading again meanwhile, it loads the saved file anyway.
      const d = fd();
      if (d && readyRef.current) {
        applyStructure(d, edit, ids);
        if (!ids0.current || !idsMatch(d, saved, ids0.current)) reloadFrame();
      } else reloadFrame();
      // Everything that names an element by id moves to the new ids.
      const moved = new Map<number, Pos>();
      origins.current.forEach((pos, id) => {
        const m = ids.map(id);
        if (m !== null) moved.set(m, pos);
      });
      origins.current = moved;
      if (record) undo.push([{ before: undoIt, after: edit }]);
      setHover(null);
      setMenu(null);
      if (ids.added !== null) {
        const p = posIn(saved, ids.added);
        if (p) origins.current.set(ids.added, p);
        setSelected(movableIn(saved, ids.added) ? ids.added : null);
      } else setSelected((sel) => (sel === null ? null : ids.map(sel)));
      redraw();
      return { added: ids.added };
    } finally {
      dispatch({ t: "end", kind: "saving-structure" });
    }
  };

  const add = (kind: AddKind, image?: { src: string; width: number; height: number }, at?: { x: number; y: number }) => {
    setAddOpen(false);
    const b = baseRef.current;
    if (!b) return;
    const root = sceneRoot(b.source);
    if (root === null) return toast("This scene can't take new items", { label: "Edit with AI", run: openAgentSheet });
    const slots = slotsIn(b);
    const slot = DEVICE_SLOTS[kind] ? freeSlotName(DEVICE_SLOTS[kind]!, slots) : null;
    void structural({ id: root, insert: markupFor(kind, { slots, image, at }) }).then((done) => {
      if (done && slot && onAirRef.current) toast(`On air · OBS source "${slot}"`);
      else if (done && slot && slot !== DEVICE_SLOTS[kind]) toast(`OBS source "${slot}"`);
    });
  };

  const remove = (id: number) => {
    const b = baseRef.current;
    if (!b) return;
    if (!canRemove(b.source, id)) return toast("Can't delete this here", { label: "Edit with AI", run: openAgentSheet });
    setMenu(null);
    void structural({ id, remove: true }).then((done) => done && toast("Deleted. Undo puts it back."));
  };

  const doUndo = () => {
    if (!canUndo(modes.now())) return;
    // A nudge still waiting to save is the latest change: Undo cancels it (nothing was saved yet).
    const n = nudge.current;
    if (n) {
      clearTimeout(n.timer);
      nudge.current = null;
      applyDom(n.before);
      preview(n.before, n.gen);
      return;
    }
    const last = undo.last;
    if (!last) return;
    undo.pop();
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
    if (!canStart(modes.now())) return;
    const original = beginTyping(fd(), id);
    if (original === null) return;
    setMenu(null);
    setSelected(null);
    setHover(null);
    dispatch({ t: "type", id, original, gen: generation.current });
  };

  const finishEdit = (commit: boolean) => {
    const m = modes.now();
    if (m.kind !== "typing") return;
    // Finished: leaving now mustn't put the old text back on air.
    dispatch({ t: "end", kind: "typing" });
    const d = fd();
    const typed = endTyping(d, m.id);
    if (typed === null || !baseRef.current) return;
    // Collapse only HTML whitespace, as the server does: a non-breaking space is part of the text.
    const collapse = collapseHtmlSpace;
    // Browsers type a space at the start or end of editable text as U+00A0. That's typing, not text:
    // drop it at an edge unless the original had one there.
    const original = collapse(m.original);
    let text = collapse(typed);
    if (!original.startsWith(" ")) text = text.replace(/^ +/, "");
    if (!original.endsWith(" ")) text = text.replace(/ +$/, "");
    text = collapse(text);
    const before = { id: m.id, text: original };
    if (!commit || !text.trim()) {
      if (commit && !text.trim()) toast("Text can't be empty: put back what was there");
      setShownText(d, m.id, m.original);
      preview({ id: m.id, text: m.original }, m.gen);
      redraw();
      return;
    }
    if (text === before.text) {
      setShownText(d, m.id, m.original);
      redraw();
      return;
    }
    setShownText(d, m.id, text);
    save([{ id: m.id, text }], [{ before, after: { id: m.id, text } }], m.gen);
    redraw();
  };
  const finishRef = useRef(finishEdit);
  finishRef.current = finishEdit;

  const typing = mode.kind === "typing" ? mode : null;
  useEffect(() => {
    if (!typing) return;
    const { id, gen } = typing;
    return listenWhileTyping(fd(), id, {
      input: (text) => {
        preview({ id, text }, gen);
        redraw();
      },
      enter: () => finishRef.current(true),
      escape: () => finishRef.current(false),
      outside: () => finishRef.current(true),
    });
  }, [typing?.id, typing?.gen]);

  // ------------------------------------------------------------ pointer: select, drag, long-press, double-tap (useGestures)

  const toScene = (e: { clientX: number; clientY: number }) => {
    const r = overlay.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scaleRef.current, y: (e.clientY - r.top) / scaleRef.current };
  };
  /** Just off the finger, so the touch that opened a menu can't land on an item. */
  const menuAt = (e: { clientX: number; clientY: number }) => {
    const r = overlay.current!.getBoundingClientRect();
    return { x: e.clientX - r.left + 10, y: e.clientY - r.top + 10 };
  };
  const openMenu = (cx: number, cy: number, h: Hit, longPress = false) => {
    if (h.leaf === null && h.move === null) return;
    setMenu({ ...menuAt({ clientX: cx, clientY: cy }), hit: h, at: longPress ? performance.now() : 0 });
    if (h.move !== null) setSelected(h.move);
  };

  const gestures = useGestures({
    mode: modes,
    overlay,
    ready,
    selected,
    scale: () => scaleRef.current,
    base: () => baseRef.current,
    generation: () => generation.current,
    toScene,
    hit,
    node: (id) => nodeOf(fd(), id),
    rectOf,
    posNow,
    sizeNow,
    applyDom,
    preview,
    save,
    flushNudge: () => flushNudge(),
    startEdit,
    select: setSelected,
    setHover,
    closeMenu: () => setMenu(null),
    openMenu,
  });
  const gesture = gestures.gesture;

  // ------------------------------------------------------------ keyboard: nudges, undo, escape

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
  /** Drop a nudge not saved yet, and put the stream back. */
  const cancelNudge = () => {
    const n = nudge.current;
    if (!n) return;
    clearTimeout(n.timer);
    nudge.current = null;
    applyDom(n.before);
    preview(n.before, n.gen);
  };

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return; // already handled (e.g. Return/Esc in the text being typed)
    // Edit with AI (or another modal) is open over the editor: its keys are its own.
    if (modalOpen(document)) return;
    const m = modes.now();
    switch (m.kind) {
      case "saving-structure":
        // Element ids are about to change, so nothing may start on the old ones.
        if (isArrow(e.key) || e.key === "Delete" || e.key === "Backspace" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z")) e.preventDefault();
        return;
      // The picture picker or a drop's Replace / Add names an image by id: the scene stays as it is until it closes.
      case "picking":
        if (e.key === "Escape") dispatch({ t: "end", kind: "picking" });
        return;
      case "dropChoice":
        if (e.key === "Escape") pictures.choose(null);
        return;
      case "typing":
        if (e.key === "Escape") finishEdit(false);
        return;
      case "idle":
        break;
      default:
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
    if ((e.key === "Delete" || e.key === "Backspace") && selected !== null) {
      e.preventDefault();
      remove(selected);
      return;
    }
    if (!isArrow(e.key) || selected === null) return;
    e.preventDefault();
    const now = posNow(selected);
    if (!now) return;
    if (!nudge.current || nudge.current.id !== selected) {
      flushNudge();
      nudge.current = { id: selected, before: { id: selected, ...now }, last: now, gen: generation.current };
    }
    const next = { id: selected, ...nudged(now, e.key, e.shiftKey)! };
    applyDom(next);
    preview(next, nudge.current.gen);
    nudge.current.last = { left: next.left, top: next.top };
    clearTimeout(nudge.current.timer);
    nudge.current.timer = setTimeout(flushNudge, NUDGE_SAVE_MS);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", onKey);
    const stop = listenKeys(ready ? fd() : null, onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      stop();
    };
  }, [ready, frameKey]);

  // ------------------------------------------------------------ dropping or choosing a picture

  const pictures = usePictureDrop({
    org,
    mode: modes,
    base: () => baseRef.current,
    generation: () => generation.current,
    layout: () => doc.layout.current,
    ready,
    replaceableAt: (p) => {
      const b = baseRef.current;
      const id = hit(p.x, p.y).image;
      return b && id !== null && replaceableImage(b, id) ? id : null;
    },
    toScene,
    menuAt,
    replace: (edit, before) => change(edit, before),
    add: (image, at) => add("image", image, at),
    finishTyping: () => finishEdit(true),
    deselect: () => setSelected(null),
  });

  // ------------------------------------------------------------ conflict

  const applyAgain = async () => {
    const c = modes.now();
    if (c.kind !== "conflict") return;
    const { edits, prev } = c;
    const latest = baseRef.current ?? c.latest; // the newest version, if it moved on again
    const pairs = edits.map((e) => ({ e, m: retarget(prev.source, latest.source, e) }));
    dispatch({ t: "end", kind: "conflict" });
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
    const c = modes.now();
    if (c.kind !== "conflict") return;
    // The stream may still show the preview of the change that didn't save: put the latest back.
    for (const e of c.edits) {
      const m = retarget(c.prev.source, c.latest.source, e);
      const v = m && valueIn(c.latest, m);
      if (v) preview(v);
    }
    dispatch({ t: "end", kind: "conflict" });
  };

  // ------------------------------------------------------------ leaving, rename, Edit a copy

  const leave = async () => {
    // Done or Back while typing saves what was typed, as Return would. Then wait for the saves to
    // land: if one hits a conflict, stay so it can be dealt with.
    finishEdit(true);
    flushNudge();
    if (!(await doc.settle())) return;
    if (window.history.length > 1) router.history.back();
    else navigate({ to: "/$org", params: { org } });
  };

  const [naming, setNaming] = useState(rename);
  /** The new name until the library catches up. */
  const [named, setNamed] = useState<string | null>(null);
  // The file's own <title> first: right after a duplicate, the library hasn't caught up with the copy yet.
  const shownTitle = named ?? (base && titleIn(base)) ?? place.title;
  const doRename = (name: string) =>
    attempt(async () => {
      setNaming(false);
      const clean = name.trim();
      if (!clean || clean === shownTitle || modes.now().kind === "saving-structure") return;
      finishEdit(true);
      flushNudge();
      if (!(await doc.settle())) return;
      const b = baseRef.current;
      if (!b) return;
      if (dispatch({ t: "structure" }).kind !== "saving-structure") return;
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
        if (els.length === b.els.length) doc.setBase({ source, hash: r.hash, els });
        else await doc.load();
        toast(`Renamed: ${clean}`);
      } catch (e) {
        if (!(e instanceof SceneConflict)) throw e;
        toast("The scene changed meanwhile, so it wasn't renamed. Try again.");
        await doc.load();
      } finally {
        dispatch({ t: "end", kind: "saving-structure" });
      }
    });

  const editCopy = () =>
    attempt(async () => {
      // Nothing unfinished may land on the on-air scene on the way out: drop a pending nudge (and put
      // the stream back), and cancel typing.
      cancelNudge();
      finishEdit(false);
      // Changes already made are saved before copying, so the copy has them (and a conflict stays here).
      if (!(await doc.settle())) return;
      const { name } = await api.duplicate(path);
      const copyPath = `${path.slice(0, path.lastIndexOf("/"))}/${name}.html`;
      toast("Editing a copy, not on air");
      navigate({ to: "/$org/edit", params: { org }, search: { path: copyPath }, replace: true });
    });

  // ------------------------------------------------------------ render

  if (doc.loadError) {
    return (
      <div className="editor">
        <EditorHeader crumb={place.crumb} title={place.title} onBack={leave} />
        <p className="empty" style={{ padding: 24 }}>{doc.loadError}</p>
      </div>
    );
  }

  const conflict = mode.kind === "conflict" ? mode : null;
  const sel = selected !== null && base && movableIn(base, selected) ? selected : null;
  const selRect = rectOf(sel);
  const hoverRect = hover !== null && hover !== typing?.id ? rectOf(hover) : null;
  const editRect = typing ? rectOf(typing.id) : null;
  // The typing bar sits above the panel being typed in, so it covers none of it.
  const editBox = (() => {
    if (!typing || !base) return editRect;
    const up = movableAround(base, typing.id);
    return (up !== null ? rectOf(up) : null) ?? editRect;
  })();
  const marks = conflict && ready
    ? [...new Set(conflict.changed.map((id) => markFor(conflict.latest, id)).filter((x): x is number => x !== null))].flatMap((id) => {
        const rect = rectOf(id);
        return rect ? [{ id, rect }] : [];
      })
    : [];
  const s = scale;
  const px = (b: { x: number; y: number; w: number; h: number }) => ({ left: b.x * s, top: b.y * s, width: b.w * s, height: b.h * s });
  const selPos = sel !== null ? posNow(sel) : null;
  const idle = mode.kind === "idle";

  return (
    <div className="editor">
      <EditorHeader
        crumb={place.crumb}
        title={shownTitle}
        onBack={leave}
        open={{
          naming,
          canRename: base !== null,
          renameDisabled: mode.kind === "saving-structure",
          onRenameStart: () => setNaming(true),
          onRename: (v) => (v === null ? setNaming(false) : void doRename(v)),
          onAir,
          addDisabled: !ready || !idle,
          addOpen,
          setAddOpen,
          onAdd: (kind) => {
            setAddOpen(false);
            if (kind === "image") pictures.openPicker(null);
            else add(kind);
          },
          undoDisabled: !undo.entries.length || !canUndo(mode),
          onUndo: doUndo,
          onOpenFile: () => void attempt(() => api.open(path)),
          leaving: mode.kind === "leaving",
        }}
      />
      <EditorBanner isTemplate={isTemplate} onAir={onAir} onEditCopy={editCopy} />

      <div className="editor-area" ref={area}>
        {base && (
          <div className={`editor-stage${onAir ? " live" : ""}`} style={{ width: SCENE_W * s, height: SCENE_H * s }}>
            <iframe
              key={frameKey}
              ref={frame}
              title={`${place.title} (editing)`}
              // The scene's DOM, without its scripts: a pack's code never runs where the editor can
              // reach it. ?inert serves it with a CSP sandbox that has no scripts either.
              src={`${libraryUrl(path)}?edit&inert&preview&k=${frameKey}`}
              sandbox={EDITOR_SANDBOX}
              onLoad={() => {
                const d = fd();
                if (d) prepareFrame(d);
                // The frame loads the scene on its own: if the file changed since the base was read, its ids
                // aren't the base's. Read both again.
                // (With no version stamp at all there's nothing to check.)
                const b = baseRef.current;
                const stamp = d ? shownVersion(d) : undefined;
                if (b && stamp !== undefined && stamp !== b.hash) {
                  // Once is a file that just changed; again means it keeps changing: stop and offer Reload.
                  if (frameMismatches.current++ === 0) void doc.load();
                  else doc.setStuck("This scene keeps changing while it opens.");
                  return;
                }
                frameMismatches.current = 0;
                ids0.current = d && b ? idBaseline(d, b) : null;
                setReady(true);
                redraw();
              }}
              style={{ transform: `scale(${s})`, pointerEvents: typing ? "auto" : "none" }}
            />
            <EditorOverlay
              overlayRef={overlay}
              scale={s}
              typing={!!typing}
              handlers={{
                ...gestures.handlers,
                onPointerLeave: () => setHover(null),
                onDragOver: pictures.onDragOver, onDragLeave: pictures.onDragLeave, onDrop: pictures.onDrop,
              }}
              hover={hoverRect}
              selected={selRect}
              handles={sel !== null && !!base && sizeIn(base, sel) !== null}
              drag={mode.kind === "dragging" ? mode : null}
              resizing={mode.kind === "resizing" ? mode : null}
              drop={pictures.dropAt && { at: pictures.dropAt, image: pictures.dropAt.image !== null ? rectOf(pictures.dropAt.image) : null }}
              marks={marks}
            />
            {typing && editRect && (
              <div className="ed-editing" style={px(editRect)} aria-hidden="true" />
            )}
            {typing && editRect && editBox && (
              <div className="typing-bar" style={{ left: Math.max(8, Math.min(editRect.x * s, SCENE_W * s - 330)), top: editBox.y * s > 60 ? editBox.y * s - 56 : Math.min((editBox.y + editBox.h) * s + 12, SCENE_H * s - 52) }}>
                <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => finishEdit(false)}>Cancel <small>Esc</small></button>
                <button type="button" className="save" onPointerDown={(e) => e.preventDefault()} onClick={() => finishEdit(true)}>Save <small>Return</small></button>
              </div>
            )}
            {mode.kind === "dropChoice" && <DropChoiceMenu x={mode.x} y={mode.y} scale={s} onChoose={pictures.choose} />}
            {pictures.uploading && <div className="ed-uploading" role="status">Adding the picture…</div>}
            {menu && base && (
              <EditMenu
                menu={menu}
                base={base}
                scale={s}
                onClose={() => setMenu(null)}
                onEditText={startEdit}
                onCopyText={(id) => {
                  setMenu(null);
                  void copyText(textShown(fd(), id)?.trim() ?? textOf(base.source, base.els[id]!));
                }}
                onReplaceImage={(id) => {
                  setMenu(null);
                  pictures.openPicker(id);
                }}
                onMove={(id) => {
                  setSelected(id);
                  setMenu(null);
                }}
                onDelete={remove}
              />
            )}
            {doc.stuck && (
              <StuckCard message={doc.stuck} onReload={() => {
                frameMismatches.current = 0;
                void doc.load();
              }} />
            )}
            {conflict && (
              <ConflictCard conflict={conflict} firstMark={marks[0]?.rect ?? null} onApplyAgain={() => void applyAgain()} onKeepNew={keepNew} />
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
              return !!o && !samePos(o, selPos);
            })()}
            onSet={(left, top) => setPos(sel, left, top)}
            onPutBack={() => {
              const o = origins.current.get(sel);
              if (o) setPos(sel, o.left, o.top);
            }}
          />
        ) : (
          null
        )}
        <div style={{ flex: 1 }} />
        {sel !== null ? base && isSlot(base, sel) && <span className="quiet">Shift: free aspect</span> : <span className="path">{path}</span>}
      </footer>
      {mode.kind === "picking" && (
        <AssetPicker
          org={org}
          library={library}
          replacing={mode.replace !== null}
          onClose={() => dispatch({ t: "end", kind: "picking" })}
          onPick={pictures.picked}
        />
      )}
    </div>
  );
}
