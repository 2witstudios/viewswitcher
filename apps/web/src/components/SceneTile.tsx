import { type MouseEvent, useState } from "react";
import { sceneUrl, useLive } from "../lib/live";
import { Menu, type MenuItem, MoreIcon } from "./ui";

/** An album-style cover: a live, scaled render of the scene file. */
export function SceneTile({ label, path, live, badge, onActivate, menu }: {
  label: string;
  path: string;
  live?: boolean;
  badge?: string;
  /** Primary action (put on air). Without one, clicking opens the menu. */
  onActivate?: () => void;
  menu: MenuItem[];
}) {
  const { versions } = useLive();
  const [open, setOpen] = useState(false);
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
        <iframe title={label} src={sceneUrl(path, versions, true)} loading="lazy" tabIndex={-1} />
        {live ? <span className="badge">ON AIR</span> : badge ? <span className="badge quiet">{badge}</span> : null}
      </button>
      <div className="tile-meta">
        <div className="names">
          <span className="label">{label}</span>
          <span className="file">{path}</span>
        </div>
        <button type="button" className="more" aria-label={`Options for ${label}`} aria-haspopup="menu" aria-expanded={open} onClick={() => openMenu()}>
          <MoreIcon />
        </button>
      </div>
      {open && <Menu label={label} items={menu} onClose={() => setOpen(false)} />}
    </div>
  );
}
