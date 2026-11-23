import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useLibrary } from "../../lib/library";
import { useLive } from "../../lib/live";

/** Open on the stream that's on air, else the newest stream, else templates. */
export const Route = createFileRoute("/_app/")({
  component: function Home() {
    const { data } = useLibrary();
    const { state } = useLive();
    if (!data) return null;
    const onAir = state?.onAir;
    if (onAir?.projectId && onAir.streamId) {
      return <Navigate to="/p/$projectId/$streamId" params={{ projectId: onAir.projectId, streamId: onAir.streamId }} replace />;
    }
    const p = data.projects.find((x) => x.streams.length);
    const s = p?.streams.at(-1);
    if (p && s) return <Navigate to="/p/$projectId/$streamId" params={{ projectId: p.id, streamId: s.id }} replace />;
    return <Navigate to="/templates" replace />;
  },
});
