import { createFileRoute } from "@tanstack/react-router";
import { SceneEditor } from "../../../components/SceneEditor";

/** The scene editor: /$org/edit?path=<library path>, with &rename=1 to open with the name ready to retype (a fresh copy). */
export const Route = createFileRoute("/_app/$org/edit")({
  validateSearch: (search: Record<string, unknown>): { path: string; rename?: boolean } => ({
    path: String(search.path ?? ""),
    ...(search.rename === true || search.rename === 1 || search.rename === "1" || search.rename === "true" ? { rename: true } : {}),
  }),
  component: function EditRoute() {
    const { org } = Route.useParams();
    const { path, rename } = Route.useSearch();
    if (!path.startsWith(`${org}/`) || !path.endsWith(".html")) return <p className="empty" style={{ padding: 24 }}>That isn't a view in {org}.</p>;
    // A new path (Edit a copy instead, a rename) starts a fresh editor.
    return <SceneEditor key={path} org={org} path={path} rename={rename} />;
  },
});
