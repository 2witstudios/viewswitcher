// The live side of the switcher (paired): the socket, the state, what's on air, the program page's
// slot reports, and OBS's buttons and setup.
import type { Slot } from "@viewswitcher/shared";
import { Audience } from "../../gate";
import { checkObsSetup, setupObs } from "../../obs-setup";
import type { Route } from "../dispatch";
import type { RouteDeps } from "../routes";
import { get, json, post } from "./kit";

export function liveRoutes(d: RouteDeps): Route[] {
  const { store } = d;
  return [
    {
      // The live state. A WebSocket isn't covered by CORS, so the dispatcher checks its Origin like a POST's.
      method: "GET",
      path: "/ws",
      audience: Audience.Paired,
      handler: (c) =>
        c.srv.upgrade(c.req, { data: { remote: c.caller.kind === "remote" ? c.caller.remote : null, lan: c.lan } }) ? undefined : new Response("Upgrade failed", { status: 400 }),
    },
    post("/api/log", (b) => {
      console.log("[client]", JSON.stringify(b));
      return { ok: true };
    }),
    get("/api/state", () => store.state),
    post("/api/onair", (b) => store.goOnAir({ path: b.path, label: b.label, projectId: b.projectId, streamId: b.streamId })),
    post("/api/program/slots", async (b) => {
      // Sources follow what the program page is *showing*, never what was just requested: the page
      // always converges on the latest on-air scene, so its last report matches the final picture.
      // (Ignoring "stale" reports by scene caused drift.) Reports are numbered per page; one that
      // arrives after a newer one from the same page (a live drag's 33 ms reports can swap) is ignored.
      if (!d.acceptSlots(b.page, b.seq)) return { ok: true, stale: true, warnings: store.state.warnings };
      d.log?.(`[slots] ${String(b.path).split("/").slice(-2).join("/")}`);
      const slots: Slot[] = (Array.isArray(b.slots) ? b.slots : []).map((s: Slot) => ({
        source: String(s.source), x: Number(s.x), y: Number(s.y), w: Number(s.w), h: Number(s.h),
      }));
      await d.placer.report(String(b.path), slots);
      return { ok: true, warnings: store.state.warnings };
    }),
    post("/api/obs/setup", async () => {
      if (!d.obs.status.connected) return json({ error: "OBS isn't connected. Open OBS and turn on Tools → WebSocket Server Settings → Enable WebSocket server." }, 503);
      // While streaming or recording, setup never switches OBS's program scene (it would cut the stream).
      const report = await setupObs(d.obs, d.obsNames, d.obsPort, { switchProgram: !d.obs.status.streaming && !d.obs.status.recording });
      store.update({ obsSetup: await checkObsSetup(d.obs, d.obsNames, d.obsPort) });
      return report;
    }),
    post("/api/obs/record", () => d.obs.request("ToggleRecord")),
    post("/api/obs/stream", () => d.obs.request("ToggleStream")),
  ];
}
