import { useEffect, useRef, useState } from "react";

/** The scene's name, retyped in place: Return saves, Esc cancels. */
export function TitleField({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (out: string | null) => {
    if (done.current) return;
    done.current = true;
    // Unchanged (or emptied) is a cancel: nothing to save.
    onDone(out === null || !out.trim() || out.trim() === value.trim() ? null : out);
  };
  return (
    <input ref={ref} className="title-input" aria-label="Scene name" value={v} maxLength={120} enterKeyHint="done"
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(v);
        if (e.key === "Escape") finish(null);
      }}
      onBlur={() => finish(v)} />
  );
}
