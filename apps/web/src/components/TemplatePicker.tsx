// The built-in template sets (EDIT-30): the starter and the site's six example shows, shown with
// covers in this org's own name and colors. Used for a new org ("Pick your templates") and on the
// Templates page ("Add templates"). Each one is staged and installed through the same path as a
// dropped template pack (EDIT-24), so it lands as its own set; nothing changes until "Add".
import { libraryUrl } from "@viewswitcher/shared";
import { useEffect, useRef, useState } from "react";
import { type BuiltinPack, packs, type StagedPack } from "../lib/api";
import { SCENE_SANDBOX } from "../lib/scene-frame";
import { Overlay, useEscape } from "./ui";

type Card = { pack: BuiltinPack; staged: StagedPack | null; error: string | null };

/** The view that shows a set best on a card: its main layout, else its first. */
export const coverView = (s: StagedPack) => s.views.find((v) => v.name === "main") ?? s.views[0];

export function TemplatePicker({ org, have, title, intro, skipLabel, onClose, onAdded }: {
  org: string;
  /** Set ids the org has already (marked; adding one again makes a second copy). */
  have: string[];
  title: string;
  intro?: string;
  skipLabel: string;
  onClose: () => void;
  onAdded: (names: string[]) => Promise<void> | void;
}) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tokens = useRef<string[]>([]);
  const installed = useRef(new Set<string>());
  /** Tokens being installed right now: closing the picker mustn't cancel one mid-install. */
  const installing = useRef(new Set<string>());
  /** False once the picker has closed: a running Add stops, and nothing is staged after the cleanup. */
  const mounted = useRef(true);

  useEffect(() => {
    let live = true;
    mounted.current = true;
    void (async () => {
      try {
        const list = await packs.builtin();
        if (!live) return;
        setCards(list.map((pack) => ({ pack, staged: null, error: null })));
        await Promise.all(list.map(async (pack) => {
          const card = await packs.stageBuiltin(org, pack.id).then(
            (staged) => ({ staged, error: null }),
            (e) => ({ staged: null, error: (e as Error).message }),
          );
          if (card.staged) tokens.current.push(card.staged.token);
          if (!live) return card.staged && void packs.cancel(org, card.staged.token).catch(() => {});
          setCards((cs) => cs && cs.map((c) => (c.pack.id === pack.id ? { ...c, ...card } : c)));
        }));
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    })();
    return () => {
      live = false;
      mounted.current = false;
      // Whatever was staged and not added goes (the server also sweeps staging after an hour).
      for (const t of tokens.current) if (!installed.current.has(t) && !installing.current.has(t)) void packs.cancel(org, t).catch(() => {});
    };
  }, [org]);

  /** Stage a card again (after a failed install, whose staging is gone). If that fails too, it's unpicked. */
  const restage = async (id: string) => {
    if (!mounted.current) return;
    const staged = await packs.stageBuiltin(org, id).catch(() => null);
    if (!mounted.current) return void (staged && packs.cancel(org, staged.token).catch(() => {}));
    if (staged) tokens.current.push(staged.token);
    else setPicked((p) => p.filter((x) => x !== id));
    setCards((cs) => cs && cs.map((c) => (c.pack.id === id ? { ...c, staged, error: staged ? null : "Couldn't get it ready. Close and try again." } : c)));
  };

  /** A server message, worded for a built-in pack (there's nothing to drop again). */
  const plain = (m: string) => m.replace(/\s*Drop (?:it|the pack) again[^.]*\./g, "").trim();

  const add = async () => {
    setBusy(true);
    setError("");
    const names: string[] = [];
    let failed: { card: Card; message: string } | null = null;
    for (const c of cards ?? []) {
      if (!mounted.current) return; // closed mid-way: the rest were cancelled with it
      if (!picked.includes(c.pack.id) || !c.staged || installed.current.has(c.staged.token)) continue;
      const token = c.staged.token;
      installing.current.add(token);
      try {
        await packs.install(org, token);
        installed.current.add(token);
        names.push(c.pack.name);
      } catch (e) {
        failed = { card: c, message: (e as Error).message };
        break;
      } finally {
        installing.current.delete(token);
      }
    }
    // Only a failed install restages (its staging went with it), so Add can be tried again.
    if (failed) await restage(failed.card.pack.id);
    try {
      if (names.length || !failed) await onAdded(names);
    } catch {
      // The sets went in (and the library is refreshed): only the caller's follow-up, a toast, failed.
    }
    if (!mounted.current) return;
    if (!failed) return onClose();
    const addedIds = new Set((cards ?? []).filter((c) => names.includes(c.pack.name)).map((c) => c.pack.id));
    setPicked((p) => p.filter((id) => !addedIds.has(id)));
    setError(`${failed.card.pack.name}: ${plain(failed.message)}${names.length ? ` (${names.join(", ")} went in.)` : ""} Try again.`);
    setBusy(false);
  };

  const wrap = useRef<HTMLDivElement>(null);
  useEscape(wrap, () => !busy && onClose());
  return (
    <Overlay>
    <div className="modal-wrap" ref={wrap} onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal pack" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {intro && <p className="picker-note">{intro}</p>}
        {!cards && !error && <p className="empty">Loading…</p>}
        <div className="builtin-grid">
          {cards?.map(({ pack, staged, error: why }) => {
            const on = picked.includes(pack.id);
            const v = staged && coverView(staged);
            return (
              <button key={pack.id} type="button" className={`builtin${on ? " on" : ""}`} aria-pressed={on} disabled={!staged || busy}
                onClick={() => setPicked(on ? picked.filter((x) => x !== pack.id) : [...picked, pack.id])}>
                <div className="cover">
                  {v && <iframe title={`${pack.name}: ${v.label}`} src={`${libraryUrl(v.path)}?preview`} sandbox={SCENE_SANDBOX} tabIndex={-1} />}
                  {on && <span className="badge">SELECTED</span>}
                  {!on && have.includes(pack.id) && <span className="badge quiet">ADDED</span>}
                </div>
                <span className="builtin-name">{pack.name}</span>
                <span className="builtin-note">{why ?? (staged ? staged.views.map((x) => x.label).join(" · ") : "Loading…")}</span>
              </button>
            );
          })}
        </div>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>{skipLabel}</button>
          <button type="button" className="btn primary" disabled={busy || !picked.length} onClick={add}>
            {busy ? "Adding…" : picked.length > 1 ? `Add ${picked.length}` : "Add"}
          </button>
        </div>
      </div>
    </div>
    </Overlay>
  );
}
