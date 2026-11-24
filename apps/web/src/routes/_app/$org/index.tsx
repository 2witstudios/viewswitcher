import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useLibrary } from "../../../lib/library";

/** An org opens on its newest stream, else its templates. */
export const Route = createFileRoute("/_app/$org/")({
  component: function OrgHome() {
    const { org } = Route.useParams();
    const { data } = useLibrary(org);
    if (!data) return null;
    const streams = data.projects.flatMap((p) => p.streams.map((s) => ({ p, s })));
    const newest = streams.sort((a, b) => (a.s.date || a.s.id).localeCompare(b.s.date || b.s.id)).at(-1);
    if (newest) return <Navigate to="/$org/p/$projectId/$streamId" params={{ org, projectId: newest.p.id, streamId: newest.s.id }} replace />;
    return <Navigate to="/$org/templates" params={{ org }} replace />;
  },
});
