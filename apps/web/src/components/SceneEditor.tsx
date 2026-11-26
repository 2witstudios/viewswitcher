// The scene editor: retype text in place, drag and resize panels and camera boxes, add and delete
// things and swap images, live on stream when the scene is on air. Every finished change (Return,
// letting go, choosing from Add) is saved as a source-range patch on the server; the browser DOM is
// never written back. See packages/shared/src/html-scan.ts.
//
// This is the composition root: it wires the parts in ./editor together and lays them out. What the
// editor is doing is one mode (mode.ts); the file and its saves are useSceneDocument; the frame's DOM
// is frame-dom.ts; each kind of change has its own hook.
import { canRemove, isSlot, isStructural, libraryUrl, markFor, movableAround, movableIn, nameOf, parseLibraryPath, posIn, replaceableImage, sizeIn, textOf } from "@viewswitcher/shared";
import type { SceneEdit } from "@viewswitcher/shared";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import { api, copy } from "../lib/api";
import { useLibrary } from "../lib/library";
import { useLive } from "../lib/live";
import { placeOf } from "../lib/place";
import { EDITOR_SANDBOX } from "../lib/scene-frame";
import { AssetPicker } from "./editor/AssetPicker";
import { ConflictCard, StuckCard } from "./editor/ConflictCard";
import { DropChoiceMenu, EditMenu, type MenuState } from "./editor/EditMenu";
import { EditorBanner, EditorHeader } from "./editor/EditorHeader";
import { EditorOverlay } from "./editor/EditorOverlay";
import { applyEdit, frameDoc, type Hit, hitAt, type IdBaseline, idBaseline, nodeOf, prepareFrame, rectIn, shownPos, shownSize, shownVersion, textShown } from "./editor/frame-dom";
import { clampSize, onStage, type Pos, samePos, sameSize, SCENE_H, SCENE_W, type Size } from "./editor/geometry";
import { canUndo } from "./editor/mode";
import { PositionBar } from "./editor/PositionBar";
import { useAddDelete } from "./editor/useAddDelete";
import { useConflictActions } from "./editor/useConflictActions";
import { isField, useEditorKeys } from "./editor/useEditorKeys";
import { useGestures } from "./editor/useGestures";
import { useLiveEdit } from "./editor/useLiveEdit";
import { useMode } from "./editor/useMode";
import { useNudge } from "./editor/useNudge";
import { usePictureDrop } from "./editor/usePictureDrop";
import { useRename } from "./editor/useRename";
import { useSceneDocument } from "./editor/useSceneDocument";
import { useTextEditing } from "./editor/useTextEditing";
import { type UndoEntry, useUndo } from "./editor/useUndo";
import { attempt, toast } from "./ui";


