import type { Box } from "@viewswitcher/shared";
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";
import { CORNERS, cornerPoint, onStage } from "./geometry";
import type { Guides } from "./mode";
import type { DropAt } from "./usePictureDrop";

type Handlers = {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerLeave: () => void;
  onDragOver: (e: ReactDragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: ReactDragEvent<HTMLDivElement>) => void;
  onDrop: (e: ReactDragEvent<HTMLDivElement>) => void;
  onContextMenu: (e: ReactMouseEvent<HTMLDivElement>) => void;
};

/**
 * The layer over the scene that takes every press, and draws what the editor shows on it: hover and
 * selection outlines, corner handles, snap guides, position and size readouts, where a dropped
 * picture would land, and what someone else changed. Rects are in scene pixels.
 */
export function EditorOverlay({ overlayRef, scale: s, typing, handlers, hover, selected, handles, drag, resizing, drop, marks }: {
  overlayRef: RefObject<HTMLDivElement | null>;
  scale: number;
  typing: boolean;
  handlers: Handlers;
  hover: Box | null;
  selected: Box | null;
  /** Corner handles on the selected box (it has a size to change). */
  handles: boolean;
  drag: { left: number; top: number; guides: Guides } | null;
  resizing: { width: number; height: number } | null;
  drop: { at: DropAt; image: Box | null } | null;
  marks: { id: number; rect: Box }[];
}) {
  const px = (b: Box) => onStage(b, s);
  return (
    <div ref={overlayRef} className={`editor-overlay${typing ? " passive" : ""}${drag ? " dragging" : ""}`} {...handlers}>
      {hover && !drag && <div className="ed-hover" style={px(hover)} />}
      {selected && !typing && <div className={`ed-selected${drag ? " lifted" : ""}`} style={px(selected)} />}
      {selected && !typing && !drag && handles && CORNERS.map((c) => {
        const p = cornerPoint(selected, c);
        return <div key={c} data-corner={c} className={`ed-handle ${c}`} aria-hidden="true" style={{ left: p.x * s, top: p.y * s }} />;
      })}
      {resizing && selected && (
        <div className="ed-readout" style={{ left: (selected.x + selected.w) * s + 14, top: (selected.y + selected.h) * s - 30 }}>{resizing.width} × {resizing.height}</div>
      )}
      {drag && drag.guides.x.map((x) => <div key={`x${x}`} className="ed-guide v" style={{ left: x * s }} />)}
      {drag && drag.guides.y.map((y) => <div key={`y${y}`} className="ed-guide h" style={{ top: y * s }} />)}
      {drag && selected && (
        <div className="ed-readout" style={{ left: (selected.x + selected.w) * s + 10, top: selected.y * s }}>x {drag.left} · y {drag.top}</div>
      )}
      {drop && (drop.image ? (
        <div className="ed-drop replace" style={px(drop.image)}><span>Replace this image?</span></div>
      ) : (
        <div className="ed-drop-point" style={{ left: drop.at.x * s, top: drop.at.y * s }}><span>Drop to add the picture here</span></div>
      ))}
      {marks.map(({ id, rect }) => (
        <div key={id} className="ed-changed" style={px(rect)}><span>CHANGED</span></div>
      ))}
    </div>
  );
}
