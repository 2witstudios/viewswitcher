// One org's content for the switcher and agents (GET /api/library, scan_library).
//
// The library is read on every change by every client (and by agents), so a scan reads as little
// as it can: scene titles are kept while the file's stat stamp (size, times, inode) stays the same,
// and dropped for the paths the watcher reports (scene-titles.ts); folders are walked side by side.
// File reads and stats go through one bounded queue, so a big library can't run out of open files.
//
// Nothing outside the library is read, even through a link (contain.ts, the rule every read follows):
// a folder the scan reads, a JSON file, or a view or picture that is a link is checked first, and one
// that leads outside is left out. Plain files in a folder that's inside are inside, so most files cost
// no extra check.
//
// A finished scan is kept too, briefly, per org: every client (and an agent) lists the library right
// after the same change, and they share one scan, even one still in flight. It's dropped for the orgs
// the watcher sees change and whenever the switcher or an agent changes something (changed()), so a
// listing asked for after a change always reads after it. Kept only KEEP_MS past its end, so a change
// the watcher missed shows at most that much later than it would without the cache.
//
// The cache and the queue belong to one LibraryScanner, which main.ts makes and hands to the
// switcher's routes and the MCP server, so both share them and their lifetime is the server's; a
// test makes its own and shares nothing with another.
import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { isViewFile, ORG_TRANSITION, readManifest, TRANSITION_FILE as TRANSITION } from "@viewswitcher/shared";
import type { Asset, AssetKind, OrgContent, Project, Scene, SceneOrigin, Stream, TemplateSet } from "@viewswitcher/shared";
import { exists, readOrg } from "../library";
import { limit } from "../limit";
import { inside, plainName } from "../paths";
import { createSceneTitles } from "../scene-titles";
import { resolveInLibrary } from "./contain";
import { dirs as listDirs, type Io, readJson as readJsonFile } from "./read";

const KINDS: Record<string, AssetKind> = {
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image", ".svg": "image", ".avif": "image",
  ".mp4": "video", ".mov": "video", ".webm": "video", ".m4v": "video",
  ".mp3": "audio", ".wav": "audio", ".m4a": "audio", ".aac": "audio", ".ogg": "audio",
};

/** How long a finished scan answers later requests for its org, unless a change drops it first. */
export const KEEP_MS = 2_000;

type Kept = { content: Promise<OrgContent>; done: number | null };

/** `value`, and everything in it, made read-only: one scan is shared by every request, so none may change it. */
function frozen<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) frozen(v);
  }
  return value;
}

export class LibraryScanner {
  /** File reads and stats for this scanner's scans: at most `concurrency` at once, across every scan. */
  private readonly io: Io;
  private readonly titles;
  private readonly kept = new Map<string, Kept>();
  private readonly keepMs: number;
  private readonly now: () => number;

  constructor(readonly libraryRoot: string, { concurrency = 32, keepMs = KEEP_MS, now = Date.now }: { concurrency?: number; keepMs?: number; now?: () => number } = {}) {
    const io = limit(concurrency);
    this.io = io;
    this.keepMs = keepMs;
    this.now = now;
    this.titles = createSceneTitles({ stat: (abs) => io(() => stat(abs)), read: (abs) => io(() => readFile(abs, "utf8")) });
  }

  /**
   * Library paths the watcher reported (library-relative): their titles are read again, and their
   * orgs scanned again, on the next request.
   */
  forget(paths: string[]) {
    this.titles.forget(this.libraryRoot, paths);
    for (const p of paths) this.kept.delete(p.split("/")[0]!);
  }

  /**
   * A path the watcher just saw change (library-relative): its org is scanned again on the next
   * request, from now on rather than from the report a little later (forget).
   */
  touched(path: string) {
    this.kept.delete(path.split("/")[0]!);
  }

  /** The switcher or an agent changed the library: every org is scanned again on the next request. */
  changed() {
    this.kept.clear();
  }

