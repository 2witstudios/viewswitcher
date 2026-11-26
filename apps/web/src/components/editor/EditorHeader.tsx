import type { AddKind } from "@viewswitcher/shared";
import { Icon } from "../icons";
import { TitleField } from "./TitleField";

/** Each kind's icon has the kind's own name. */
const ADD_ITEMS: { kind: AddKind; label: string; hint?: string }[] = [
  { kind: "text", label: "Text" },
  { kind: "title", label: "Title bar" },
  { kind: "image", label: "Image" },
  { kind: "camera", label: "Camera box", hint: "Camera source" },
  { kind: "screen", label: "Screen box", hint: "Screen source" },
  { kind: "guest", label: "Guest box", hint: "Guest or 2nd camera" },
];

/** The editor's top bar: Back, where the scene lives and its name, and (once it's open) Add, Undo, Open the file and Done. */
export function EditorHeader({ crumb, title, onBack, open }: {
  crumb: string;
  title: string;
  onBack: () => void;
  /** Missing while the scene couldn't be opened: only Back and the name. */
  open?: {
    naming: boolean;
    canRename: boolean;
    renameDisabled: boolean;
    onRenameStart: () => void;
    onRename: (name: string | null) => void;
    onAir: boolean;
    addDisabled: boolean;
    addOpen: boolean;
    setAddOpen: (open: boolean) => void;
    onAdd: (kind: AddKind) => void;
    undoDisabled: boolean;
    onUndo: () => void;
    onOpenFile: () => void;
    leaving: boolean;
  };
}) {
  return (
    <header className="editor-top" data-drag-region>
      <button type="button" className="icon-btn" aria-label="Back" onClick={onBack}>{Icon.back}</button>
      {!open ? (
        <div className="editor-titles"><span className="crumb">{crumb}</span><span className="title">{title}</span></div>
      ) : (
        <>
          <div className="editor-titles">
            <span className="crumb">{crumb}</span>
            {open.naming && open.canRename ? (
              <TitleField value={title} onDone={open.onRename} />
            ) : (
              <button type="button" className="title title-btn" title="Rename" aria-label={`Rename ${title}`} disabled={open.renameDisabled} onClick={open.onRenameStart}>
                {title}{Icon.pen}
              </button>
            )}
          </div>
          {open.onAir && <span className="onair-pill"><span className="dot" />ON AIR</span>}
          <div className="editor-spacer" style={{ flex: 1 }} />
          <div className="add-wrap">
            <button type="button" className="btn add-btn" aria-haspopup="menu" aria-expanded={open.addOpen} disabled={open.addDisabled}
              onClick={() => open.setAddOpen(!open.addOpen)}>{Icon.plus}Add</button>
            {open.addOpen && (
              <>
                <button type="button" className="backdrop" aria-label="Close menu" onClick={() => open.setAddOpen(false)} />
                <div role="menu" aria-label="Add to the scene" className="ed-menu add-menu">
                  {ADD_ITEMS.map((it) => (
                    <button key={it.kind} type="button" role="menuitem" onClick={() => open.onAdd(it.kind)}>
                      {Icon[it.kind]}<span>{it.label}{it.hint && <small>{it.hint}</small>}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button type="button" className="btn ghost" disabled={open.undoDisabled} onClick={open.onUndo}>{Icon.undo}Undo</button>
          <button type="button" className="btn open-file" onClick={open.onOpenFile}>{Icon.code}Open the file</button>
          <button type="button" className="btn primary" disabled={open.leaving} onClick={onBack}>{open.leaving ? "Saving…" : "Done"}</button>
        </>
      )}
    </header>
  );
}

/** Under the top bar: a template's note, or the live banner with Edit a copy instead. */
export function EditorBanner({ isTemplate, onAir, onEditCopy }: { isTemplate: boolean; onAir: boolean; onEditCopy: () => void }) {
  if (onAir) {
    return (
      <div className="live-banner" role="status">
        <span className="dot" />
        <span><b>Live.</b> Changes show on stream as you make them.</span>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={onEditCopy}>Edit a copy instead</button>
      </div>
    );
  }
  return isTemplate ? (
    <div className="note-banner" role="note">
      <b>Template.</b> Existing scenes made from it won't change.
    </div>
  ) : null;
}
