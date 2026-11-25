import { useNavigate } from "@tanstack/react-router";
import { type MouseEvent, useEffect, useState } from "react";
import { sceneUrl, useLive } from "../lib/live";
import { DECK, isUprightPhone, UPRIGHT, useMedia } from "../lib/media";
import { SCENE_SANDBOX } from "../lib/scene-frame";
import { Menu, type MenuItem, MoreIcon } from "./ui";

/** Open the scene editor on `path`; `rename`: with the name ready to retype (a fresh copy). */
export function useOpenEditor(): (path: string, opts?: { rename?: boolean; replace?: boolean }) => void {
  const navigate = useNavigate();
  return (path, { rename, replace } = {}) =>
    void navigate({ to: "/$org/edit", params: { org: path.split("/")[0]! }, search: rename ? { path, rename: true } : { path }, replace });
}

export const PencilIcon = () => (
  <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13 7l4 4" /></svg>
);

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

/** Upright on a phone (PHONE-3): what's on air, large, above the scenes. Mounted only there, so the
 *  Mac, the iPad and the deck don't load and run a hidden copy of the on-air scene. */
export function OnAirHero() {
  const { state, versions, connected } = useLive();
  const onAir = state?.onAir;
  const box = useCoverScale<HTMLDivElement>();
  const shown = isUprightPhone({ upright: useMedia(UPRIGHT), deck: useMedia(DECK) });
  if (!shown || !onAir || !connected) return null;
  return (
    <section className="onair-hero" aria-label="On air">
      <div className="cover live" ref={box}>
        <iframe title={onAir.label} src={sceneUrl(onAir.path, versions, true)} sandbox={SCENE_SANDBOX} tabIndex={-1} />
        <span className="badge">ON AIR</span>
      </div>
      <span className="label">{onAir.label}</span>
    </section>
  );
}

/** An album-style cover: a live, scaled render of the scene file. */
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
  const { versions } = useLive();
  const cover = useCoverScale<HTMLButtonElement>();
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
        <iframe title={label} src={sceneUrl(path, versions, true)} sandbox={SCENE_SANDBOX} loading="lazy" tabIndex={-1} />
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
