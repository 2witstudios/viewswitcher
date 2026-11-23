import { type FormEvent, type ReactNode, useEffect, useState } from "react";

export function Mark({ size = 22 }: { size?: number }) {
  return <img src="/icon.svg" width={size} height={size} alt="" />;
}

export const MoreIcon = () => (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="#a7c09c"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
);
export const PlusIcon = ({ size = 14 }: { size?: number }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#a7c09c" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
);

export type MenuItem = { label: string; hint?: string; run: () => void | Promise<void> } | "divider";

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
    <div className="modal-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
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
  );
}

let toastSet: ((t: string) => void) | null = null;
export function toast(text: string) {
  toastSet?.(text);
}
export function Toaster() {
  const [text, setText] = useState("");
  useEffect(() => {
    toastSet = setText;
    return () => void (toastSet = null);
  }, []);
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(() => setText(""), 2600);
    return () => clearTimeout(t);
  }, [text]);
  return text ? <div className="toast" role="status">{text}</div> : null;
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
