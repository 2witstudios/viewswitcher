// One org's content for the switcher and agents (GET /api/library, scan_library).
//
// The library is read on every change by every client (and by agents), so a scan reads as little
// as it can: scene titles are kept while the file's stat stamp (size, times, inode) stays the same,
// and dropped for the paths the watcher reports (scene-titles.ts); folders are walked side by side.
// File reads and stats go through one bounded queue, so a big library can't run out of open files.
//
// The cache and the queue belong to one LibraryScanner, which main.ts makes and hands to the
// switcher's routes and the MCP server, so both share them and their lifetime is the server's; a
// test makes its own and shares nothing with another.
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { isViewFile, ORG_TRANSITION, readManifest, TRANSITION_FILE as TRANSITION } from "@viewswitcher/shared";
import type { Asset, AssetKind, OrgContent, Project, Scene, SceneOrigin, Stream, TemplateSet } from "@viewswitcher/shared";
import { exists, readOrg } from "../library";
import { limit } from "../limit";
import { inside, plainName } from "../paths";
import { createSceneTitles } from "../scene-titles";
import { dirs as listDirs, type Io, readJson as readJsonFile } from "./read";

const KINDS: Record<string, AssetKind> = {
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image", ".svg": "image", ".avif": "image",
  ".mp4": "video", ".mov": "video", ".webm": "video", ".m4v": "video",
  ".mp3": "audio", ".wav": "audio", ".m4a": "audio", ".aac": "audio", ".ogg": "audio",
};

export class LibraryScanner {
  /** File reads and stats for this scanner's scans: at most `concurrency` at once, across every scan. */
  private readonly io: Io;
  private readonly titles;

  constructor(readonly libraryRoot: string, { concurrency = 32 }: { concurrency?: number } = {}) {
    const io = limit(concurrency);
    this.io = io;
    this.titles = createSceneTitles({ stat: (abs) => io(() => stat(abs)), read: (abs) => io(() => readFile(abs, "utf8")) });
  }

  /** Library paths the watcher reported (library-relative): their titles are read again on the next scan. */
  forget(paths: string[]) {
    this.titles.forget(this.libraryRoot, paths);
  }

  /** One org's content; every returned path starts with the org id. */
  async scanOrg(orgId: string): Promise<OrgContent> {
    const orgDir = inside(this.libraryRoot, plainName(orgId));
    const prefix = `${orgId}/`; // readOrg's id is the one asked for, so nothing waits for org.json
    const [org, templates, sets, assets, projects, transition] = await Promise.all([
      readOrg(this.libraryRoot, orgId),
      this.readJson(join(orgDir, "templates/_shared/order.json"), { order: [] as string[] }).then((meta) => this.scenesIn(orgDir, "templates", "template", meta.order, prefix)),
      this.listSets(orgDir, prefix),
      this.listAssets(orgDir, prefix),
      this.dirs(join(orgDir, "projects")).then((ids) => Promise.all(ids.map((id) => this.scanProject(orgDir, prefix, id)))),
      this.urlIfThere(join(orgDir, ORG_TRANSITION), `${prefix}${ORG_TRANSITION}`),
    ]);
    return { org, templates, sets, assets, projects, transition };
  }

  private dirs = (path: string) => listDirs(path, this.io);
  private readJson = <T>(path: string, fallback: T) => readJsonFile(path, fallback, this.io);
  /** `url` when the file `abs` is there, else null (a transition, for the library listing). */
  private urlIfThere = (abs: string, url: string) => this.io(() => exists(abs)).then((t) => (t ? url : null));

  private async scenesIn(orgDir: string, rel: string, origin: SceneOrigin, order: string[], prefix: string, set?: string): Promise<Scene[]> {
    let files: string[] = [];
    try {
      files = (await this.io(() => readdir(join(orgDir, rel)))).filter(isViewFile);
    } catch {
      return [];
    }
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
      const names = (await this.io(() => readdir(join(orgDir, "assets")))).filter((n) => !n.startsWith("."));
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
    const dir = join(orgDir, "projects", id);
    const p = await this.readJson(join(dir, "project.json"), { name: id, order: [] as string[] });
    const [scenes, streams, transition] = await Promise.all([
      this.scenesIn(orgDir, `projects/${id}/scenes`, "project", p.order, prefix),
      this.dirs(join(dir, "streams")).then((ids) =>
        Promise.all(
          ids.map(async (sid): Promise<Stream> => {
            const rel = `projects/${id}/streams/${sid}`;
            const [s, scenes] = await Promise.all([this.readJson(join(orgDir, rel, "stream.json"), { name: sid, date: "" }), this.scenesIn(orgDir, rel, "stream", p.order, prefix)]);
            return { id: sid, name: s.name, date: s.date, scenes };
          }),
        ),
      ),
      this.urlIfThere(join(dir, TRANSITION), `${prefix}projects/${id}/${TRANSITION}`),
    ]);
    streams.sort((a, b) => (a.date || a.id).localeCompare(b.date || b.id));
    return { id, name: p.name, scenes, streams, transition };
  }

  // An installed template pack is a folder templates/<set>/ with its pack.json, its views, _shared/ and
  // assets/ (see packs.ts and docs/template-packs.md). The org's own templates stay in templates/*.html.

  /** The org's template sets: folders in templates/ that have a pack.json. */
  private async listSets(orgDir: string, prefix: string): Promise<TemplateSet[]> {
    const found = await Promise.all(
      (await this.dirs(join(orgDir, "templates"))).map(async (id): Promise<TemplateSet | null> => {
        const text = await this.io(() => readFile(join(orgDir, "templates", id, "pack.json"), "utf8")).catch(() => null);
        if (text === null) return null;
        const read = readManifest(text);
        // A pack.json someone edited by hand into something odd: still list the set, by its folder.
        const m = read.ok ? read.manifest : { name: id, version: "", description: "", views: [] as string[] };
        const rel = `templates/${id}`;
        const [templates, transition] = await Promise.all([
          this.scenesIn(orgDir, rel, "template", m.views, prefix, id),
          this.urlIfThere(join(orgDir, rel, "_shared", TRANSITION), `${prefix}${rel}/_shared/${TRANSITION}`),
        ]);
        return { id, name: m.name, version: m.version, description: m.description, ...("author" in m && m.author ? { author: m.author } : {}), templates, transition };
      }),
    );
    return found.filter((s): s is TemplateSet => s !== null).sort((a, b) => a.name.localeCompare(b.name));
  }
}
