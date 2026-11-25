import { createFileRoute, Navigate } from "@tanstack/react-router";
import { lastOrg, useOrgs } from "../../lib/library";
import { useLive } from "../../lib/live";

/** Open on the stream that's on air, else the last org you used, else the first org. */
export const Route = createFileRoute("/_app/")({
  component: function Home() {
    const { data: orgs } = useOrgs();
    const { state } = useLive();
    if (!orgs || !state) return null;
    const onAir = state.onAir;
    if (onAir?.org && onAir.projectId && onAir.streamId && orgs.some((o) => o.id === onAir.org)) {
      return <Navigate to="/$org/p/$projectId/$streamId" params={{ org: onAir.org, projectId: onAir.projectId, streamId: onAir.streamId }} replace />;
    }
    const last = lastOrg.get();
    const org = orgs.find((o) => o.id === last) ?? orgs[0];
    if (!org) return <p className="empty">No orgs yet.</p>;
    return <Navigate to="/$org" params={{ org: org.id }} replace />;
  },
});
