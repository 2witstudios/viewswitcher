import { useNavigate } from "@tanstack/react-router";
import { type MouseEvent, useState } from "react";
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