export function SceneEditor({ org, path, rename = false }: { org: string; path: string; /** Open with the name ready to retype (a fresh copy). */ rename?: boolean }) {
  const navigate = useNavigate();
  const router = useRouter();
  const { data: library } = useLibrary(org);
  const onAir = useLive((l) => l.state?.onAir?.path === path);
  const onAirRef = useRef(onAir);
  onAirRef.current = onAir;
  const place = placeOf(library, path);
  const isTemplate = parseLibraryPath(path).kind === "template";

  const modes = useMode();
  const { mode, dispatch } = modes;
  const undo = useUndo();

  // ------------------------------------------------------------ the stage and the frame

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
  /** Menus, selection and hover name elements by id: they go when a version loads or typing starts. */
  const clearPointers = () => {
    setMenu(null);
    setSelected(null);
    setHover(null);
  };
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
      clearPointers();
      gestures.drop();
      nudges.drop();
      undo.clear();
      reloadFrame();
    },
    onConflictFound: () => {
      text.finish(true);
      nudges.flush();
    },
    onStuck: () => setReady(false),
    onSaveFailed: () => undo.clear(),
    quiet: () => !gestures.gesture.current && !nudges.pending() && !isField(document.activeElement) && !pictures.isUploading(),
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

  // ------------------------------------------------------------ showing, saving and undoing changes

  const live = useLiveEdit({
    path,
    onAir: () => onAirRef.current,
    base: () => baseRef.current,
    generation: () => generation.current,
    unfinished: () => {
      const m = modes.now();
      const g = gestures.gesture.current;
      if (m.kind === "typing") return { edit: { id: m.id, text: m.original }, gen: m.gen };
      if (g?.drag) return { edit: { id: g.drag.id, ...g.drag.start }, gen: g.drag.gen };
      if (g?.resize) return { edit: { id: g.resize.id, ...g.resize.start }, gen: g.resize.gen };
      return nudges.putBack();
    },
    beforeLeave: () => nudges.flush(),
  });
  const liveEdit = live.liveEdit;

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
    nudges.flush(); // a pending nudge saves first, so it can't land after (and over) this change
    applyDom(edit);
    liveEdit(edit);
    save([edit], before ? [{ before, after: edit }] : []);
  };

  // Undo and "is this a change?" compare with what's on screen now, not the last saved base: a save
  // may still be on its way.
  const setPos = (id: number, left: number, top: number) => {
    const now = posNow(id);
    const next = { id, left: Math.round(left), top: Math.round(top) };
    if (!now || samePos(now, next)) return applyDom(next);
    change(next, { id, ...now });
  };
  const setBoxSize = (id: number, width: number, height: number) => {
    const now = sizeNow(id);
    const next = { id, ...clampSize(width, height) };
    if (!now || sameSize(now, next)) return;
    change(next, { id, ...now });
  };

  const nudges = useNudge({ generation: () => generation.current, posNow, applyDom, liveEdit, save });

  const text = useTextEditing({
    mode: modes,
    frame: fd,
    generation: () => generation.current,
    open: () => baseRef.current !== null,
    liveEdit,
    save,
    redraw,
    onStart: clearPointers,
  });
  const typing = text.typing;

  const edits = useAddDelete({
    mode: modes,
    current: () => baseRef.current,
    generation: () => generation.current,
    conflictPending: () => doc.pendingConflict.current !== null,
    waitForSaves: () => doc.saver.idle(),
    save,
    pushUndo: undo.push,
    shownFrame: () => (readyRef.current ? fd() : null),
    ids0,
    reloadFrame,
    finishTyping: () => text.finish(true),
    flushNudge: () => nudges.flush(),
    origins,
    select: setSelected,
    clearPointers: () => {
      setHover(null);
      setMenu(null);
    },
    redraw,
    onAir: () => onAirRef.current,
  });

  const doUndo = () => {
    if (!canUndo(modes.now())) return;
    // A nudge still waiting to save is the latest change: Undo cancels it (nothing was saved yet).
    if (nudges.cancel()) return;
    const last = undo.last;
    if (!last) return;
    undo.pop();
    if (isStructural(last.before)) return void edits.structural(last.before, false);
    change(last.before, null);
  };

  // ------------------------------------------------------------ pointer, keys, pictures

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
    liveEdit,
    save,
    flushNudge: () => nudges.flush(),
    startEdit: text.start,
    select: setSelected,
    setHover,
    closeMenu: () => setMenu(null),
    openMenu,
  });

  const pictures = usePictureDrop({
    org,
    mode: modes,
    base: () => baseRef.current,
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
    add: (image, at) => edits.add("image", image, at),
    finishTyping: () => text.finish(true),
    deselect: () => setSelected(null),
  });

  useEditorKeys({
    mode: modes,
    frame: fd,
    ready,
    frameKey,
    selected,
    undo: doUndo,
    escape: () => {
      if (addOpen) setAddOpen(false);
      else if (menu) setMenu(null);
      else setSelected(null);
    },
    remove: edits.remove,
    nudge: nudges.step,
    cancelTyping: () => text.finish(false),
    closePicker: () => dispatch({ t: "end", kind: "picking" }),
    closeDropChoice: () => pictures.choose(null),
  });

  const conflicts = useConflictActions({ mode: modes, current: () => baseRef.current, change, liveEdit, structural: edits.structural });

  // ------------------------------------------------------------ leaving, rename, Edit a copy

  /** Done or Back while typing saves what was typed, as Return would; then every save lands. False if one hit a conflict: stay so it can be dealt with. */
  const settle = (then?: () => void) => {
    text.finish(true);
    nudges.flush();
    return doc.settle(then);
  };
  const leave = async () => {
    // A picture still uploading goes in first ("Adding the picture…" says so meanwhile).
    await pictures.settled();
    if (!(await settle())) return;
    if (window.history.length > 1) router.history.back();
    else navigate({ to: "/$org", params: { org } });
  };

  const names = useRename({
    path,
    initially: rename,
    mode: modes,
    base,
    current: () => baseRef.current,
    fallback: place.title,
    onAir: () => onAirRef.current,
    settle,
    setBase: doc.setBase,
    load: () => doc.load(),
    moved: (to) => navigate({ to: "/$org/edit", params: { org }, search: { path: to }, replace: true }),
  });

  const editCopy = () =>
    attempt(async () => {
      // Nothing unfinished may land on the on-air scene on the way out: drop a pending nudge (and put
      // the stream back), and cancel typing.
      nudges.cancel();
      text.finish(false);
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
  const px = (b: { x: number; y: number; w: number; h: number }) => onStage(b, s);
  const selPos = sel !== null ? posNow(sel) : null;
  const idle = mode.kind === "idle";

  return (
    <div className="editor">
      <EditorHeader
        crumb={place.crumb}
        title={names.title}
        onBack={leave}
        open={{
          naming: names.naming,
          canRename: base !== null,
          renameDisabled: mode.kind === "saving-structure",
          onRenameStart: names.startNaming,
          onRename: names.done,
          onAir,
          addDisabled: !ready || !idle,
          addOpen,
          setAddOpen,
          onAdd: (kind) => {
            setAddOpen(false);
            if (kind === "image") pictures.openPicker(null);
            else edits.add(kind);
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
                <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => text.finish(false)}>Cancel <small>Esc</small></button>
                <button type="button" className="save" onPointerDown={(e) => e.preventDefault()} onClick={() => text.finish(true)}>Save <small>Return</small></button>
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
                onEditText={text.start}
                onCopyText={(id) => {
                  setMenu(null);
                  void copy(textShown(fd(), id)?.trim() ?? textOf(base.source, base.els[id]!), "Copy this text:").then((done) => done && toast("Copied"));
                }}
                onReplaceImage={(id) => {
                  setMenu(null);
                  pictures.openPicker(id);
                }}
                onMove={(id) => {
                  setSelected(id);
                  setMenu(null);
                }}
                onDelete={edits.remove}
              />
            )}
            {doc.stuck && (
              <StuckCard message={doc.stuck} onReload={() => {
                frameMismatches.current = 0;
                void doc.load();
              }} />
            )}
            {conflict && (
              <ConflictCard conflict={conflict} firstMark={marks[0]?.rect ?? null} onApplyAgain={() => void conflicts.applyAgain()} onKeepNew={conflicts.keepNew} />
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
            onDelete={canRemove(base.source, sel) ? () => edits.remove(sel) : undefined}
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
