import { resolveStream, shortDate, templateId } from "@viewswitcher/shared";
import type { Scene } from "@viewswitcher/shared";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AskAgent } from "../../../components/AgentSheet";
import { PageHead } from "../../../components/PageHead";
import { OnAirHero, SceneTile, useOpenEditor } from "../../../components/SceneTile";
import { attempt, Menu, type MenuItem, PlusIcon } from "../../../components/ui";
import { api, copy } from "../../../lib/api";
import { templateGroups, useLibrary } from "../../../lib/library";
import { useLive } from "../../../lib/live";

export const Route = createFileRoute("/_app/$org/p/$projectId/$streamId")({
  component: function StreamPage() {
    const { org, projectId, streamId } = Route.useParams();
    const { data } = useLibrary(org);
    const onAirPath = useLive((l) => l.state?.onAir?.path);
    const [adding, setAdding] = useState(false);
    const openEditor = useOpenEditor();

    const project = data?.projects.find((p) => p.id === projectId);
    const stream = project?.streams.find((s) => s.id === streamId);
    if (!data) return null;
    if (!project || !stream) return <p className="empty">That stream doesn't exist any more.</p>;

    const { own, shared } = resolveStream(project, stream);
    const transition = project.transition ?? data.transition;
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
                    run: () => attempt(async () => openEditor((await api.duplicate(s.path)).path, { rename: true })),
                  },
                  "divider",
                  ...fileItems(s.path, "This stream only"),
                  ...(s.overrides
                    ? [{
                        label: "Revert to project version",
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
                New view
              </button>
              {adding && (
                <Menu
                  label="New view from a template"
                  onClose={() => setAdding(false)}
                  // By set (EDIT-25): the org's own templates, then each template pack's.
                  items={templateGroups(data).filter((g) => g.templates.length).flatMap((g, i, all): MenuItem[] => [
                    ...(all.length > 1 ? [{ heading: g.name }] : []),
                    ...g.templates.map((t) => ({
                      label: t.label,
                      run: () => attempt(async () => openEditor((await api.addFromTemplate(org, templateId(t), projectId, streamId)).path)),
                    })),
                  ])}
                />
              )}
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-head"><h2>FROM THE PROJECT</h2></div>
          <div className="grid">
            {shared.length === 0 && <p className="empty">No shared views. Add from Templates.</p>}
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
                    run: () => attempt(async () => openEditor((await api.customize(org, projectId, streamId, s.name)).path)),
                  },
                  { label: "Edit for every stream", run: () => openEditor(s.path) },
                ]}
                menu={[
                  {
                    label: "Customize for this stream",
                    run: () => attempt(() => api.customize(org, projectId, streamId, s.name), `${s.label} is now this stream's own copy`),
                  },
                  "divider",
                  ...fileItems(s.path, "Every stream"),
                ]}
              />
            ))}
          </div>
        </section>

        <section className="section transition-section">
          <div className="section-head">
            <h2>TRANSITION</h2>
            {project.transition && <span>custom</span>}
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
                        label: "Go back to the show's transition",
                        hint: "Deletes this project's copy",
                        run: async () => {
                          if (!confirm(`Delete ${project.name}'s own transition and use the show's?`)) return;
                          await attempt(() => api.revertTransition(org, projectId), "Back to the show's transition");
                        },
                      }]
                    : [{
                        label: "Customize for this project",
                        run: () => attempt(() => api.customizeTransition(org, projectId), `${project.name} now has its own transition`),
                      }]),
                  "divider",
                  ...fileItems(transition, project.transition ? "This project" : "All projects without their own"),
                ]}
              />
            ) : (
              <p className="empty">None. Views fade through the ground color. <AskAgent>Design one with AI</AskAgent></p>
            )}
          </div>
        </section>
      </>
    );
  },
});
