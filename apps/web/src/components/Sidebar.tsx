import { shortDate } from "@daisy/shared";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../lib/api";
import { useLibrary } from "../lib/library";
import { useLive } from "../lib/live";
import { Mark, Modal, PlusIcon } from "./ui";

const readOpen = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem("daisy.sidebar") ?? "{}");
  } catch {
    return {};
  }
};

export function Sidebar() {
  const { data } = useLibrary();
  const { state } = useLive();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readOpen);
  const [dialog, setDialog] = useState<null | { kind: "project" } | { kind: "stream"; projectId: string }>(null);

  const toggle = (id: string) => {
    const next = { ...collapsed, [id]: !collapsed[id] };
    setCollapsed(next);
    try {
      localStorage.setItem("daisy.sidebar", JSON.stringify(next));
    } catch {}
  };

  return (
    <nav className="side" aria-label="Library">
      <div className="brand"><Mark /><span>Daisy Live</span></div>

      <div className="side-group">
        <Link to="/templates" className="side-item" activeProps={{ className: "side-item active" }}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a7c09c" strokeWidth="2" strokeLinejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></svg>
          Templates
        </Link>
        <Link to="/assets" className="side-item" activeProps={{ className: "side-item active" }}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a7c09c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.8" /><path d="M21 16l-5-5-9 9" /></svg>
          Assets
        </Link>
      </div>

      <div className="side-group">
        <div className="side-label">
          <span>PROJECTS</span>
          <button type="button" className="icon-btn" aria-label="New project" onClick={() => setDialog({ kind: "project" })}><PlusIcon /></button>
        </div>
        {data?.projects.map((p) => {
          const open = !collapsed[p.id];
          return (
            <div key={p.id} className="side-group" style={{ paddingBottom: open ? 8 : 0 }}>
              <button type="button" className="side-item side-project" aria-expanded={open} onClick={() => toggle(p.id)}>
                <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#a7c09c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${open ? 90 : 0}deg)` }}><path d="M9 5l7 7-7 7" /></svg>
                {p.name}
              </button>
              {open && (
                <>
                  {p.streams.map((s) => (
                    <Link key={s.id} to="/p/$projectId/$streamId" params={{ projectId: p.id, streamId: s.id }}
                      className="side-item side-stream" activeProps={{ className: "side-item side-stream active" }}>
                      <span className="date">{s.date ? shortDate(s.date) : ""}</span>
                      <span>{s.name}</span>
                      {state?.onAir?.projectId === p.id && state.onAir.streamId === s.id && <span className="onair" aria-label="on air" />}
                    </Link>
                  ))}
                  <button type="button" className="side-item side-add" onClick={() => setDialog({ kind: "stream", projectId: p.id })}>+ New stream</button>
                </>
              )}
            </div>
          );
        })}
      </div>

      {dialog?.kind === "project" && (
        <NewProject templates={data?.templates.map((t) => t.name) ?? []} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "stream" && (
        <NewStream
          onClose={() => setDialog(null)}
          onSubmit={async (name, date) => {
            const r = await api.createStream(dialog.projectId, name, date);
            navigate({ to: "/p/$projectId/$streamId", params: r });
          }}
        />
      )}
    </nav>
  );
}

function NewProject({ templates, onClose }: { templates: string[]; onClose: () => void }) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>(templates.filter((t) => t !== "chapter"));
  return (
    <Modal title="New project" submitLabel="Create project" onClose={onClose} onSubmit={() => api.createProject(name, picked).then(() => {})}>
      <label className="field">Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Team Policy 2026–27" /></label>
      <div className="field">
        Shared scenes to start with
        <div className="checks">
          {templates.map((t) => (
            <label key={t}>
              <input type="checkbox" checked={picked.includes(t)} onChange={(e) => setPicked(e.target.checked ? [...picked, t] : picked.filter((x) => x !== t))} />
              {t}
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function NewStream({ onClose, onSubmit }: { onClose: () => void; onSubmit: (name: string, date: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(() => new Date().toLocaleDateString("en-CA"));
  return (
    <Modal title="New stream" submitLabel="Create stream" onClose={onClose} onSubmit={() => onSubmit(name, date)}>
      <label className="field">Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Negative approaches" /></label>
      <label className="field">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
    </Modal>
  );
}
