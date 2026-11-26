import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { lastOrg, useLibrary } from "../../lib/library";

/** Everything for one org: its templates, assets, projects and streams. */
export const Route = createFileRoute("/_app/$org")({
  component: function OrgLayout() {
    const { org } = Route.useParams();
    const { error } = useLibrary(org);
    useEffect(() => lastOrg.set(org), [org]);
    if (error) return <p className="empty">There's no show called “{org}”. Pick one from the show menu.</p>;
    return <Outlet />;
  },
});
