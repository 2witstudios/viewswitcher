// What a library path names. Paths sent to and from clients start with the org id
// ("daisy/projects/ld/scenes/teaching.html"); everything else about where a file is (a template, a
// set's view, a stream's copy, a transition) follows from the folders after it, the same folders
// the library scan lists. This reads a path only: whether it's safe to use is paths.ts's `inside()`.
import type { SceneOrigin } from "./types";

/**
 * - `template`, `project`, `stream`: a view, by where it lives (its `SceneOrigin`): `templates/<name>.html`
 *   or `templates/<set>/<name>.html`; `projects/<p>/scenes/<name>.html`; `projects/<p>/streams/<s>/<name>.html`.
 * - `transition`: the org's (`templates/_shared/transition.html`), a set's (`templates/<set>/_shared/transition.html`)
 *   or a project's (`projects/<p>/transition.html`).
 * - `shared`: anything else in the org's or a set's `_shared/` (its theme, scripts, brand files).
 * - `asset`: a file in the org's `assets/` or a set's.
 * - `set`: a template set's folder or its `pack.json`.
 * - `org`: the org's folder, or a file right in it (`org.json`, `BRAND.md`).
 * - `other`: anything else (a project's or a stream's folder or manifest, a folder the scan doesn't list).
 */
export type LibraryPathKind = SceneOrigin | "transition" | "shared" | "asset" | "set" | "org" | "other";

export type LibraryPath = {
  org: string;
  kind: LibraryPathKind;
  /** The path after the org id ("" for the org's folder). */
  rest: string;
  /** The template set it's in, for anything under `templates/<set>/`. */
  set?: string;
  /** The project it's in, for anything under `projects/<p>/`. */
  project?: string;
  /** The stream it's in, for anything under `projects/<p>/streams/<s>/`. */
  stream?: string;
  /** For a view, its file name without ".html" (the name a stream's copy shares); otherwise the last segment. */
  name: string;
};

/** A folder the scan lists (a set, a project, a stream): never a dot-folder or one starting with "_". */
const listed = (segment: string | undefined): segment is string => !!segment && !segment.startsWith(".") && !segment.startsWith("_");
/** A view's file: exactly ".html" (the scan skips "brb.HTML"), never a dot-file. */
const viewFile = (segment: string | undefined): segment is string => !!segment && segment.endsWith(".html") && segment.length > 5 && !segment.startsWith(".");
const TRANSITION = "transition.html";

/** What `path` names in its org. A trailing "/" is ignored; an empty segment makes it `other`. */
export function parseLibraryPath(path: string): LibraryPath {
  const parts = String(path ?? "").replace(/\/+$/, "").split("/");
  const org = parts[0] ?? "";
  const rest = parts.slice(1);
  const out = (kind: LibraryPathKind, extra: Partial<LibraryPath> = {}): LibraryPath => ({ org, kind, rest: rest.join("/"), name: rest.at(-1) ?? org, ...extra });
  const view = (kind: SceneOrigin, file: string, extra: Partial<LibraryPath> = {}) => out(kind, { ...extra, name: file.slice(0, -".html".length) });
  if (!org || rest.some((s) => s === "")) return out("other");
  if (rest.length === 0) return out("org");
  const [top, a, b, c, d] = rest;
  if (rest.length === 1) return out(top === "templates" || top === "assets" || top === "projects" ? "other" : "org");

  if (top === "templates") {
    if (rest.length === 2 && viewFile(a)) return view("template", a);
    if (a === "_shared") return rest.length === 3 && b === TRANSITION ? out("transition") : out(rest.length > 2 ? "shared" : "other");
    // A set's folder is named by its pack id (a slug), so "brb.HTML" here is a file, not a set.
    if (!listed(a) || a.includes(".")) return out("other");
    const set = { set: a };
    if (rest.length === 2 || (rest.length === 3 && b === "pack.json")) return out("set", set);
    if (rest.length === 3 && viewFile(b)) return view("template", b, set);
    if (b === "_shared" && rest.length > 3) return out(rest.length === 4 && c === TRANSITION ? "transition" : "shared", set);
    if (b === "assets" && rest.length > 3) return out("asset", set);
    return out("other", set);
  }
  if (top === "assets") return out("asset");
  if (top === "projects" && listed(a)) {
    const project = { project: a };
    if (rest.length === 3 && b === TRANSITION) return out("transition", project);
    if (b === "scenes" && rest.length === 4 && viewFile(c)) return view("project", c, project);
    if (b === "streams" && listed(c)) {
      const stream = { ...project, stream: c };
      if (rest.length === 5 && viewFile(d)) return view("stream", d, stream);
      return out("other", stream);
    }
    return out("other", project);
  }
  return out("other");
}

/** A view (something that can go on air), by its path. */
export const isViewPath = (p: LibraryPath): p is LibraryPath & { kind: SceneOrigin } => p.kind === "template" || p.kind === "project" || p.kind === "stream";

/** The org a library path belongs to: its first segment. */
export const orgOf = (path: string) => parseLibraryPath(path).org;

/** For a stream's view, the project view it is a copy of (same file name), whether or not that exists; else null. */
export function projectViewOf(path: string): string | null {
  const p = parseLibraryPath(path);
  return p.kind === "stream" ? `${p.org}/projects/${p.project}/scenes/${p.name}.html` : null;
}

/**
 * Where a view's transition can live, most specific first: its template set's
 * `_shared/transition.html`, its project's `transition.html`, then the org's default.
 */
export function transitionCandidates(path: string): string[] {
  const { org, set, project } = parseLibraryPath(path);
  const found = [];
  if (set) found.push(`${org}/templates/${set}/_shared/${TRANSITION}`);
  if (project) found.push(`${org}/projects/${project}/${TRANSITION}`);
  found.push(`${org}/templates/_shared/${TRANSITION}`);
  return found;
}

/** How requests name a template: "brb" for the org's own, "neon/brb" for one in the template set "neon". */
export const templateId = (t: { name: string; set?: string }) => (t.set ? `${t.set}/${t.name}` : t.name);

/** A template id read back: its set (null for the org's own) and view name; null when it has more parts. */
export function parseTemplateId(id: string): { set: string | null; name: string } | null {
  const parts = String(id ?? "").split("/");
  if (parts.length > 2) return null;
  return { set: parts.length === 2 ? parts[0]! : null, name: parts.at(-1)! };
}

/** /library/<path> with each segment encoded, so a "#", "?" or "%" in a file name survives. */
export const libraryUrl = (path: string) => `/library/${path.split("/").map(encodeURIComponent).join("/")}`;
