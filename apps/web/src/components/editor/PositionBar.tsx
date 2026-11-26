import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { toast } from "../ui";
import { MIN_SIZE, type Pos, type Size } from "./geometry";

/** The selected box's name, position and size, to type exactly; Put it back; Delete. */
export function PositionBar({ name, pos, size, canPutBack, onSet, onSize, onPutBack, onDelete }: {
  name: string;
  pos: Pos;
  size: Size | null;
  canPutBack: boolean;
  onSet: (left: number, top: number) => void;
  onSize: (width: number, height: number) => void;
  onPutBack: () => void;
  onDelete?: () => void;
}) {
  const [x, setX] = useState(String(pos.left));
  const [y, setY] = useState(String(pos.top));
  const [w, setW] = useState(String(size?.width ?? ""));
  const [h, setH] = useState(String(size?.height ?? ""));
  const bar = useRef<HTMLDivElement>(null);
  // Follow drags, resizes and nudges, except while someone is typing a number.
  useEffect(() => {
    if (bar.current?.contains(document.activeElement)) return;
    setX(String(pos.left));
    setY(String(pos.top));
    setW(String(size?.width ?? ""));
    setH(String(size?.height ?? ""));
  }, [pos.left, pos.top, size?.width, size?.height]);
  const reset = () => {
    setX(String(pos.left));
    setY(String(pos.top));
    setW(String(size?.width ?? ""));
    setH(String(size?.height ?? ""));
  };
  const cancelled = useRef(false);
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const l = Number(x), t = Number(y);
    if (!Number.isFinite(l) || !Number.isFinite(t) || x.trim() === "" || y.trim() === "") return reset();
    if (Math.abs(l) > 100_000 || Math.abs(t) > 100_000) {
      toast("That's far outside the scene (1920 × 1080)");
      return reset();
    }
    if (l !== pos.left || t !== pos.top) onSet(l, t);
    if (size) {
      const ww = Number(w), hh = Number(h);
      if (!Number.isFinite(ww) || !Number.isFinite(hh) || w.trim() === "" || h.trim() === "" || ww < MIN_SIZE || hh < MIN_SIZE || ww > 100_000 || hh > 100_000) {
        if (ww < MIN_SIZE || hh < MIN_SIZE) toast(`At least ${MIN_SIZE} px`);
        return reset();
      }
      if (ww !== size.width || hh !== size.height) onSize(ww, hh);
    }
  };
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") {
      reset();
      cancelled.current = true; // the blur below must not save what was typed
      (e.target as HTMLInputElement).blur();
    }
  };
  return (
    <div className="pos-bar" ref={bar} onBlur={(e) => {
      // Moving between the fields isn't done yet; leaving them is.
      if (!bar.current?.contains(e.relatedTarget as Node)) commit();
    }}>
      <b>{name}</b>
      <span className="sep" />
      <label>X<input inputMode="numeric" value={x} aria-label="X position" onChange={(e) => setX(e.target.value)} onKeyDown={onKey} /></label>
      <label>Y<input inputMode="numeric" value={y} aria-label="Y position" onChange={(e) => setY(e.target.value)} onKeyDown={onKey} /></label>
      {size && (
        <>
          <span className="sep" />
          <label>W<input inputMode="numeric" value={w} aria-label="Width" onChange={(e) => setW(e.target.value)} onKeyDown={onKey} /></label>
          <label>H<input inputMode="numeric" value={h} aria-label="Height" onChange={(e) => setH(e.target.value)} onKeyDown={onKey} /></label>
        </>
      )}
      <button type="button" className="btn ghost small" disabled={!canPutBack} onClick={onPutBack}>Put it back</button>
      {onDelete && <button type="button" className="btn ghost small" aria-label={`Delete the ${name.toLowerCase()}`} onClick={onDelete}>{Icon.trash}Delete</button>}
    </div>
  );
}
