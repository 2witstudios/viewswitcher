import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { Sidebar } from "../components/Sidebar";
import { Toaster } from "../components/ui";

export const Route = createFileRoute("/_app")({
  component: function AppShell() {
    // The scene editor takes the whole screen.
    const editing = useRouterState({ select: (s) => s.location.pathname.endsWith("/edit") });
    return (
      <div className={`app${editing ? " full" : ""}`}>
        {!editing && <Sidebar />}
        <main className={editing ? "main-full" : "main"}>
          <Outlet />
        </main>
        <Toaster />
      </div>
    );
  },
});
