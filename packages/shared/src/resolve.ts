import type { Project, Scene, Stream } from "./types";

export type ResolvedStream = {
  /** Scenes that live in the stream folder. `overrides` marks ones replacing a project scene. */
  own: (Scene & { overrides: boolean })[];
  /** Project scenes the stream uses as-is (overridden ones are left out). */
  shared: Scene[];
};

/**
 * The one rule: a stream's scenes are the project's scenes plus the stream's own files,
 * and a stream file with the same name replaces the project's.
 */
export function resolveStream(project: Project, stream: Stream): ResolvedStream {
  const projectNames = new Set(project.scenes.map((s) => s.name));
  const ownNames = new Set(stream.scenes.map((s) => s.name));
  return {
    own: stream.scenes.map((s) => ({ ...s, overrides: projectNames.has(s.name) })),
    shared: project.scenes.filter((s) => !ownNames.has(s.name)),
  };
}

/** Lowercase kebab-case, safe as a folder or file name. */
export function slugify(text: string): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled"
  );
}

/** "2026-12-04" → "Dec 4". */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
