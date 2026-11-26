// The library (paired): orgs, one org's content, projects and streams, views made from templates and
// copies, transitions, assets, opening a file on this Mac, and the editor's saves, renames and live edits.
import * as lib from "../../library";
import { customizeScene, duplicateScene, orgDir, sceneFromTemplate } from "../../library-actions";
import { resolveInLibrary } from "../../library/contain";
import { plainName } from "../../paths";
import { editScene, parseEdit, renameScene, scenePath } from "../../scene-edit";
import { Audience } from "../../gate";
import type { Route } from "../dispatch";
import type { RouteDeps } from "../routes";
import { get, json, post } from "./kit";

export function libraryRoutes(d: RouteDeps): Route[] {
  const { root, store } = d;
  /** One org's folder; every mutation below works inside it. */
  const org = (id: unknown) => orgDir(root, id);
  return [
    get("/api/orgs", () => lib.listOrgs(root)),
    post("/api/orgs", (b) => lib.createOrg(root, d.starter, b.name, b.accent, b.ground)),
    get("/api/library", (c) => d.scanner.scanOrg(plainName(c.url.searchParams.get("org") ?? ""))),
    post("/api/projects", (b) => lib.createProject(org(b.org), b.name, b.templates ?? [])),
    post("/api/streams", (b) => lib.createStream(org(b.org), b.projectId, b.name, b.date)),
    // Where the copy is, so the switcher can open it in the editor.
    post("/api/scenes/from-template", (b) => sceneFromTemplate(root, { org: b.org, template: b.template, projectId: b.projectId, streamId: b.streamId })),
    post("/api/scenes/customize", (b) => customizeScene(root, { org: b.org, projectId: b.projectId, streamId: b.streamId, name: b.name })),
    post("/api/transition/customize", async (b) => {
      await lib.customizeTransition(org(b.org), b.projectId);
      return { ok: true };
    }),
    post("/api/transition/revert", async (b) => {
      await lib.revertTransition(org(b.org), b.projectId);
      return { ok: true };
    }),
    post("/api/scenes/revert", async (b) => {
      await lib.revert(org(b.org), b.projectId, b.streamId, b.name);
      return { ok: true };
    }),
    post("/api/scenes/duplicate", (b) => duplicateScene(root, b.path)),
    {
      method: "POST",
      path: "/api/assets",
      audience: Audience.Paired,
      body: "multipart",
      handler: async (c) => {
        const form = await c.req.formData();
        const orgId = plainName(String(form.get("org") ?? ""));
        const saved = [];
        for (const f of form.getAll("file")) {
          if (f instanceof File && f.size > 0) saved.push({ path: `${orgId}/${(await lib.saveAsset(org(orgId), f)).path}` });
        }
        return json({ saved });
      },
    },
    post("/api/open", async (b) => {
      // Opens the file in an editor on this Mac: a link to somewhere outside the library opens nothing.
      const abs = await resolveInLibrary(root, b.path);
      const app = process.env.VIEWSWITCHER_EDITOR;
      Bun.spawn(app ? ["open", "-a", app, abs] : ["open", "-t", abs], { stdout: "ignore", stderr: "ignore" });
      return { ok: true };
    }),
    // Scene editor: patch the file (409 when it changed since the editor loaded it), or show a change
    // live on the program page without writing anything.
    post("/api/scene/edit", async (b) => {
      const r = await editScene(root, b.path, String(b.hash ?? ""), b.edits);
      if (!r.ok) return json({ error: "This view changed since you opened it", hash: r.hash }, 409);
      d.log?.(`[edit] ${String(b.path).split("/").slice(-2).join("/")} ${r.changed ? "saved" : "unchanged"}`);
      return r;
    }),
    // Rename a scene: its title, and a stream scene's file. The scene stays on air if it is.
    post("/api/scene/rename", async (b) => {
      const r = await renameScene(root, b.path, String(b.hash ?? ""), b.name);
      if (!r.ok) return json({ error: "This view changed since you opened it", hash: r.hash }, 409);
      await store.renamed(b.path, b.name, r);
      return r;
    }),
    // A live edit: an unsaved change shown on the program as it's made. /api/scene/preview is its old
    // name, still answered for a page loaded before an update.
    ...["/api/scene/live-edit", "/api/scene/preview"].map((path) =>
      post(path, (b) => {
        scenePath(root, b.path);
        // The hash names the file version the edit's ids belong to; pages showing another version ignore it.
        d.publish({ t: "scene:liveEdit", path: b.path, hash: String(b.hash ?? ""), edit: parseEdit(b.edit), session: String(b.session ?? "").slice(0, 40), seq: Number(b.seq) || 0 });
        return { ok: true };
      }),
    ),
  ];
}
