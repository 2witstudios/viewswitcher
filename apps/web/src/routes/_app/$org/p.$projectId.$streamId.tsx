import { resolveStream, shortDate } from "@viewswitcher/shared";
import type { Scene } from "@viewswitcher/shared";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AskAgent } from "../../../components/AgentSheet";
import { PageHead } from "../../../components/PageHead";
import { OnAirHero, SceneTile, useOpenEditor } from "../../../components/SceneTile";
import { attempt, Menu, type MenuItem, PlusIcon } from "../../../components/ui";
import { api, copy } from "../../../lib/api";
import { templateGroups, templateId, useLibrary } from "../../../lib/library";
import { useLive } from "../../../lib/live";

export const Route = createFileRoute("/_app/$org/p/$projectId/$streamId")({
  component: function StreamPage() {
    const { org, projectId, streamId } = Route.useParams();
    const { data } = useLibrary(org);
    const { state } = useLive();
    const [adding, setAdding] = useState(false);
    const openEditor = useOpenEditor();

    const project = data?.projects.find((p) => p.id === projectId);
    const stream = project?.streams.find((s) => s.id === streamId);
    if (!data) return null;
    if (!project || !stream) return <p className="empty">That stream doesn't exist any more.</p>;

    const { own, shared } = resolveStream(project, stream);
    const transition = project.transition ?? data.transition;
    const onAirPath = state?.onAir?.path;
    const goLive = (s: Scene) => () =>
      attempt(() => api.putOnAir({ path: s.path, label: `${s.label} · ${stream.name}`, projectId, streamId }));
    const fileItems = (path: string, hint: string): MenuItem[] => [
      { label: "Open the file", hint, run: () => attempt(() => api.open(path)) },
      { label: "Copy path", hint: path, run: () => void copy(path) },
    ];

    return (
      <>
        <PageHead crumb={`${project.name} · ${stream.date ? shortDate(stream.date) : ""}`} title={stream.name} />
        <OnAirHero />

        <section className={`section${own.length ? "" : " own-empty"}`}>
          <div className="section-head">
            <h2>THIS STREAM</h2>
            <span>{own.length ? "only in this stream" : "nothing yet: everything below comes from the project"}</span>
          </div>
          <div className="grid">
            {own.map((s) => (
              <SceneTile
                key={s.path}
                label={s.overrides ? `${s.label} (custom)` : s.label}
                path={s.path}
                live={s.path === onAirPath}
                onActivate={goLive(s)}
                onEdit={() => openEditor(s.path)}
                menu={[
                  {
                    label: "Duplicate and edit",
                    hint: "A copy in this stream, open to change",
                    run: () => attempt(async () => openEditor((await api.duplicate(s.path)).path, { rename: true })),
                  },
                  "divider",
                  ...fileItems(s.path, "Changes this stream only"),
                  ...(s.overrides
                    ? [{
                        label: "Go back to the project version",
                        hint: "Deletes this stream's copy",
                        run: async () => {
                          if (!confirm(`Delete this stream's ${s.label} and use the project's?`)) return;
                          await attempt(() => api.revert(org, projectId, streamId, s.name), "Back to the project version");
                        },
                      }]
                    : []),
                ]}
              />
            ))}
            <div className="tile new-scene">
              <button type="button" className="add-tile" aria-haspopup="menu" aria-expanded={adding} onClick={() => setAdding(true)}>
                <PlusIcon size={26} />
                New scene
              </button>
              <span className="empty" style={{ fontSize: 13 }}>From a template</span>
              {adding && (
                <Menu
                  label="New scene from a template"
                  onClose={() => setAdding(false)}
                  // By set (EDIT-25): the org's own templates, then each template pack's.
                  items={templateGroups(data).filter((g) => g.templates.length).flatMap((g, i, all): MenuItem[] => [
                    ...(all.length > 1 ? [{ heading: g.name }] : []),
                    ...g.templates.map((t) => ({
                      label: t.label,
                      hint: "A copy in this stream, open to change",
                      run: () => attempt(async () => openEditor((await api.addFromTemplate(org, templateId(t), projectId, streamId)).path)),
                    })),
                  ])}
                />
              )}
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-head"><h2>FROM THE PROJECT</h2><span>shared by every stream in {project.name}</span></div>
          <div className="grid">
            {shared.length === 0 && <p className="empty">This project has no shared scenes. Add some from Templates.</p>}
            {shared.map((s) => (
              <SceneTile
                key={s.path}
                label={s.label}
                path={s.path}
                live={s.path === onAirPath}
                onActivate={goLive(s)}
                editChoices={[
                  {
                    label: "Edit for this stream",
                    hint: "Makes this stream's own copy, then opens it",
                    run: () => attempt(async () => openEditor((await api.customize(org, projectId, streamId, s.name)).path)),
                  },
                  { label: "Edit for every stream", hint: `Changes ${project.name}'s scene`, run: () => openEditor(s.path) },
                ]}
                menu={[
                  {
                    label: "Customize for this stream",
                    hint: "Copies it into this stream first",
                    run: () => attempt(() => api.customize(org, projectId, streamId, s.name), `${s.label} is now this stream's own copy`),
                  },
                  "divider",
                  ...fileItems(s.path, "Changes it for every stream"),
                ]}
              />
            ))}
          </div>
        </section>

        <section className="section transition-section">
          <div className="section-head">
            <h2>TRANSITION</h2>
            <span>{project.transition ? `${project.name}'s own` : transition ? "the org's, shared by projects without their own" : "blank: scenes fade through the ground color"}</span>
          </div>
          <div className="grid">
            {transition ? (
              <SceneTile
                label={project.transition ? "Transition (custom)" : "Transition"}
                path={transition}
                badge="TRANSITION"
                menu={[
                  ...(project.transition
                    ? [{
                        label: "Go back to the org's transition",
                        hint: "Deletes this project's copy",
                        run: async () => {
                          if (!confirm(`Delete ${project.name}'s own transition and use the org's?`)) return;
                          await attempt(() => api.revertTransition(org, projectId), "Back to the org's transition");
                        },
                      }]
                    : [{
                        label: "Customize for this project",
                        hint: "Copies the org's transition into the project first",
                        run: () => attempt(() => api.customizeTransition(org, projectId), `${project.name} now has its own transition`),
                      }]),
                  "divider",
                  ...fileItems(transition, project.transition ? "Changes it for this project" : "Changes it for every project that doesn't have its own"),
                ]}
              />
            ) : (
              <p className="empty">For a designed one, <AskAgent /> for {org}/projects/{projectId}/transition.html (this project) or {org}/templates/_shared/transition.html (every project).</p>
            )}
          </div>
        </section>
      </>
    );
  },
});
