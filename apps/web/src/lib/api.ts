import type { Library, LiveState } from "@daisy/shared";

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
  library: async (): Promise<Library> => (await fetch("/api/library")).json(),
  state: async (): Promise<LiveState> => (await fetch("/api/state")).json(),

  putOnAir: (b: { path: string; label: string; projectId?: string; streamId?: string }) => post("/api/onair", b),
  reportSlots: (b: { path: string; slots: unknown[] }) => post("/api/program/slots", b),

  createProject: (name: string, templates: string[]) => post<{ projectId: string }>("/api/projects", { name, templates }),
  createStream: (projectId: string, name: string, date: string) =>
    post<{ projectId: string; streamId: string }>("/api/streams", { projectId, name, date }),
  addFromTemplate: (template: string, projectId: string, streamId?: string) =>
    post<{ name: string }>("/api/scenes/from-template", { template, projectId, streamId }),
  customize: (projectId: string, streamId: string, name: string) => post("/api/scenes/customize", { projectId, streamId, name }),
  revert: (projectId: string, streamId: string, name: string) => post("/api/scenes/revert", { projectId, streamId, name }),
  duplicate: (path: string) => post("/api/scenes/duplicate", { path }),
  open: (path: string) => post("/api/open", { path }),

  toggleRecord: () => post("/api/obs/record"),
  toggleStream: () => post("/api/obs/stream"),

  upload: async (files: FileList | File[]) => {
    const form = new FormData();
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
