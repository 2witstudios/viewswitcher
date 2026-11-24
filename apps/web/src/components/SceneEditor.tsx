// The scene editor: retype text in place and drag panels and camera boxes, live on stream when the
// scene is on air. Every finished change (Return, letting go) is saved as a source-range patch on the
// server; the browser DOM is never written back. See packages/shared/src/html-scan.ts.
import { applyEdits, changedElements, positionOf, retarget, scanElements, shortDate, snapMove, textOf, untagForEdit } from "@viewswitcher/shared";
import type { Box, Library, ScannedElement, SceneEdit } from "@viewswitcher/shared";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, SceneConflict } from "../lib/api";
import { useLibrary } from "../lib/library";
import { libraryUrl, useLive } from "../lib/live";
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
type Hit = { leaf: number | null; move: number | null };
type Pos = { left: number; top: number };

const toBase = ({ html, hash }: { html: string; hash: string }): Base => {
  const source = untagForEdit(html);
  return { source, hash, els: scanElements(source) };
};
const posIn = (b: Base, id: number) => (b.els[id] ? positionOf(b.source, b.els[id]!) : null);
const movableIn = (b: Base, id: number) => !["html", "head", "body"].includes(b.els[id]?.tag ?? "html") && posIn(b, id) !== null;
/** The value an edit would put back: the element's text or position in `b`. */
function valueIn(b: Base, edit: SceneEdit): SceneEdit | null {
  const el = b.els[edit.id];
  if (!el) return null;
  if ("text" in edit) return el.leaf ? { id: edit.id, text: textOf(b.source, el) } : null;
  const p = posIn(b, edit.id);
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
  if (!el.leaf) return container(el);
  const word = /^h[1-6]$/.test(el.tag) ? "title" : el.tag === "p" ? "text" : "label";
  let up = el.parent;
  while (up !== null && !movableIn(b, up)) up = b.els[up]?.parent ?? null;
  return up === null ? word.replace(/^\w/, (c) => c.toUpperCase()) : `${container(b.els[up]!)} ${word}`;
}

function describe(b: Base, edit: SceneEdit) {
  return "text" in edit ? { what: nameOf(b, edit.id), value: edit.text } : { what: nameOf(b, edit.id), value: `x ${edit.left} · y ${edit.top}` };
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
  changed: <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 11-3-6.7" /><path d="M21 4v5h-5" /></svg>,
};

