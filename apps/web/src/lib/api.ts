import type { Library, LiveState, Org } from "@viewswitcher/shared";

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
  reportSlots: (b: { path: string; slots: unknown[] }) => post("/api/program/slots", b),

  createProject: (org: string, name: string, templates: string[]) => post<{ projectId: string }>("/api/projects", { org, name, templates }),
  createStream: (org: string, projectId: string, name: string, date: string) =>
    post<{ projectId: string; streamId: string }>("/api/streams", { org, projectId, name, date }),
  addFromTemplate: (org: string, template: string, projectId: string, streamId?: string) =>
    post<{ name: string }>("/api/scenes/from-template", { org, template, projectId, streamId }),
  customize: (org: string, projectId: string, streamId: string, name: string) => post("/api/scenes/customize", { org, projectId, streamId, name }),
  revert: (org: string, projectId: string, streamId: string, name: string) => post("/api/scenes/revert", { org, projectId, streamId, name }),
  duplicate: (path: string) => post("/api/scenes/duplicate", { path }),
  open: (path: string) => post("/api/open", { path }),

  toggleRecord: () => post("/api/obs/record"),
  toggleStream: () => post("/api/obs/stream"),

  upload: async (org: string, files: FileList | File[]) => {
    const form = new FormData();
    form.append("org", org);
    for (const f of Array.from(files)) form.append("file", f);
    const res = await fetch("/api/assets", { method: "POST", body: form });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Upload failed");
    return res.json();
  },
};

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
