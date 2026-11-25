import { useNavigate } from "@tanstack/react-router";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { sceneUrl, useLive } from "../lib/live";
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

/** An album-style cover: a live, scaled render of the scene file. */
export function SceneTile({ label, path, live, cued, badge, onActivate, onEdit, editChoices, menu }: {
  label: string;
  path: string;
  live?: boolean;
  /** Cued on a phone (PHONE-2): Take puts it on air, and a tap on the cover cues or clears it. */
  cued?: boolean;
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
  // The 1920×1080 scene scaled to the cover's width: 280 px on a desktop, half a phone's width (MAC-27).
  const cover = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = cover.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => el.style.setProperty("--cover-scale", String(el.clientWidth / 1920)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
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
        className={`cover${live ? " live" : cued ? " cued" : ""}`}
        aria-label={!onActivate ? `Options for ${label}` : cued !== undefined ? (cued ? `Clear the cue on ${label}` : `Cue ${label}`) : `Put ${label} on air`}
        aria-pressed={cued}
        onClick={onActivate ?? (() => openMenu())}
        onContextMenu={openMenu}
      >
        <iframe title={label} src={sceneUrl(path, versions, true)} sandbox={SCENE_SANDBOX} loading="lazy" tabIndex={-1} />
        {live ? <span className="badge">ON AIR</span> : cued ? <span className="badge cued">CUED</span> : badge ? <span className="badge quiet">{badge}</span> : null}
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