export function SceneEditor({ org, path }: { org: string; path: string }) {
  const navigate = useNavigate();
  const router = useRouter();
  const { data: library } = useLibrary(org);
  const { state } = useLive();
  const onAir = state?.onAir?.path === path;
  const onAirRef = useRef(onAir);
  onAirRef.current = onAir;
  const place = placeOf(library, path);

  const [base, setBaseState] = useState<Base | null>(null);
  const baseRef = useRef<Base | null>(null);
  const setBase = (b: Base) => {
    baseRef.current = b;
    setBaseState(b);
  };
  const [loadError, setLoadError] = useState("");
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
  const [, setTick] = useState(0);
  const redraw = () => setTick((t) => t + 1);
  /** Where each movable element was when the editor opened, for Put it back. */
  const origins = useRef(new Map<number, Pos>());
  /** Bumped on every (re)load: element ids from before a reload may name different elements now. */
  const generation = useRef(0);
  const conflictOpen = useRef(false);

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
      setReady(false);
      setFrameKey((k) => k + 1);
      return b;
    } catch (e) {
      setLoadError((e as Error).message);
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
  const applyDom = (edit: SceneEdit) => {
    const el = node(edit.id);
    if (!el) return;
    if ("text" in edit) el.textContent = edit.text;
    else {
      el.style.left = `${edit.left}px`;
      el.style.top = `${edit.top}px`;
    }
    redraw();
  };

  /** Element ids under a scene point: the text there, and the box that moves with it. */
  const hit = (x: number, y: number): Hit => {
    const b = baseRef.current;
    const d = doc();
    const out: Hit = { leaf: null, move: null };
    if (!b || !d) return out;
    let el: Element | null = d.elementFromPoint(x, y);
    while (el) {
      const id = Number((el as HTMLElement).dataset?.vs);
      if (Number.isInteger(id) && b.els[id]) {
        if (out.leaf === null && out.move === null && b.els[id]!.leaf) out.leaf = id;
        if (out.move === null && movableIn(b, id)) out.move = id;
      }
      el = el.parentElement;
    }
    return out;
  };

  // ------------------------------------------------------------ live preview (on air only) and saving

  const pending = useRef(new Map<number, SceneEdit>());
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The latest live change not saved yet (typing, mid-drag, nudging); resent as a heartbeat. */
  const unsaved = useRef<SceneEdit | null>(null);
  const preview = (edit: SceneEdit) => {
    unsaved.current = edit;
    if (!onAirRef.current) return;
    pending.current.set(edit.id * 2 + ("text" in edit ? 0 : 1), edit);
    if (previewTimer.current) return;
    const flush = () => {
      const edits = [...pending.current.values()];
      pending.current.clear();
      if (!edits.length) {
        previewTimer.current = undefined;
        return;
      }
      const hash = baseRef.current?.hash ?? "";
      for (const e of edits) api.previewScene(path, hash, e).catch(() => {});
      previewTimer.current = setTimeout(flush, PREVIEW_MS);
    };
    flush();
  };
  useEffect(() => () => clearTimeout(previewTimer.current), []);

  // Save edits one at a time against the version their ids came from (see lib/scene-saver.ts).
  const saverRef = useRef<((edits: SceneEdit[], undo: UndoEntry[], madeIn?: number) => Promise<void>) | null>(null);
  if (!saverRef.current) {
    saverRef.current = createSceneSaver<Base, UndoEntry[]>({
      base: () => baseRef.current,
      generation: () => generation.current,
      send: (hash, edits) => api.editScene(path, hash, edits),
      isConflict: (e) => e instanceof SceneConflict,
      onSaved: (b, edits, hash, undoEntries) => {
        const source = applyEdits(b.source, edits);
        setBase({ source, hash, els: scanElements(source) });
        if (undoEntries.length) setUndo((u) => [...u, ...undoEntries]);
      },
      onConflict: async (edits, b) => {
        const latest = await load();
        if (!latest) return;
        setUndo([]);
        setSelected(null);
        conflictOpen.current = true;
        setConflict({ edits, changed: changedElements(b.source, latest.source), prev: b, latest });
      },
      // Queued behind the change that hit the conflict: their ids are from the same old version,
      // so they join it on the conflict screen and go through Apply my change again with it.
      onStale: (edits) => {
        if (conflictOpen.current) setConflict((c) => (c ? { ...c, edits: [...c.edits, ...edits] } : c));
        else toast("The scene reloaded, so your last change didn't save");
      },
      onError: async (e) => {
        toast(`Couldn't save: ${(e as Error).message}`);
        setUndo([]);
        await load();
      },
    });
  }
  const save = (edits: SceneEdit[], undoEntries: UndoEntry[] = [], madeIn?: number) => {
    unsaved.current = null;
    return saverRef.current!(edits, undoEntries, madeIn);
  };

  /** Change an element now: on screen, live on stream, and saved. */
  const change = (edit: SceneEdit, before: SceneEdit | null) => {
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

  const doUndo = () => {
    const last = undo[undo.length - 1];
    if (!last) return;
    setUndo((u) => u.slice(0, -1));
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
    setEditing(null);
    if (!el || !b) return;
    el.removeAttribute("contenteditable");
    el.blur();
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    const before = { id: editing.id, text: editing.original.replace(/\s+/g, " ").trim() };
    if (!commit || !text) {
      if (commit && !text) toast("Text can't be empty: put back what was there");
      el.textContent = editing.original;
      preview({ id: editing.id, text: editing.original });
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
      preview({ id: editing.id, text: el.textContent ?? "" });
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
      const text = (e.clipboardData?.getData("text/plain") ?? "").replace(/\s+/g, " ");
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
    const n = nudge.current;
    const e = editingRef.current;
    const back: SceneEdit | null = e ? { id: e.id, text: e.original } : g ? { id: g.id, ...g.start } : n ? n.before : null;
    if (back) api.previewSceneBeacon(path, b.hash, back);
  };
  useEffect(() => {
    const onHide = () => revertLive.current();
    window.addEventListener("pagehide", onHide);
    // Keep an unsaved change alive on stream while the editor is here (the program page drops one that goes quiet).
    const beat = setInterval(() => {
      const u = unsaved.current;
      const b = baseRef.current;
      if (u && b && onAirRef.current && (editingRef.current || gesture.current?.drag || nudge.current)) api.previewScene(path, b.hash, u).catch(() => {});
    }, HEARTBEAT_MS);
    return () => {
      window.removeEventListener("pagehide", onHide);
      clearInterval(beat);
      revertLive.current();
    };
  }, [path]);

  // ------------------------------------------------------------ pointer: select, drag, long-press, double-tap

  type Gesture = {
    pointerId: number; cx: number; cy: number; hit: Hit; moved: boolean; long: boolean; timer?: ReturnType<typeof setTimeout>;
    drag?: { id: number; start: Pos; rect: Box; others: Box[]; x0: number; y0: number; last: Pos; gen: number };
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
    if (editing || conflict || !ready || e.button > 0) return;
    setMenu(null);
    const p = toScene(e);
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
      g.drag = { id, start, rect, others, x0: p.x, y0: p.y, last: start, gen: generation.current };
      setSelected(id);
      setHover(null);
    }
    const d = g.drag;
    if (!d) return;
    const p = toScene(e);
    const s = snapMove({ ...d.rect, x: d.rect.x + p.x - d.x0, y: d.rect.y + p.y - d.y0 }, d.others, { threshold: SNAP_PX / scaleRef.current });
    const next = { left: Math.round(d.start.left + s.x - d.rect.x), top: Math.round(d.start.top + s.y - d.rect.y) };
    if (next.left === d.last.left && next.top === d.last.top) return;
    d.last = next;
    applyDom({ id: d.id, ...next });
    preview({ id: d.id, ...next });
    setDrag({ id: d.id, ...next, guides: s.guides });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    clearTimeout(g.timer);
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
    if (g.drag) {
      applyDom({ id: g.drag.id, ...g.drag.start });
      preview({ id: g.drag.id, ...g.drag.start });
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
  useEffect(() => () => flushNudgeRef.current(), []);

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return; // already handled (e.g. Return/Esc in the text being typed)
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
      if (menu) setMenu(null);
      else setSelected(null);
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
    preview(next);
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

  // ------------------------------------------------------------ conflict

  const applyAgain = () => {
    if (!conflict) return;
    const { edits, prev, latest } = conflict;
    const moved = edits.map((e) => retarget(prev.source, latest.source, e));
    conflictOpen.current = false;
    setConflict(null);
    if (moved.some((m) => m === null)) {
      toast("That part of the scene isn't in the new version, so your change can't go there");
      return;
    }
    const again = moved as SceneEdit[];
    const entries = again.flatMap((e) => {
      const before = valueIn(latest, e);
      return before ? [{ before, after: e }] : [];
    });
    again.forEach((e) => {
      applyDom(e);
      preview(e);
    });
    save(again, entries);
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

  const leave = () => {
    flushNudge();
    if (window.history.length > 1) router.history.back();
    else navigate({ to: "/$org", params: { org } });
  };
  const editCopy = () =>
    attempt(async () => {
      const { name } = await api.duplicate(path);
      const copyPath = `${path.slice(0, path.lastIndexOf("/"))}/${name}.html`;
      toast("Editing a copy: it isn't on air");
      navigate({ to: "/$org/edit", params: { org }, search: { path: copyPath }, replace: true });
    });

  // ------------------------------------------------------------ render

  if (loadError) {
    return (
      <div className="editor">
        <header className="editor-top">
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
      <header className="editor-top">
        <button type="button" className="icon-btn" aria-label="Back" onClick={leave}>{Icon.back}</button>
        <div className="editor-titles">
          <span className="crumb">{place.crumb}</span>
          <span className="title">{place.title}</span>
        </div>
        {onAir && <span className="onair-pill"><span className="dot" />ON AIR</span>}
        <div style={{ flex: 1 }} />
        <button type="button" className="btn ghost" disabled={!undo.length || !!conflict} onClick={doUndo}>{Icon.undo}Undo</button>
        <button type="button" className="btn" onClick={() => attempt(() => api.open(path))}>{Icon.code}Open the file</button>
        <button type="button" className="btn primary" onClick={leave}>Done</button>
      </header>

      {onAir && (
        <div className="live-banner" role="status">
          <span className="dot" />
          <span><b>Live.</b> This scene is on air: what you type and drag shows on stream as you do it.</span>
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
              src={`${libraryUrl(path)}?edit&preview&k=${frameKey}`}
              onLoad={() => {
                // Editor-only styling inside the scene (never saved): no browser focus ring while typing.
                const d = frame.current?.contentDocument;
                if (d?.head && !d.getElementById("vs-editor-style")) {
                  const style = d.createElement("style");
                  style.id = "vs-editor-style";
                  style.textContent = "[contenteditable]{outline:none;caret-color:currentColor;cursor:text}[contenteditable]::selection{background:rgba(244,245,247,.28)}";
                  d.head.append(style);
                }
                // The frame loads the scene on its own: if the file changed since the base was read, its ids
                // aren't the base's. Read both again.
                const b = baseRef.current;
                if (b && d?.documentElement.dataset.vsHash !== b.hash) {
                  void load();
                  return;
                }
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
              {drag && drag.guides.x.map((x) => <div key={`x${x}`} className="ed-guide v" style={{ left: x * s }} />)}
              {drag && drag.guides.y.map((y) => <div key={`y${y}`} className="ed-guide h" style={{ top: y * s }} />)}
              {drag && selRect && (
                <div className="ed-readout" style={{ left: (selRect.x + selRect.w) * s + 10, top: selRect.y * s }}>x {drag.left} · y {drag.top}</div>
              )}
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
            {menu && base && (
              <>
                {/* Closes on a new press, not on the click that ends the long-press that opened it. */}
                <button type="button" className="backdrop" aria-label="Close menu"
                  onPointerDown={(e) => { e.preventDefault(); setMenu(null); }}
                  onClick={() => performance.now() - menu.at > 400 && setMenu(null)} />
                <div role="menu" aria-label="Edit options" className="ed-menu" style={{ left: Math.min(menu.x, W * s - 250), top: Math.min(menu.y, H * s - 170) }}
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
                  {menu.hit.leaf !== null && menu.hit.move !== null && <hr />}
                  {menu.hit.move !== null && (
                    <button type="button" role="menuitem" className="quiet" onClick={() => {
                      setSelected(menu.hit.move);
                      setMenu(null);
                    }}>
                      {Icon.move}<span>Move the {nameOf(base, menu.hit.move).replace(/^\w/, (c) => c.toLowerCase())}</span><small>or drag it</small>
                    </button>
                  )}
                </div>
              </>
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
                  <button type="button" className="btn primary" onClick={applyAgain}>Apply my change again</button>
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
          </>
        )}
        {sel !== null && onAir && <span className="live-note"><span className="dot" />On air: it moves on stream as you drag</span>}
        <div style={{ flex: 1 }} />
        {sel !== null ? <span className="quiet">Snaps to edges · 8 px grid · arrows nudge</span> : <span className="path">{path}</span>}
      </footer>
    </div>
  );
}

function PositionBar({ name, pos, canPutBack, onSet, onPutBack }: {
  name: string;
  pos: Pos;
  canPutBack: boolean;
  onSet: (left: number, top: number) => void;
  onPutBack: () => void;
}) {
  const [x, setX] = useState(String(pos.left));
  const [y, setY] = useState(String(pos.top));
  const bar = useRef<HTMLDivElement>(null);
  // Follow drags and nudges, except while someone is typing a number.
  useEffect(() => {
    if (bar.current?.contains(document.activeElement)) return;
    setX(String(pos.left));
    setY(String(pos.top));
  }, [pos.left, pos.top]);
  const cancelled = useRef(false);
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const l = Number(x), t = Number(y);
    if (!Number.isFinite(l) || !Number.isFinite(t) || x.trim() === "" || y.trim() === "") {
      setX(String(pos.left));
      setY(String(pos.top));
      return;
    }
    if (l !== pos.left || t !== pos.top) onSet(l, t);
  };
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") {
      setX(String(pos.left));
      setY(String(pos.top));
      cancelled.current = true; // the blur below must not save what was typed
      (e.target as HTMLInputElement).blur();
    }
  };
  return (
    <div className="pos-bar" ref={bar} onBlur={(e) => {
      // Moving between X and Y isn't done yet; leaving the pair is.
      if (!bar.current?.contains(e.relatedTarget as Node)) commit();
    }}>
      <b>{name}</b>
      <span className="sep" />
      <label>X<input inputMode="numeric" value={x} aria-label="X position" onChange={(e) => setX(e.target.value)} onKeyDown={onKey} /></label>
      <label>Y<input inputMode="numeric" value={y} aria-label="Y position" onChange={(e) => setY(e.target.value)} onKeyDown={onKey} /></label>
      <button type="button" className="btn ghost small" disabled={!canPutBack} onClick={onPutBack}>Put it back</button>
    </div>
  );
}
