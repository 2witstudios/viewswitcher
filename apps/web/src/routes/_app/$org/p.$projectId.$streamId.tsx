import { resolveStream, shortDate } from "@viewswitcher/shared";
import type { Scene } from "@viewswitcher/shared";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHead } from "../../../components/PageHead";
import { SceneTile } from "../../../components/SceneTile";
import { attempt, Menu, type MenuItem, PlusIcon } from "../../../components/ui";
import { api, copy } from "../../../lib/api";
import { useLibrary } from "../../../lib/library";
import { useLive } from "../../../lib/live";

export const Route = createFileRoute("/_app/$org/p/$projectId/$streamId")({
  component: function StreamPage() {
    const { org, projectId, streamId } = Route.useParams();
    const { data } = useLibrary(org);
    const { state } = useLive();
    const [adding, setAdding] = useState(false);

    const project = data?.projects.find((p) => p.id === projectId);
    const stream = project?.streams.find((s) => s.id === streamId);
    if (!data) return null;
    if (!project || !stream) return <p className="empty">That stream doesn't exist any more.</p>;

    const { own, shared } = resolveStream(project, stream);
    const onAirPath = state?.onAir?.path;
    const goLive = (s: Scene) => () =>
      attempt(() => api.putOnAir({ path: s.path, label: `${s.label} · ${stream.name}`, projectId, streamId }));
    const fileItems = (s: Scene, hint: string): MenuItem[] => [
      { label: "Open the file", hint, run: () => attempt(() => api.open(s.path)) },
      { label: "Copy path", hint: s.path, run: () => void copy(s.path) },
    ];

    return (
      <>
        <PageHead crumb={`${project.name} · ${stream.date ? shortDate(stream.date) : ""}`} title={stream.name} />

        <section className="section">
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
                menu={[
                  ...fileItems(s, "Changes this stream only"),
                  { label: "Duplicate", hint: "Copy inside this stream", run: () => attempt(() => api.duplicate(s.path), "Duplicated") },
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
            <div className="tile">
              <button type="button" className="add-tile" aria-haspopup="menu" aria-expanded={adding} onClick={() => setAdding(true)}>
                <PlusIcon size={26} />
                New scene
              </button>
              <span className="empty" style={{ fontSize: 13 }}>From a template</span>
              {adding && (
                <Menu
                  label="New scene from a template"
                  onClose={() => setAdding(false)}
                  items={data.templates.map((t) => ({
                    label: t.label,
                    hint: `Copy ${t.path} into this stream`,
                    run: () => attempt(() => api.addFromTemplate(org, t.name, projectId, streamId), `Added ${t.label}`),
                  }))}
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
                menu={[
                  {
                    label: "Customize for this stream",
                    hint: "Copies it into this stream first",
                    run: () => attempt(() => api.customize(org, projectId, streamId, s.name), `${s.label} is now this stream's own copy`),
                  },
                  "divider",
                  ...fileItems(s, "Changes it for every stream"),
                ]}
              />
            ))}
          </div>
        </section>
      </>
    );
  },
});
