import { useNavigate } from "@tanstack/react-router";
import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { sceneUrl, useLive } from "../lib/live";
import { tileReloads } from "../lib/stagger";
import { DECK, isUprightPhone, UPRIGHT, useMedia } from "../lib/media";
import { SCENE_SANDBOX } from "../lib/scene-frame";
import { PencilIcon } from "./icons";
import { Menu, type MenuItem, MoreIcon } from "./ui";

/** Open the scene editor on `path`; `rename`: with the name ready to retype (a fresh copy). */
export function useOpenEditor(): (path: string, opts?: { rename?: boolean; replace?: boolean }) => void {
  const navigate = useNavigate();
  return (path, { rename, replace } = {}) =>
    void navigate({ to: "/$org/edit", params: { org: path.split("/")[0]! }, search: rename ? { path, rename: true } : { path }, replace });
}

/** The 1920×1080 scene scaled to its box's width: 280 px on a desktop, half a phone's width (MAC-27).
 *  A callback ref, so a box that mounts later (the on-air cover once something goes on air) is observed too. */
function useCoverScale<T extends HTMLElement>(): (el: T | null) => void {
  const [el, setEl] = useState<T | null>(null);
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => el.style.setProperty("--cover-scale", String(el.clientWidth / 1920)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return setEl;
}

/** How far outside the screen a tile starts its scene, so one scrolled to is usually ready. */
const NEAR_SCREEN = "300px";

/** Whether `el` is on screen or near it (callback-ref style, like useCoverScale). Without IntersectionObserver, always. */
function useNearScreen(el: HTMLElement | null): boolean {
  const [near, setNear] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setNear(entries.at(-1)!.isIntersecting), { rootMargin: NEAR_SCREEN });
    io.observe(el);
    return () => io.disconnect();
  }, [el]);
  return near;
}

const onScreen = (el: HTMLElement | null) => {
  const r = el?.getBoundingClientRect();
  return !!r && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
};

/**
 * The url a tile's frame shows. A change to the tile's own file loads straight away; a change to the
 * shared theme only (every tile's url at once) waits its turn in tileReloads. Off screen there's no
 * frame, so the new url is simply taken.
 */
function useTileSrc(path: string, el: HTMLElement | null, near: boolean): string {
  const wanted = useLive((l) => sceneUrl(path, l.versions, true));
  const own = useLive((l) => l.versions[path] ?? 0);
  const [src, setSrc] = useState(wanted);
  const shownOwn = useRef(own);
  useEffect(() => {
    if (wanted === src) return;
    const take = () => {
      shownOwn.current = own;
      setSrc(wanted);
    };
    if (!near || own !== shownOwn.current) return take();
    return tileReloads.request(take, () => onScreen(el));
  }, [wanted, near]);
  return src;
}

/** Upright on a phone (PHONE-3): what's on air, large, above the scenes. Mounted only there, so the
 *  Mac, the iPad and the deck don't load and run a hidden copy of the on-air scene. */
export function OnAirHero() {
  const onAir = useLive((l) => (l.connected ? l.state?.onAir : null));
  const src = useLive((l) => (onAir ? sceneUrl(onAir.path, l.versions, true) : null));
  const box = useCoverScale<HTMLDivElement>();
  const shown = isUprightPhone({ upright: useMedia(UPRIGHT), deck: useMedia(DECK) });
  if (!shown || !onAir || !src) return null;
  return (
    <section className="onair-hero" aria-label="On air">
      <div className="cover live" ref={box}>
        <iframe title={onAir.label} src={src} sandbox={SCENE_SANDBOX} tabIndex={-1} />
        <span className="badge">ON AIR</span>
      </div>
      <span className="label">{onAir.label}</span>
    </section>
  );
}

/** An album-style cover: a live, scaled render of the scene file while it's on screen. */
export function SceneTile({ label, path, live, badge, onActivate, onEdit, editChoices, menu }: {
  label: string;
  path: string;
  live?: boolean;
  badge?: string;
  /** Primary action (put on air). Without one, clicking opens the menu. */
  onActivate?: () => void;
  /** The pencil beside •••: opens the editor. */
  onEdit?: () => void;
  /** Instead of opening straight away, the pencil asks which (e.g. this stream or every stream). */
  editChoices?: MenuItem[];
  menu: MenuItem[];
}) {
  const [box, setBox] = useState<HTMLButtonElement | null>(null);
  const scale = useCoverScale<HTMLButtonElement>();
  const cover = useCallback((el: HTMLButtonElement | null) => (setBox(el), scale(el)), [scale]);
  // A scene runs only while its tile is on screen or near it (a stream page on an iPad can hold
  // dozens); away from it the cover is an empty box of the same size.
  const near = useNearScreen(box);
  const src = useTileSrc(path, box, near);
  const [open, setOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const openMenu = (e?: MouseEvent) => {
    e?.preventDefault();
    setOpen(true);
  };
  return (
    <div className="tile">
      <button
        type="button"
        ref={cover}
        className={`cover${live ? " live" : ""}`}
        aria-label={onActivate ? `Put ${label} on air` : `Options for ${label}`}
        onClick={onActivate ?? (() => openMenu())}
        onContextMenu={openMenu}
      >
        {near && <iframe title={label} src={src} sandbox={SCENE_SANDBOX} tabIndex={-1} />}
        {live ? <span className="badge">ON AIR</span> : badge ? <span className="badge quiet">{badge}</span> : null}
      </button>
      <div className="tile-meta">
        <div className="names">
          <span className="label">{label}</span>
          <span className="file">{path}</span>
        </div>
        {(onEdit || editChoices) && (
          <button type="button" className="more edit" aria-label={`Edit ${label}`} aria-haspopup={editChoices ? "menu" : undefined} aria-expanded={editChoices ? choosing : undefined}
            onClick={() => (editChoices ? setChoosing(true) : onEdit?.())}>
            <PencilIcon />
          </button>
        )}
        <button type="button" className="more" aria-label={`Options for ${label}`} aria-haspopup="menu" aria-expanded={open} onClick={() => openMenu()}>
          <MoreIcon />
        </button>
      </div>
      {open && <Menu label={label} items={menu} onClose={() => setOpen(false)} />}
      {choosing && editChoices && <Menu label={`Edit ${label}`} items={editChoices} onClose={() => setChoosing(false)} />}
    </div>
  );
}
