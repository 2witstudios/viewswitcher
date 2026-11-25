import { type FormEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// The V of screens (scripts/brand/icons.ts writes mark.svg from the logo), white for the dark UI.
export function Mark({ size = 22 }: { size?: number }) {
  return <img src="/mark.svg" width={size} height={size} alt="" />;
}

export const MoreIcon = () => (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="#a3a8b5"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
);
export const PlusIcon = ({ size = 14 }: { size?: number }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#a3a8b5" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
);

export type MenuItem = { label: string; hint?: string; run: () => void | Promise<void> } | "divider" | { heading: string };

/** A popover menu anchored inside a `.tile`. */
export function Menu({ label, items, onClose }: { label: string; items: MenuItem[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <button type="button" className="backdrop" aria-label="Close menu" onClick={onClose} />
      <div role="menu" aria-label={label} className="menu">
        {items.map((item, i) =>
          item === "divider" ? (
            <hr key={i} />
          ) : "heading" in item ? (
            <span key={i} className="menu-heading" role="presentation">{item.heading}</span>
          ) : (
            <button
              key={i}
              type="button"
              role="menuitem"
              onClick={async () => {
                onClose();
                await item.run();
              }}
            >
              {item.label}
              {item.hint && <small>{item.hint}</small>}
            </button>
          ),
        )}
      </div>
    </>
  );
}

export function Modal({ title, children, submitLabel, onSubmit, onClose }: {
  title: string;
  children: ReactNode;
  submitLabel: string;
  onSubmit: () => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEscape(wrap, () => !busy && onClose());
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Overlay>
    <div className="modal-wrap" ref={wrap} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" role="dialog" aria-label={title} onSubmit={submit}>
        <h2>{title}</h2>
        {children}
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{submitLabel}</button>
        </div>
      </form>
    </div>
    </Overlay>
  );
}

/** Escape closes a dialog, like Cancel, and stops there, so the sideways library drawer behind stays open.
 *  Only the topmost dialog (the last .modal-wrap: Edit with AI can open over this one) takes it, and never
 *  while an input method is composing (Escape cancels the conversion there). */
export function useEscape(wrap: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      const layers = document.querySelectorAll(".modal-wrap");
      if (!wrap.current || layers[layers.length - 1] !== wrap.current) return;
      e.stopImmediatePropagation();
      close();
    };
    // Capture, so the dialog sees it before the drawer's own Escape listener.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  });
}

/**
 * A dialog's layer, rendered into <body>: a modal opened from the sidebar would otherwise sit in the
 * sidebar's stacking context (it's position: sticky on wide screens) under the page.
 */
export const Overlay = ({ children }: { children: ReactNode }) => createPortal(children, document.body);

export type ToastAction = { label: string; run: () => void };
type Toast = { text: string; action?: ToastAction };

let toastSet: ((t: Toast | null) => void) | null = null;
/** A short message; with an action, a button in it (and it stays a little longer, to be pressed). */
export function toast(text: string, action?: ToastAction) {
  toastSet?.({ text, action });
}
export function Toaster() {
  const [t, setT] = useState<Toast | null>(null);
  useEffect(() => {
    toastSet = setT;
    return () => void (toastSet = null);
  }, []);
  useEffect(() => {
    if (!t) return;
    const timer = setTimeout(() => setT(null), t.action ? 6000 : 2600);
    return () => clearTimeout(timer);
  }, [t]);
  if (!t) return null;
  return (
    <div className="toast" role="status">
      {t.text}
      {t.action && (
        <button type="button" className="toast-action" onClick={() => (setT(null), t.action!.run())}>{t.action.label}</button>
      )}
    </div>
  );
}

/** Run an action, toast its error instead of throwing. */
export async function attempt(fn: () => Promise<unknown>, done?: string) {
  try {
    await fn();
    if (done) toast(done);
  } catch (e) {
    toast((e as Error).message);
  }
}
