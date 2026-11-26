import { libraryUrl, templateId } from "@viewswitcher/shared";
import type { OrgContent, Scene, StagedPack, TemplateSet } from "@viewswitcher/shared";
import { createFileRoute } from "@tanstack/react-router";
import { AskAgent } from "../../../components/AgentSheet";
import { type DragEvent, useEffect, useRef, useState } from "react";
import { PageHead } from "../../../components/PageHead";
import { SceneTile, useOpenEditor } from "../../../components/SceneTile";
import { TemplatePicker } from "../../../components/TemplatePicker";
import { attempt, type MenuItem, PlusIcon, toast } from "../../../components/ui";
import { api, copy, packs } from "../../../lib/api";
import { templateGroups, useLibrary } from "../../../lib/library";
import { describeScripts, type DroppedPack, fromPicker, readDrop } from "../../../lib/pack-drop";
import { SCENE_SANDBOX } from "../../../lib/scene-frame";

export const Route = createFileRoute("/_app/$org/templates")({
  component: function Templates() {
    const { org } = Route.useParams();
    const { data } = useLibrary(org);
    const openEditor = useOpenEditor();
    const [over, setOver] = useState(false);
    const [checking, setChecking] = useState(false);
    const [staged, setStaged] = useState<StagedPack | null>(null);
    const [refused, setRefused] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const picker = useRef<HTMLInputElement>(null);

    /** Send a dropped or chosen pack to the server to check; show what's in it, or why it can't go in. */
    const stage = async (pack: DroppedPack) => {
      if (!pack) return toast("Drop a template pack: a .zip, or its folder");
      if ("files" in pack && !pack.files.length) return toast("That folder is empty");
      setChecking(true);
      setRefused(null);
      try {
        setStaged(await packs.stage(org, pack));
      } catch (e) {
        setRefused((e as Error).message);
      } finally {
        setChecking(false);
      }
    };
    const isFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    // A pack dropped beside the drop area mustn't make the browser open the file.
    useEffect(() => {
      const stop = (e: globalThis.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files") && e.preventDefault();
      window.addEventListener("dragover", stop);
      window.addEventListener("drop", stop);
      return () => {
        window.removeEventListener("dragover", stop);
        window.removeEventListener("drop", stop);
      };
    }, []);

    const removeSet = async (set: TemplateSet) => {
      if (!confirm(`Remove ${set.name} from Templates? Views already made from it stay as they are.`)) return;
      await attempt(async () => {
        await packs.removeSet(org, set.id);
        toast(`Removed ${set.name}`);
      });
    };

    const tile = (lib: OrgContent, t: Scene) => {
      const menu: MenuItem[] = [
        ...lib.projects.flatMap((p): MenuItem[] => [{
          label: `Add to ${p.name}`,
          run: () => attempt(() => api.addFromTemplate(org, templateId(t), p.id), `Added ${t.label} to ${p.name}`),
        }]),
        ...(lib.projects.length ? ["divider" as const] : []),
        { label: "Open the file", run: () => attempt(() => api.open(t.path)) },
        { label: "Copy path", hint: t.path, run: () => void copy(t.path) },
        { label: "Duplicate and edit", run: () => attempt(async () => openEditor((await api.duplicate(t.path)).path, { rename: true })) },
      ];
      return <SceneTile key={t.path} label={t.label} path={t.path} badge="TEMPLATE" onEdit={() => openEditor(t.path)} menu={menu} />;
    };

    return (
      <div
        className={`drop-page${over ? " over" : ""}`}
        onDragOver={(e) => {
          if (!isFiles(e) || staged || checking) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setOver(true);
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(false)}
        onDrop={(e) => {
          if (!isFiles(e)) return;
          e.preventDefault();
          setOver(false);
          if (staged || checking) return;
          void readDrop(e.dataTransfer).then(stage, () => toast("Couldn't read that folder"));
        }}
      >
        <PageHead crumb={data?.org.name ?? org} title="Templates" />
        <div className="pack-bar">
          <button type="button" className="btn primary" onClick={() => setAdding(true)}><PlusIcon />Add templates</button>
          <button type="button" className="btn" disabled={checking} onClick={() => picker.current?.click()}>{checking ? "Checking…" : "Import pack…"}</button>
          <input ref={picker} type="file" accept=".zip,application/zip" hidden onChange={(e) => {
            const pack = fromPicker(e.target.files);
            e.target.value = "";
            void stage(pack);
          }} />
        </div>
        {refused && (
          <div className="pack-refused" role="alert">
            <b>That pack can't be installed.</b> {refused} Nothing was added.
            <button type="button" className="btn ghost" onClick={() => setRefused(null)}>OK</button>
          </div>
        )}

        {data && templateGroups(data).map((g) => (
          <section key={g.set?.id ?? ""} className="section">
            <div className="section-head">
              <h2>{g.set ? g.name.toUpperCase() : "YOUR TEMPLATES"}</h2>
              {g.set && (g.set.version || g.set.author) && <span>{[g.set.version, g.set.author].filter(Boolean).join(" · ")}</span>}
              {g.set && <button type="button" className="btn ghost small" onClick={() => removeSet(g.set!)}>Remove set</button>}
            </div>
            {g.set?.description && <p className="set-note">{g.set.description}</p>}
            <div className="grid">
              {g.templates.map((t) => tile(data, t))}
              {g.set?.transition && (
                <SceneTile label="Transition" path={g.set.transition} badge="TRANSITION" menu={[
                  { label: "Open the file", run: () => attempt(() => api.open(g.set!.transition!)) },
                  { label: "Copy path", hint: g.set.transition, run: () => void copy(g.set!.transition!) },
                ]} />
              )}
              {!g.templates.length && <p className="empty">No templates here yet.</p>}
            </div>
          </section>
        ))}

        <section className="section">
          <div className="section-head"><h2>TRANSITION</h2></div>
          <div className="grid">
            {data?.transition ? (
              <SceneTile label="Transition" path={data.transition} badge="TRANSITION" menu={[
                { label: "Open the file", hint: "All projects without their own", run: () => attempt(() => api.open(data.transition!)) },
                { label: "Copy path", hint: data.transition, run: () => void copy(data.transition!) },
              ]} />
            ) : (
              <p className="empty">None. Views fade through the ground color. <AskAgent>Design one with AI</AskAgent></p>
            )}
          </div>
        </section>

        {over && <div className="drop-hint" aria-hidden="true"><span>Drop to see the pack</span></div>}
        {adding && data && (
          <TemplatePicker
            org={org}
            have={data.sets.map((s) => s.id)}
            title="Add templates"
            skipLabel="Cancel"
            onClose={() => setAdding(false)}
            onAdded={async (names) => {
              if (names.length) toast(`Added ${names.join(", ")}`);
            }}
          />
        )}
        {staged && data && (
          <PackCovers
            pack={staged}
            onCancel={() => {
              void packs.cancel(org, staged.token).catch(() => {});
              setStaged(null);
            }}
            onInstall={async () => {
              await packs.install(org, staged.token);
              setStaged(null);
              toast(`Installed ${staged.manifest.name}`);
            }}
          />
        )}
      </div>
    );
  },
});

function PackCovers({ pack, onCancel, onInstall }: { pack: StagedPack; onCancel: () => void; onInstall: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const m = pack.manifest;
  const runs = describeScripts(pack.scripts);
  return (
    <div className="modal-wrap" onClick={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="modal pack" role="dialog" aria-label={`Install ${m.name}`}>
        <div className="pack-title">
          <h2>{m.name}</h2>
          <span className="pack-meta">{[m.version && `version ${m.version}`, m.author && `by ${m.author}`, `${pack.views.length} view${pack.views.length === 1 ? "" : "s"}`, `${(pack.bytes / 1024 / 1024).toFixed(pack.bytes < 1024 * 1024 ? 2 : 1)} MB`].filter(Boolean).join(" · ")}</span>
        </div>
        {m.description && <p className="picker-note">{m.description}</p>}
        <div className="pack-covers">
          {pack.views.map((v) => (
            <figure key={v.name}>
              <div className="cover"><iframe title={v.label} src={`${libraryUrl(v.path)}?preview`} sandbox={SCENE_SANDBOX} tabIndex={-1} /></div>
              <figcaption>{v.label}</figcaption>
            </figure>
          ))}
          {pack.transition && (
            <figure>
              <div className="cover"><iframe title="Transition" src={`${libraryUrl(pack.transition)}?preview`} sandbox={SCENE_SANDBOX} tabIndex={-1} /></div>
              <figcaption>Transition</figcaption>
            </figure>
          )}
        </div>
        <div className="pack-runs">
          <b>What it runs</b>
          {runs.map((r) => <span key={r}>{r}</span>)}
          <span className="quiet">Runs sandboxed.</span>
        </div>
        {!!pack.warnings.length && (
          <div className="pack-warnings">
            <b>Warnings</b>
            {pack.warnings.map((w) => <span key={w}>{w}</span>)}
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="button" className="btn primary" disabled={busy} onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onInstall();
            } catch (e) {
              setError(`${(e as Error).message} Nothing was installed.`);
              setBusy(false);
            }
          }}>{busy ? "Installing…" : "Install"}</button>
        </div>
      </div>
    </div>
  );
}
