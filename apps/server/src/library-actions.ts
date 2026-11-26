// Library changes that both the switcher's /api routes and the MCP tools make, so the two follow one
// set of rules and return the same shapes (paths start with the org id).
import { dirname, join } from "node:path";
import { orgOf } from "@viewswitcher/shared";
import type { OnAir } from "@viewswitcher/shared";
import * as lib from "./library";
import { resolveInLibrary } from "./library/contain";
import { inside, PathError, plainName } from "./paths";
import type { RenameResult } from "./scene-edit";

/** One org's folder; every change below works inside it. */
export const orgDir = (libraryRoot: string, id: unknown) => inside(libraryRoot, plainName(String(id ?? "")));

/** An org that exists (a top-level folder with org.json), for callers that must never make a new one by accident. */
export async function existingOrg(libraryRoot: string, id: unknown): Promise<string> {
  const dir = orgDir(libraryRoot, id);
  if (!(await lib.isFile(join(dir, "org.json")))) throw new PathError(`There's no org "${String(id)}". list_orgs shows the orgs.`);
  return dir;
}

export type SceneRef = { name: string; path: string };

/** A template copied into a project's shared scenes, or into one stream. */
export async function sceneFromTemplate(libraryRoot: string, b: { org: unknown; template: string; projectId: string; streamId?: string }, check?: lib.BeforeCreate): Promise<SceneRef> {
  const { name } = await lib.addFromTemplate(orgDir(libraryRoot, b.org), b.template, b.projectId, b.streamId, check);
  const dir = b.streamId ? `projects/${b.projectId}/streams/${b.streamId}` : `projects/${b.projectId}/scenes`;
  return { name, path: `${plainName(String(b.org))}/${dir}/${name}.html` };
}

/** A stream's own copy of a project scene (made if it isn't there yet). */
export async function customizeScene(libraryRoot: string, b: { org: unknown; projectId: string; streamId: string; name: string }): Promise<SceneRef> {
  const { name } = await lib.customize(orgDir(libraryRoot, b.org), b.projectId, b.streamId, b.name);
  return { name, path: `${plainName(String(b.org))}/projects/${b.projectId}/streams/${b.streamId}/${name}.html` };
}

/** A copy of a scene beside it ("<name>-copy"): for the switcher's Duplicate and the agents' duplicate_scene. */
export async function duplicateScene(libraryRoot: string, path: string, check?: lib.BeforeCreate): Promise<SceneRef> {
  // Library paths start with the org id: "/org/…" would come back as a path nothing else accepts.
  if (String(path).startsWith("/")) throw new PathError(`Bad path: ${path}. Paths start with the org id, like "my-channel/templates/brb.html".`);
  // The scene it reads, and the folder the copy goes in (a scene may link back inside from a folder that links out).
  await resolveInLibrary(libraryRoot, path);
  await resolveInLibrary(libraryRoot, dirname(path), { forWrite: true });
  const { name } = await lib.duplicate(libraryRoot, path, check);
  return { name, path: `${path.slice(0, path.lastIndexOf("/"))}/${name}.html` };
}

export type OnAirRequest = { path: string; label?: string; projectId?: string; streamId?: string };

/**
 * The on-air record for a scene: its org's ground color and the transition that plays for it. Refuses
 * a scene that isn't there: the program page would put the 404 on stream.
 */
export async function onAirFor(libraryRoot: string, b: OnAirRequest): Promise<OnAir> {
  // The program page loads it from /library/, which serves only what this rule allows.
  const file = await resolveInLibrary(libraryRoot, b.path);
  if (!String(b.path).endsWith(".html") || !(await lib.isFile(file))) {
    throw new PathError(`There's no scene at ${b.path}. It may have been renamed or deleted.`);
  }
  const o = await lib.readOrg(libraryRoot, orgOf(b.path));
  const transition = await lib.resolveTransition(libraryRoot, b.path);
  return { path: b.path, org: o.id, ground: o.ground, transition, label: String(b.label ?? b.path), projectId: b.projectId, streamId: b.streamId };
}

/** The on-air record after the scene on air was renamed: new path, and the new name in its label. */
export function renamedOnAir(on: OnAir, from: string, name: unknown, r: Extract<RenameResult, { ok: true }>): OnAir {
  // The label is "<scene> · <stream>": swap the scene's old name for the new one, keep the rest.
  const n = String(name).replace(/\s+/g, " ").trim();
  const label = r.was && on.label.startsWith(r.was) ? n + on.label.slice(r.was.length) : on.label.includes(" · ") ? n + on.label.slice(on.label.lastIndexOf(" · ")) : n;
  return { ...on, path: r.path, label, renamedFrom: r.path !== from ? from : on.renamedFrom };
}
