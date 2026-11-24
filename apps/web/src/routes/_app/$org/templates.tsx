import { createFileRoute } from "@tanstack/react-router";
import { PageHead } from "../../../components/PageHead";
import { SceneTile, useEditItem } from "../../../components/SceneTile";
import { attempt, type MenuItem } from "../../../components/ui";
import { api, copy } from "../../../lib/api";
import { useLibrary } from "../../../lib/library";

export const Route = createFileRoute("/_app/$org/templates")({
  component: function Templates() {
    const { org } = Route.useParams();
    const { data } = useLibrary(org);
    const editItem = useEditItem();
    return (
      <>
        <PageHead crumb="Starting points. Templates never go on air." title="Templates" />
        <section className="section">
          <div className="section-head"><h2>ALL TEMPLATES</h2><span>{org}/templates/</span></div>
          <div className="grid">
            {data?.templates.map((t) => {
              const menu: MenuItem[] = [
                editItem(t.path),
                "divider",
                ...(data.projects.map((p) => ({
                  label: `Add to ${p.name}`,
                  hint: "Copies it into the project's shared scenes",
                  run: () => attempt(() => api.addFromTemplate(org, t.name, p.id), `Added ${t.label} to ${p.name}`),
                }))),
                "divider",
                { label: "Open the file", hint: "In your editor on the Mac", run: () => attempt(() => api.open(t.path)) },
                { label: "Copy path", hint: t.path, run: () => void copy(t.path) },
                { label: "Duplicate", hint: "A new template to change", run: () => attempt(() => api.duplicate(t.path), "Duplicated") },
              ];
              return <SceneTile key={t.path} label={t.label} path={t.path} badge="TEMPLATE" menu={menu} />;
            })}
          </div>
        </section>

        <section className="section">
          <div className="section-head"><h2>TRANSITION</h2><span>plays between scenes · projects can have their own</span></div>
          <div className="grid">
            {data?.transition ? (
              <SceneTile label="Transition" path={data.transition} badge="TRANSITION" menu={[
                { label: "Open the file", hint: "Changes it for every project that doesn't have its own", run: () => attempt(() => api.open(data.transition!)) },
                { label: "Copy path", hint: data.transition, run: () => void copy(data.transition!) },
              ]} />
            ) : (
              <p className="empty">Blank: scenes fade through the ground color. For a designed one, ask your agent for {org}/templates/_shared/transition.html.</p>
            )}
          </div>
        </section>
      </>
    );
  },
});
