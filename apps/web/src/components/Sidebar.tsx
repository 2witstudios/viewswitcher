import { shortDate } from "@viewswitcher/shared";
import type { Org } from "@viewswitcher/shared";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { templateGroups, templateId, useLibrary, useOrgId, useOrgs } from "../lib/library";
import { setLibraryOpen, useLibraryOpen } from "../lib/library-sheet";
import { DECK, useMedia } from "../lib/media";
import { queryClient, useLive } from "../lib/live";
import { TemplatePicker } from "./TemplatePicker";
import { Mark, Modal, PlusIcon, toast } from "./ui";

const ICON = "#a3a8b5";
const COLLAPSED = "viewswitcher.sidebar";

const readCollapsed = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSED) ?? "{}");
  } catch {
    return {};
  }
};

export function Sidebar() {
  const org = useOrgId();
  const { data } = useLibrary(org);
  const { state } = useLive();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed);
  const [dialog, setDialog] = useState<null | { kind: "project" } | { kind: "stream"; projectId: string }>(null);
  // On a phone (MAC-27) the library folds into a button in the top bar, so the scenes come first;
  // sideways (PHONE-12) it slides in over the deck. The page title opens it too (lib/library-sheet).
  // Wider screens never see the button and always show the library.
  const libraryOpen = useLibraryOpen();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => setLibraryOpen(false), [pathname]);
  // Sideways the library is a modal drawer over the deck: focus moves in, the page behind is inert (so
  // focus stays in the drawer), Escape closes it, and focus goes back to what opened it. Upright it
  // unfolds in place and stays a plain disclosure.
  const deck = useMedia(DECK);
  const modal = deck && libraryOpen;
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!modal) return;
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const page = document.querySelector<HTMLElement>("main.main");
    page?.setAttribute("inert", "");
    // After the drawer has become visible (it's visibility: hidden until the open class applies).
    const frame = requestAnimationFrame(() => nav.current?.querySelector<HTMLElement>(".side-toggle")?.focus());
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLibraryOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      page?.removeAttribute("inert");
      document.removeEventListener("keydown", onKey);
      if (back?.isConnected) back.focus();
    };
  }, [modal]);

  const toggle = (id: string) => {
    const key = `${org}/${id}`;
    const next = { ...collapsed, [key]: !collapsed[key] };
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED, JSON.stringify(next));
    } catch {}
  };

  return (
    <>
    <nav ref={nav} className={`side${libraryOpen ? " open" : ""}`} aria-label="Library" {...(modal ? { role: "dialog", "aria-modal": true } : {})}>
      <div className="brand" data-drag-region>
        <Mark /><span>ViewSwitcher</span>
        <button type="button" className="side-toggle" aria-expanded={libraryOpen} aria-controls="side-body" onClick={() => setLibraryOpen(!libraryOpen)}>
          {libraryOpen ? "Close" : "Library"}
        </button>
      </div>
      <div className="side-body" id="side-body">
      <OrgSwitcher current={org} />

      {org && (
        <>
          <div className="side-group">
            <Link to="/$org/templates" params={{ org }} className="side-item" activeProps={{ className: "side-item active" }}>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={ICON} strokeWidth="2" strokeLinejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></svg>
              Templates
            </Link>
            <Link to="/$org/assets" params={{ org }} className="side-item" activeProps={{ className: "side-item active" }}>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={ICON} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.8" /><path d="M21 16l-5-5-9 9" /></svg>
              Assets
            </Link>
          </div>

          <div className="side-group">
            <div className="side-label">
              <span>PROJECTS</span>
              <button type="button" className="icon-btn" aria-label="New project" onClick={() => setDialog({ kind: "project" })}><PlusIcon /></button>
            </div>
            {data?.projects.length === 0 && <span className="side-item side-add" style={{ cursor: "default" }}>No projects yet</span>}
            {data?.projects.map((p) => {
              const open = !collapsed[`${org}/${p.id}`];
              return (
                <div key={p.id} className="side-group" style={{ paddingBottom: open ? 8 : 0 }}>
                  <button type="button" className="side-item side-project" aria-expanded={open} onClick={() => toggle(p.id)}>
                    <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={ICON} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${open ? 90 : 0}deg)` }}><path d="M9 5l7 7-7 7" /></svg>
                    {p.name}
                  </button>
                  {open && (
                    <>
                      {p.streams.map((s) => (
                        <Link key={s.id} to="/$org/p/$projectId/$streamId" params={{ org, projectId: p.id, streamId: s.id }}
                          className="side-item side-stream" activeProps={{ className: "side-item side-stream active" }}>
                          <span className="date">{s.date ? shortDate(s.date) : ""}</span>
                          <span>{s.name}</span>
                          {state?.onAir?.org === org && state.onAir.projectId === p.id && state.onAir.streamId === s.id && <span className="onair" aria-label="on air" />}
                        </Link>
                      ))}
                      <button type="button" className="side-item side-add" onClick={() => setDialog({ kind: "stream", projectId: p.id })}>+ New stream</button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      </div>

      {org && dialog?.kind === "project" && (
        <NewProject org={org} groups={data ? templateGroups(data).filter((g) => g.templates.length) : []} onClose={() => setDialog(null)} />
      )}
      {org && dialog?.kind === "stream" && (
        <NewStream
          onClose={() => setDialog(null)}
          onSubmit={async (name, date) => {
            const r = await api.createStream(org, dialog.projectId, name, date);
            navigate({ to: "/$org/p/$projectId/$streamId", params: { org, ...r } });
          }}
        />
      )}
    </nav>
    {libraryOpen && <button type="button" className="side-scrim" aria-label="Close the library" onClick={() => setLibraryOpen(false)} />}
    {/* Sideways, on a screen with no page header to open it from (styles.css shows it only there, and
        hides it while the library is open). Always mounted, so closing the drawer can focus it again. */}
    <button type="button" className="deck-library" aria-controls="side-body" aria-expanded={libraryOpen} onClick={() => setLibraryOpen(true)}>Library</button>
    </>
  );
}

/** The org menu under the ViewSwitcher name: every org, which one is on air, and "New org". */
function OrgSwitcher({ current }: { current?: string }) {
  const { data: orgs } = useOrgs();
  const { state } = useLive();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [picking, setPicking] = useState<{ id: string; name: string } | null>(null);
  const org = orgs?.find((o) => o.id === current);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open]);

  const go = (o: Org) => {
    setOpen(false);
    navigate({ to: "/$org", params: { org: o.id } });
  };

  return (
    <div className="org">
      <button type="button" className="org-switch" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="org-dot" aria-hidden="true">{org?.name[0]?.toUpperCase() ?? "?"}</span>
        <span className="name">{org?.name ?? "Choose an org"}</span>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={ICON} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10l5 5 5-5" /></svg>
      </button>
      {open && (
        <>
          <button type="button" className="backdrop" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="org-menu" role="menu" aria-label="Orgs">
            {orgs?.map((o) => (
              <button key={o.id} type="button" role="menuitem" aria-current={o.id === current} onClick={() => go(o)}>
                <span className="org-dot" aria-hidden="true">{o.name[0]?.toUpperCase()}</span>
                {o.name}
                {state?.onAir?.org === o.id && <span className="onair">ON AIR</span>}
              </button>
            ))}
            <hr />
            <button type="button" role="menuitem" onClick={() => (setOpen(false), setCreating(true))}>
              <PlusIcon />New org
            </button>
          </div>
        </>
      )}
      {creating && (
        <NewOrg
          onClose={() => setCreating(false)}
          onCreated={async (id, name) => {
            await queryClient.invalidateQueries({ queryKey: ["library", "orgs"] });
            navigate({ to: "/$org", params: { org: id } });
            setPicking({ id, name });
          }}
        />
      )}
      {picking && (
        // EDIT-30: a new org starts from a built-in template set, if it likes.
        <TemplatePicker
          org={picking.id}
          have={["starter"]}
          title="Pick your templates"
          skipLabel="Skip"
          onClose={() => setPicking(null)}
          onAdded={async (names) => {
            await queryClient.invalidateQueries({ queryKey: ["library", picking.id] });
            if (names.length) toast(`Added ${names.join(", ")} to Templates`);
          }}
        />
      )}
    </div>
  );
}

function NewOrg({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string, name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [accent, setAccent] = useState("#d4a548");
  return (
    <Modal title="New org" submitLabel="Create org" onClose={onClose}
      onSubmit={async () => onCreated((await api.createOrg(name, accent)).orgId, name.trim())}>
      <label className="field">Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Bible Study" /></label>
      <label className="field">Accent color<input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} /></label>
    </Modal>
  );
}

function NewProject({ org, groups, onClose }: { org: string; groups: ReturnType<typeof templateGroups>; onClose: () => void }) {
  const [name, setName] = useState("");
  // The org's own templates start ticked (not "chapter", a one-off); a template pack's, unticked.
  const [picked, setPicked] = useState<string[]>(groups[0]?.set === null ? groups[0].templates.map(templateId).filter((t) => t !== "chapter") : []);
  return (
    <Modal title="New project" submitLabel="Create project" onClose={onClose} onSubmit={() => api.createProject(org, name, picked).then(() => {})}>
      <label className="field">Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring series" /></label>
      <div className="field">
        Scenes
        {groups.map((g) => (
          <div key={g.set?.id ?? ""} className="checks">
            {groups.length > 1 && <span className="checks-head">{g.name}</span>}
            {g.templates.map((t) => {
              const id = templateId(t);
              return (
                <label key={id}>
                  <input type="checkbox" checked={picked.includes(id)} onChange={(e) => setPicked(e.target.checked ? [...picked, id] : picked.filter((x) => x !== id))} />
                  {t.set ? t.label : t.name}
                </label>
              );
            })}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function NewStream({ onClose, onSubmit }: { onClose: () => void; onSubmit: (name: string, date: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(() => new Date().toLocaleDateString("en-CA"));
  return (
    <Modal title="New stream" submitLabel="Create stream" onClose={onClose} onSubmit={() => onSubmit(name, date)}>
      <label className="field">Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Episode 1" /></label>
      <label className="field">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
    </Modal>
  );
}
