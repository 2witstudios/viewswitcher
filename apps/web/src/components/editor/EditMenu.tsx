import { canRemove, nameOf, replaceableImage } from "@viewswitcher/shared";
import type { SceneBase } from "@viewswitcher/shared";
import { Icon } from "../icons";
import { SCENE_H, SCENE_W } from "./geometry";
import type { Hit } from "./frame-dom";

/** `at`: when a long-press opened it (the release of that press must not pick an item); 0 otherwise. */
export type MenuState = { x: number; y: number; hit: Hit; at: number };
const lower = (s: string) => s.replace(/^\w/, (c) => c.toLowerCase());

/** Right-click or long-press on the scene: Edit text, Copy text, Replace image, Move, Delete. */
export function EditMenu({ menu, base, scale, onClose, onEditText, onCopyText, onReplaceImage, onMove, onDelete }: {
  menu: MenuState;
  base: SceneBase;
  scale: number;
  onClose: () => void;
  onEditText: (id: number) => void;
  onCopyText: (id: number) => void;
  onReplaceImage: (id: number) => void;
  onMove: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const { hit } = menu;
  const target = hit.move ?? hit.image;
  return (
    <>
      {/* Closes on a new press, not on the click that ends the long-press that opened it. */}
      <button type="button" className="backdrop" aria-label="Close menu"
        onPointerDown={(e) => { e.preventDefault(); onClose(); }}
        onClick={() => performance.now() - menu.at > 400 && onClose()} />
      <div role="menu" aria-label="Edit options" className="ed-menu" style={{ left: Math.min(menu.x, SCENE_W * scale - 250), top: Math.max(4, Math.min(menu.y, SCENE_H * scale - 230)) }}
        onClickCapture={(e) => { if (performance.now() - menu.at < 350) e.stopPropagation(); }}>
        {hit.leaf !== null && (
          <>
            <button type="button" role="menuitem" className="first" onClick={() => onEditText(hit.leaf!)}>
              {Icon.pen}<span>Edit text</span><small>Double-tap</small>
            </button>
            <button type="button" role="menuitem" onClick={() => onCopyText(hit.leaf!)}>
              {Icon.copy}<span>Copy text</span>
            </button>
          </>
        )}
        {hit.image !== null && replaceableImage(base, hit.image) && (
          <button type="button" role="menuitem" className={hit.leaf === null ? "first" : ""} onClick={() => onReplaceImage(hit.image!)}>
            {Icon.image}<span>Replace image</span>
          </button>
        )}
        {(hit.leaf !== null || hit.image !== null) && hit.move !== null && <hr />}
        {hit.move !== null && (
          <button type="button" role="menuitem" className="quiet" onClick={() => onMove(hit.move!)}>
            {Icon.move}<span>Move the {lower(nameOf(base, hit.move))}</span>
          </button>
        )}
        {target !== null && canRemove(base.source, target) && (
          <button type="button" role="menuitem" className="quiet" onClick={() => onDelete(target)}>
            {Icon.trash}<span>Delete the {lower(nameOf(base, target))}</span><small>Delete</small>
          </button>
        )}
      </div>
    </>
  );
}

/** A picture dropped on an image: Replace this image, Add as a new image, or Cancel. */
export function DropChoiceMenu({ x, y, scale, onChoose }: { x: number; y: number; scale: number; onChoose: (choice: "replace" | "add" | null) => void }) {
  return (
    <>
      <button type="button" className="backdrop" aria-label="Cancel" onClick={() => onChoose(null)} />
      <div role="menu" aria-label="Dropped on an image" className="ed-menu" style={{ left: Math.min(x, SCENE_W * scale - 250), top: Math.max(4, Math.min(y, SCENE_H * scale - 170)) }}>
        <button type="button" role="menuitem" className="first" onClick={() => onChoose("replace")}>
          {Icon.image}<span>Replace this image</span>
        </button>
        <button type="button" role="menuitem" onClick={() => onChoose("add")}>
          {Icon.plus}<span>Add as a new image</span>
        </button>
        <hr />
        <button type="button" role="menuitem" className="quiet" onClick={() => onChoose(null)}><span>Cancel</span></button>
      </div>
    </>
  );
}