  /**
   * One org's content; every returned path starts with the org id. Requests for the same org share
   * a scan in flight, and one finished less than KEEP_MS ago with nothing changed since. Read-only.
   */
  scanOrg(orgId: string): Promise<OrgContent> {
    const known = this.kept.get(orgId);
    if (known && (known.done === null || this.now() - known.done < this.keepMs)) return known.content;
    const entry: Kept = { content: this.scan(orgId).then(frozen), done: null };
    this.kept.set(orgId, entry);
    entry.content.then(
      () => (entry.done = this.now()),
      () => this.kept.get(orgId) === entry && this.kept.delete(orgId),
    );
    return entry.content;
  }

  private async scan(orgId: string): Promise<OrgContent> {
    const orgDir = inside(this.libraryRoot, plainName(orgId));
    const prefix = `${orgId}/`; // readOrg's id is the one asked for, so nothing waits for org.json
    const [org, templates, sets, assets, projects, transition] = await Promise.all([
      readOrg(this.libraryRoot, orgId),
      this.readJson(orgDir, "templates/_shared/order.json", { order: [] as string[] }).then((meta) => this.scenesIn(orgDir, "templates", "template", meta.order, prefix)),
      this.listSets(orgDir, prefix),
      this.listAssets(orgDir, prefix),
      this.dirs(orgDir, "projects").then((ids) => Promise.all(ids.map((id) => this.scanProject(orgDir, prefix, id)))),
      this.urlIfThere(orgDir, ORG_TRANSITION, `${prefix}${ORG_TRANSITION}`),
    ]);
    return { org, templates, sets, assets, projects, transition };
  }

  /** Whether `rel` in the org folder `orgDir` is really in the library, through any links (contain.ts). */
  private inLibrary = (orgDir: string, rel: string) =>
    this.io(() => resolveInLibrary(this.libraryRoot, `${relative(this.libraryRoot, orgDir).split(sep).join("/")}/${rel}`)).then(() => true, () => false);
  /** The folders the library lists in `rel`, when `rel` itself is in the library (a listed folder is never a link: isDirectory). */
  private dirs = async (orgDir: string, rel: string) => ((await this.inLibrary(orgDir, rel)) ? listDirs(join(orgDir, rel), this.io) : []);
  /** The entries of the folder `rel`, when it's in the library; none when it isn't or can't be read. */
  private entries = async (orgDir: string, rel: string): Promise<Dirent[]> =>
    (await this.inLibrary(orgDir, rel)) ? this.io(() => readdir(join(orgDir, rel), { withFileTypes: true })).catch(() => []) : [];
  /** Entries of a folder that's inside the library: a plain file is inside too; a link is checked. */
  private plainOrInside = (orgDir: string, rel: string, e: Dirent) => (e.isSymbolicLink() ? this.inLibrary(orgDir, `${rel}/${e.name}`) : Promise.resolve(true));
  private readJson = async <T>(orgDir: string, rel: string, fallback: T) => ((await this.inLibrary(orgDir, rel)) ? readJsonFile(join(orgDir, rel), fallback, this.io) : fallback);
  /** `url` when the file `rel` is there, in the library, else null (a transition, for the library listing). */
  private urlIfThere = async (orgDir: string, rel: string, url: string) =>
    (await this.io(() => exists(join(orgDir, rel)))) && (await this.inLibrary(orgDir, rel)) ? url : null;

  private async scenesIn(orgDir: string, rel: string, origin: SceneOrigin, order: string[], prefix: string, set?: string): Promise<Scene[]> {
    const listed = (await this.entries(orgDir, rel)).filter((e) => isViewFile(e.name) && !e.isDirectory());
    const files = (await Promise.all(listed.map(async (e) => ((await this.plainOrInside(orgDir, rel, e)) ? e.name : null)))).filter((f): f is string => f !== null);
    const scenes = await Promise.all(
      files.map(async (f) => {
        const name = f.slice(0, -5);
        const title = await this.titles.titleOf(join(orgDir, rel, f));
        return { name, label: title || name.replace(/-/g, " "), path: `${prefix}${rel}/${f}`, origin, ...(set ? { set } : {}) } satisfies Scene;
      }),
    );
    const ranks = new Map(order.map((n, i) => [n, i] as const).reverse()); // a name listed twice ranks by its first place
    const rank = (n: string) => ranks.get(n) ?? order.length;
    return scenes.sort((a, b) => rank(a.name) - rank(b.name) || a.label.localeCompare(b.label));
  }

