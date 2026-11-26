// Template packs and sets (paired). /api/packs/… is pack files: check a dropped .zip or folder and
// show it, cancel it, list and stage a built-in one. /api/sets/… is the org's installed sets: install a
// staged pack as one, remove one. See packs.ts.
import { asDropped } from "../../builtin-packs";
import { cancelPack, installPack, removeSet, stagePack } from "../../packs";
import { plainName } from "../../paths";
import { Audience } from "../../gate";
import type { Route } from "../dispatch";
import type { RouteDeps } from "../routes";
import { get, json, post } from "./kit";

export function packRoutes(d: RouteDeps): Route[] {
  const { root } = d;
  return [
    {
      method: "POST",
      path: "/api/packs/stage",
      audience: Audience.Paired,
      body: "multipart",
      handler: async (c) => {
        const form = await c.req.formData();
        const orgId = plainName(String(form.get("org") ?? ""));
        const zip = form.get("zip");
        if (zip instanceof File) return json(await stagePack(root, orgId, { zip: new Uint8Array(await zip.arrayBuffer()) }, d.starterScript));
        const paths = form.getAll("path").map(String);
        const files = form.getAll("file");
        if (!files.length || files.length !== paths.length || files.some((f) => !(f instanceof File))) return json({ error: "Drop a template pack: a .zip, or its folder" }, 400);
        return json(await stagePack(root, orgId, { files: files.map((f, i) => ({ path: paths[i]!, data: f as File })) }, d.starterScript));
      },
    },
    // The built-in template packs: listed, then staged like a dropped one.
    get("/api/packs/builtin", async () => (await d.builtins()).map(({ id, name, description, views }) => ({ id, name, description, views }))),
    post("/api/packs/builtin/stage", async (b) => {
      const pack = (await d.builtins()).find((p) => p.id === b.id);
      if (!pack) return json({ error: "There's no built-in template pack by that name" }, 404);
      return stagePack(root, plainName(String(b.org ?? "")), { files: asDropped(pack) }, d.starterScript);
    }),
    // Installing makes a set; /api/packs/install is its old name, still answered for a page loaded before an update.
    ...["/api/sets/install", "/api/packs/install"].map((path) => post(path, (b) => installPack(root, plainName(String(b.org ?? "")), b.token))),
    post("/api/packs/cancel", async (b) => {
      await cancelPack(root, plainName(String(b.org ?? "")), b.token);
      return { ok: true };
    }),
    post("/api/sets/remove", (b) => removeSet(root, plainName(String(b.org ?? "")), String(b.set ?? ""))),
  ];
}
