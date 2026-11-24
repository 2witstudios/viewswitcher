import { createFileRoute } from "@tanstack/react-router";
import { SceneEditor } from "../../../components/SceneEditor";

/** The scene editor: /$org/edit?path=<library path>. */
export const Route = createFileRoute("/_app/$org/edit")({
  validateSearch: (search: Record<string, unknown>): { path: string } => ({ path: String(search.path ?? "") }),
  component: function EditRoute() {
    const { org } = Route.useParams();
    const { path } = Route.useSearch();
    if (!path.startsWith(`${org}/`) || !path.endsWith(".html")) return <p className="empty" style={{ padding: 24 }}>That isn't a scene in {org}.</p>;
    // A new path (Edit a copy instead) starts a fresh editor.
    return <SceneEditor key={path} org={org} path={path} />;
  },
});
