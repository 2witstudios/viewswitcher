// The built-in template sets (EDIT-30): the starter and the site's six example shows, shown with
// covers in this org's own name and colors. Used for a new org ("Pick your templates") and on the
// Templates page ("Add templates"). Each one is staged and installed through the same path as a
// dropped template pack (EDIT-24), so it lands as its own set; nothing changes until "Add".
import { useEffect, useRef, useState } from "react";
import { type BuiltinPack, packs, type StagedPack } from "../lib/api";
import { SCENE_SANDBOX } from "../lib/scene-frame";

type Card = { pack: BuiltinPack; staged: StagedPack | null; error: string | null };

/** The view that shows a set best on a card: its main layout, else its first. */
export const coverView = (s: StagedPack) => s.views.find((v) => v.name === "main") ?? s.views[0];

export function TemplatePicker({ org, orgName, have, title, intro, skipLabel, onClose, onAdded }: {
  org: string;
  orgName: string;
  /** Set ids the org has already (marked; adding one again makes a second copy). */
  have: string[];
  title: string;
  intro: string;
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

  useEffect(() => {
    let live = true;
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
      // Whatever was staged and not added goes (the server also sweeps staging after an hour).
      for (const t of tokens.current) if (!installed.current.has(t)) void packs.cancel(org, t).catch(() => {});
    };
  }, [org]);

  const add = async () => {
    setBusy(true);
    setError("");
    const names: string[] = [];
    try {
      for (const c of cards ?? []) {
        if (!picked.includes(c.pack.id) || !c.staged || installed.current.has(c.staged.token)) continue;
        await packs.install(org, c.staged.token);
        installed.current.add(c.staged.token);
        names.push(c.pack.name);
      }
      await onAdded(names);
      onClose();
    } catch (e) {
      setError(`${(e as Error).message}${names.length ? ` (${names.join(", ")} went in.)` : " Nothing was added."}`);
      setBusy(false);
    }
  };

  return (
    <div className="modal-wrap" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal pack" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        <p className="picker-note">{intro}</p>
        {!cards && !error && <p className="empty">Getting the template sets ready…</p>}
        <div className="builtin-grid">
          {cards?.map(({ pack, staged, error: why }) => {
            const on = picked.includes(pack.id);
            const v = staged && coverView(staged);
            return (
              <button key={pack.id} type="button" className={`builtin${on ? " on" : ""}`} aria-pressed={on} disabled={!staged || busy}
                onClick={() => setPicked(on ? picked.filter((x) => x !== pack.id) : [...picked, pack.id])}>
                <div className="cover">
                  {v && <iframe title={`${pack.name}: ${v.label}`} src={`/library/${v.path.split("/").map(encodeURIComponent).join("/")}?preview`} sandbox={SCENE_SANDBOX} tabIndex={-1} />}
                  {on && <span className="badge">ADDING</span>}
                  {!on && have.includes(pack.id) && <span className="badge quiet">YOU HAVE IT</span>}
                </div>
                <span className="builtin-name">{pack.name}</span>
                <span className="builtin-note">{why ?? (staged ? staged.views.map((x) => x.label).join(" · ") : "Getting it ready…")}</span>
              </button>
            );
          })}
        </div>
        <p className="picker-note quiet">Shown in {orgName}'s name and colors. Each one goes in as its own set of templates; nothing else changes. Edit them like any template afterwards.</p>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>{skipLabel}</button>
          <button type="button" className="btn primary" disabled={busy || !picked.length} onClick={add}>
            {busy ? "Adding…" : picked.length > 1 ? `Add ${picked.length} template sets` : "Add template set"}
          </button>
        </div>
      </div>
    </div>
  );
}
