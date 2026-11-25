// Library changes that both the switcher's /api routes and the MCP tools make, so the two follow one
// set of rules and return the same shapes (paths start with the org id).
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { orgOf } from "@viewswitcher/shared";
import type { OnAir } from "@viewswitcher/shared";
import * as lib from "./library";
import { inside, PathError, plainName } from "./paths";
import type { RenameResult } from "./scene-edit";

/** One org's folder; every change below works inside it. */
export const orgDir = (root: string, id: unknown) => inside(root, plainName(String(id ?? "")));

/** An org that exists (a top-level folder with org.json), for callers that must never make a new one by accident. */
export async function existingOrg(root: string, id: unknown): Promise<string> {
  const dir = orgDir(root, id);
  if (!(await stat(join(dir, "org.json")).then((s) => s.isFile(), () => false))) throw new PathError(`There's no org "${String(id)}". list_orgs shows the orgs.`);
  return dir;
}

export type SceneRef = { name: string; path: string };

/** A template copied into a project's shared scenes, or into one stream. */
export async function sceneFromTemplate(root: string, b: { org: unknown; template: string; projectId: string; streamId?: string }): Promise<SceneRef> {
  const { name } = await lib.addFromTemplate(orgDir(root, b.org), b.template, b.projectId, b.streamId);
  const dir = b.streamId ? `projects/${b.projectId}/streams/${b.streamId}` : `projects/${b.projectId}/scenes`;
  return { name, path: `${plainName(String(b.org))}/${dir}/${name}.html` };
}

/** A stream's own copy of a project scene (made if it isn't there yet). */
export async function customizeScene(root: string, b: { org: unknown; projectId: string; streamId: string; name: string }): Promise<SceneRef> {
  const { name } = await lib.customize(orgDir(root, b.org), b.projectId, b.streamId, b.name);
  return { name, path: `${plainName(String(b.org))}/projects/${b.projectId}/streams/${b.streamId}/${name}.html` };
}

/** A copy of a scene beside it ("<name>-copy"). */
export async function duplicateScene(root: string, path: string): Promise<SceneRef> {
  const { name } = await lib.duplicate(root, path);
  return { name, path: `${path.slice(0, path.lastIndexOf("/"))}/${name}.html` };
}

export type OnAirRequest = { path: string; label?: string; projectId?: string; streamId?: string };

/** The on-air record for a scene: its org's ground color and the transition that plays for it. */
export async function onAirFor(root: string, b: OnAirRequest): Promise<OnAir> {
  inside(root, b.path);
  const o = await lib.readOrg(root, orgOf(b.path));
  const transition = await lib.resolveTransition(root, b.path);
  return { path: b.path, org: o.id, ground: o.ground, transition, label: String(b.label ?? b.path), projectId: b.projectId, streamId: b.streamId };
}

/** The on-air record after the scene on air was renamed (EDIT-19): new path, and the new name in its label. */
export function renamedOnAir(on: OnAir, from: string, name: unknown, r: Extract<RenameResult, { ok: true }>): OnAir {
  // The label is "<scene> · <stream>": swap the scene's old name for the new one, keep the rest.
  const n = String(name).replace(/\s+/g, " ").trim();
  const label = r.was && on.label.startsWith(r.was) ? n + on.label.slice(r.was.length) : on.label.includes(" · ") ? n + on.label.slice(on.label.lastIndexOf(" · ")) : n;
  return { ...on, path: r.path, label, renamedFrom: r.path !== from ? from : on.renamedFrom };
}
