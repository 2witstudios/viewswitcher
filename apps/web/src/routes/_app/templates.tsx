import { createFileRoute } from "@tanstack/react-router";
import { PageHead } from "../../components/PageHead";
import { SceneTile } from "../../components/SceneTile";
import { attempt, type MenuItem } from "../../components/ui";
import { api, copy } from "../../lib/api";
import { useLibrary } from "../../lib/library";

export const Route = createFileRoute("/_app/templates")({
  component: function Templates() {
    const { data } = useLibrary();
    return (
      <>
        <PageHead crumb="Starting points. Templates never go on air." title="Templates" />
        <section className="section">
          <div className="section-head"><h2>ALL TEMPLATES</h2><span>templates/</span></div>
          <div className="grid">
            {data?.templates.map((t) => {
              const menu: MenuItem[] = [
                ...(data.projects.map((p) => ({
                  label: `Add to ${p.name}`,
                  hint: "Copies it into the project's shared scenes",
                  run: () => attempt(() => api.addFromTemplate(t.name, p.id), `Added ${t.label} to ${p.name}`),
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
      </>
    );
  },
});
