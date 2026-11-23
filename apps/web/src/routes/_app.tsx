import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Sidebar } from "../components/Sidebar";
import { Toaster } from "../components/ui";

export const Route = createFileRoute("/_app")({
  component: () => (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Outlet />
      </main>
      <Toaster />
    </div>
  ),
});
