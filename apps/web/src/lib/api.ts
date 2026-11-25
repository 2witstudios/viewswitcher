import type { AgentClients, AgentOnAir, Library, LiveState, Org, SceneEdit } from "@viewswitcher/shared";
import { libraryUrl } from "./live";

/** Preview order, per editor page: `session` tells editors apart (clocks on two devices needn't agree). */
const previewSession = Math.random().toString(36).slice(2);
let previewSeq = 0;
const nextPreviewSeq = () => ++previewSeq;

/** The scene editor saving against a version of the file that isn't the latest any more. */
export class SceneConflict extends Error {}

async function post<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data as T;
}

export const api = {
  orgs: async (): Promise<Org[]> => (await fetch("/api/orgs")).json(),
  createOrg: (name: string, accent?: string) => post<{ orgId: string }>("/api/orgs", { name, accent }),
  library: async (org: string): Promise<Library> => {
    const res = await fetch(`/api/library?org=${encodeURIComponent(org)}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
    return res.json();
  },
  state: async (): Promise<LiveState> => (await fetch("/api/state")).json(),

  putOnAir: (b: { path: string; label: string; projectId?: string; streamId?: string }) => post("/api/onair", b),
  reportSlots: (b: { path: string; slots: unknown[]; page?: string; seq?: number }) => post("/api/program/slots", b),

  createProject: (org: string, name: string, templates: string[]) => post<{ projectId: string }>("/api/projects", { org, name, templates }),
  createStream: (org: string, projectId: string, name: string, date: string) =>
    post<{ projectId: string; streamId: string }>("/api/streams", { org, projectId, name, date }),
  addFromTemplate: (org: string, template: string, projectId: string, streamId?: string) =>
    post<{ name: string; path: string }>("/api/scenes/from-template", { org, template, projectId, streamId }),
  customize: (org: string, projectId: string, streamId: string, name: string) => post<{ name: string; path: string }>("/api/scenes/customize", { org, projectId, streamId, name }),
  revert: (org: string, projectId: string, streamId: string, name: string) => post("/api/scenes/revert", { org, projectId, streamId, name }),
  customizeTransition: (org: string, projectId: string) => post("/api/transition/customize", { org, projectId }),
  revertTransition: (org: string, projectId: string) => post("/api/transition/revert", { org, projectId }),
  duplicate: (path: string) => post<{ name: string; path: string }>("/api/scenes/duplicate", { path }),

  /** The scene tagged with data-vs ids, and the hash of the file it came from. */
  sceneForEdit: async (path: string): Promise<{ html: string; hash: string }> => {
    const res = await fetch(`${libraryUrl(path)}?edit`, { cache: "no-store" });
    if (!res.ok) throw new Error(res.status === 404 ? "This scene doesn't exist any more" : res.statusText);
    const hash = res.headers.get("x-scene-hash");
    if (!hash) throw new Error("This scene can't be edited here. Open the file instead.");
    return { html: await res.text(), hash };
  },
  /** Save edits made against the version `hash`. Throws SceneConflict if the file changed since. */
  editScene: async (path: string, hash: string, edits: SceneEdit[]): Promise<{ hash: string }> => {
    const res = await fetch("/api/scene/edit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, hash, edits }) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) throw new SceneConflict(data.error ?? "This scene changed");
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    return data;
  },
  /** Rename a scene (its title, and a stream scene's file). Throws SceneConflict if the file changed since `hash`. */
  renameScene: async (path: string, hash: string, name: string): Promise<{ hash: string; path: string }> => {
    const res = await fetch("/api/scene/rename", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, hash, name }) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) throw new SceneConflict(data.error ?? "This scene changed");
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    return data;
  },
  /** Show an edit live on the program page; `hash` is the file version its id belongs to. */
  previewScene: (path: string, hash: string, edit: SceneEdit) => post("/api/scene/preview", { path, hash, edit, session: previewSession, seq: nextPreviewSeq() }),
  /** The same, from a page that's going away (survives pagehide). */
  previewSceneBeacon: (path: string, hash: string, edit: SceneEdit) =>
    navigator.sendBeacon?.("/api/scene/preview", new Blob([JSON.stringify({ path, hash, edit, session: previewSession, seq: nextPreviewSeq() })], { type: "application/json" })),
  open: (path: string) => post("/api/open", { path }),

  /** What agents connected over MCP may put on air (Edit with AI). */
  agentSettings: (onAir: AgentOnAir) => post("/api/agent/settings", { onAir }),
  /** This Mac's library folder and the commands that connect an agent; null anywhere but on this Mac. */
  info: async (): Promise<AgentInfo | null> => {
    const res = await fetch("/api/info", { cache: "no-store" }).catch(() => null);
    return res?.ok ? res.json() : null;
  },
  /** Which agent apps this Mac has; null anywhere but on this Mac. */
  agentClients: async (): Promise<AgentClients | null> => {
    const res = await fetch("/api/agent/clients", { cache: "no-store" }).catch(() => null);
    return res?.ok ? res.json() : null;
  },

  /** Create the ViewSwitcher scene and sources in OBS (MAC-3). */
  setupObs: () => post<{ log: string[]; missing: string[]; switched: boolean }>("/api/obs/setup"),
  toggleRecord: () => post("/api/obs/record"),
  toggleStream: () => post("/api/obs/stream"),

  upload: async (org: string, files: FileList | File[]): Promise<{ saved: { path: string }[] }> => {
    const form = new FormData();
    form.append("org", org);
    for (const f of Array.from(files)) form.append("file", f);
    const res = await fetch("/api/assets", { method: "POST", body: form });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Upload failed");
    return res.json();
  },
};

export type AgentInfo = { library: string; port: number; claudeCode: string; stdio: string };

/** The Claude Desktop extension made for this install (this Mac only); the Mac app saves and opens it. */
export const MCPB_URL = "/api/agent/viewswitcher.mcpb";

/** Copy text; falls back to a prompt where the clipboard API is unavailable (plain http on the iPad). */
export async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt("Copy this path:", text);
    return false;
  }
}
