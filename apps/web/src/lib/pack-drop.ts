import type { PackScripts } from "@viewswitcher/shared";
// What a template pack dropped on the Templates page is (EDIT-24): one .zip, or a folder's files with
// their paths inside it. The server checks everything again; this only collects.
export type DroppedPack = { zip: File } | { files: { path: string; file: File }[] } | null;

/** Stop collecting a folder well past what any pack may hold (the server refuses it anyway). */
const MAX_FILES = 2000;

async function walk(entry: FileSystemEntry, out: { path: string; file: File }[]) {
  if (out.length > MAX_FILES) return;
  if (entry.isFile) {
    const file = await new Promise<File>((ok, fail) => (entry as FileSystemFileEntry).file(ok, fail));
    out.push({ path: entry.fullPath.replace(/^\/+/, ""), file });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries returns a batch at a time, until an empty one.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail));
    if (!batch.length) break;
    for (const e of batch) await walk(e, out);
  }
}

/** Call from the drop event itself: the entries are only readable during it. */
export function readDrop(dt: DataTransfer): Promise<DroppedPack> {
  const items = Array.from(dt.items ?? []);
  const entries = items.map((i) => (i.kind === "file" ? i.webkitGetAsEntry?.() ?? null : null));
  const files = Array.from(dt.files ?? []);
  const zip = files.find((f) => /\.zip$/i.test(f.name) || f.type === "application/zip");
  if (files.length === 1 && zip && !entries[0]?.isDirectory) return Promise.resolve({ zip });
  const dirs = entries.filter((e): e is FileSystemEntry => !!e?.isDirectory);
  if (!dirs.length) return Promise.resolve(zip ? { zip } : null);
  return (async () => {
    const out: { path: string; file: File }[] = [];
    // One folder dropped: it's the pack. Its name is stripped as the pack's wrapping folder.
    for (const d of dirs.slice(0, 1)) await walk(d, out);
    return { files: out };
  })();
}

/** A pack chosen with Import (a .zip). */
export const fromPicker = (list: FileList | null): DroppedPack => {
  const f = list?.[0];
  return f ? { zip: f } : null;
};

/** Plain words for what a pack runs (EDIT-26). */
export function describeScripts(s: PackScripts & { standard: boolean }): string[] {
  const out: string[] = [];
  if (!s.files.length && !s.inline.length && !s.remote.length) return ["It runs no scripts."];
  const own = s.files.filter((f) => !(s.standard && f === "_shared/scene.js"));
  if (s.standard && s.files.includes("_shared/scene.js")) out.push("ViewSwitcher's standard scene script (countdowns, transition effects).");
  if (own.length) out.push(`Its own scripts: ${own.join(", ")}.`);
  if (s.inline.length) out.push(`Code written into ${s.inline.map((p) => p.replace(/^templates\//, "")).join(", ")}.`);
  if (s.remote.length) out.push(`Scripts from other sites: ${s.remote.join(", ")}.`);
  return out;
}