  private async listAssets(orgDir: string, prefix: string): Promise<Asset[]> {
    try {
      const listed = (await this.entries(orgDir, "assets")).filter((e) => !e.name.startsWith("."));
      const names = (await Promise.all(listed.map(async (e) => ((await this.plainOrInside(orgDir, "assets", e)) ? e.name : null)))).filter((n): n is string => n !== null);
      const assets = await Promise.all(
        names.map(async (name) => {
          // One that's gone since the listing (a replace, a delete, a broken link) is left out, not the rest with it.
          const s = await this.io(() => stat(join(orgDir, "assets", name))).catch(() => null);
          return { name, path: `${prefix}assets/${name}`, kind: KINDS[extname(name).toLowerCase()] ?? "other", size: s?.size ?? 0 } satisfies Asset;
        }),
      );
      return assets.filter((a) => a.size > 0).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  private async scanProject(orgDir: string, prefix: string, id: string): Promise<Project> {
    const p = await this.readJson(orgDir, `projects/${id}/project.json`, { name: id, order: [] as string[] });
    const [scenes, streams, transition] = await Promise.all([
      this.scenesIn(orgDir, `projects/${id}/scenes`, "project", p.order, prefix),
      this.dirs(orgDir, `projects/${id}/streams`).then((ids) =>
        Promise.all(
          ids.map(async (sid): Promise<Stream> => {
            const rel = `projects/${id}/streams/${sid}`;
            const [s, scenes] = await Promise.all([this.readJson(orgDir, `${rel}/stream.json`, { name: sid, date: "" }), this.scenesIn(orgDir, rel, "stream", p.order, prefix)]);
            return { id: sid, name: s.name, date: s.date, scenes };
          }),
        ),
      ),
      this.urlIfThere(orgDir, `projects/${id}/${TRANSITION}`, `${prefix}projects/${id}/${TRANSITION}`),
    ]);
    streams.sort((a, b) => (a.date || a.id).localeCompare(b.date || b.id));
    return { id, name: p.name, scenes, streams, transition };
  }

  // An installed template pack is a folder templates/<set>/ with its pack.json, its views, _shared/ and
  // assets/ (see packs.ts and docs/template-packs.md). The org's own templates stay in templates/*.html.

  /** The org's template sets: folders in templates/ that have a pack.json. */
  private async listSets(orgDir: string, prefix: string): Promise<TemplateSet[]> {
    const found = await Promise.all(
      (await this.dirs(orgDir, "templates")).map(async (id): Promise<TemplateSet | null> => {
        const manifest = `templates/${id}/pack.json`;
        const text = (await this.inLibrary(orgDir, manifest)) ? await this.io(() => readFile(join(orgDir, manifest), "utf8")).catch(() => null) : null;
        if (text === null) return null;
        const read = readManifest(text);
        // A pack.json someone edited by hand into something odd: still list the set, by its folder.
        const m = read.ok ? read.manifest : { name: id, version: "", description: "", views: [] as string[] };
        const rel = `templates/${id}`;
        const [templates, transition] = await Promise.all([
          this.scenesIn(orgDir, rel, "template", m.views, prefix, id),
          this.urlIfThere(orgDir, `${rel}/_shared/${TRANSITION}`, `${prefix}${rel}/_shared/${TRANSITION}`),
        ]);
        return { id, name: m.name, version: m.version, description: m.description, ...("author" in m && m.author ? { author: m.author } : {}), templates, transition };
      }),
    );
    return found.filter((s): s is TemplateSet => s !== null).sort((a, b) => a.name.localeCompare(b.name));
  }
}
