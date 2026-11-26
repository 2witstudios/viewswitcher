// The MCP server: the tools an AI agent (Claude Code, Claude Desktop, Cursor, Codex) uses to read the
// library, change scenes under the switcher's own rules, look at its work, and go on air when that's
// safe. It runs inside the switcher's server and calls the same library functions as /api; it is given
// what it needs (deps) rather than reaching into index.ts.
import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { EditError, orgOf, resolveStream, slugify, templateId } from "@viewswitcher/shared";
import type { LiveState } from "@viewswitcher/shared";
import { z } from "zod";
import { agentGuard, type GuardAction } from "../agent-guard";
import { asDropped, type BuiltinPackFiles } from "../builtin-packs";
import * as lib from "../library";
import { realLibraryPath } from "../library/contain";
import { customizeScene, duplicateScene, existingOrg, type OnAirRequest, sceneFromTemplate } from "../library-actions";
import { checked, listFiles, readText, writeText } from "../library-files";
import { cancelPack, installPack, PackError, stagePack } from "../packs";
import { inside, PathError, plainName } from "../paths";
import type { Previewer, PreviewResult } from "../preview-types";
import { renameScene, scenePath, type RenameResult } from "../scene-edit";
import { type Loaded, loadedFiles, textHash } from "../scene-refs";
import { pathScrub } from "../scrub";
import type { LibraryScanner } from "../library/scanner";

export type McpDeps = {
  /** The library folder. Never shown to the agent: every path it sees starts with an org id. */
  root: string;
  /** Reads an org's content: the switcher's own scanner, so both share its cache and the watcher's reports. */
  scanner: LibraryScanner;
  /** The library kit (config.libraryKit), for the guide when the library has no copy of the skill. */
  kit: string;
  port: number;
  state: () => LiveState;
  /**
   * Put a scene on air exactly as the switcher does (state, persist, publish); resolves to the new
   * state. `check` runs right before the change commits and throws to refuse it.
   */
  goOnAir: (b: OnAirRequest, check?: () => void) => Promise<LiveState>;
  /** After a scene was renamed: keeps the on-air record pointing at it, as the switcher's rename does. */
  renamed: (from: string, name: string, r: Extract<RenameResult, { ok: true }>) => Promise<void>;
  previewer: Previewer;
  /** The built-in template sets (builtin-packs.ts), as the switcher's Add templates lists them. */
  templateSets?: () => Promise<BuiltinPackFiles[]>;
  /** The starter kit's scene.js, which a pack's own copy is compared with on install (packs.ts). */
  starterScript?: string | null;
  /** Whether OBS has said, since it connected, whether it's streaming or recording (OBSClient.outputsKnown). */
  outputsKnown?: () => boolean;
  /** Tests only: runs at write_file's commit instant, before its last check (to change the state right then). */
  onCommit?: () => void;
};

export const INSTRUCTIONS = [
  "ViewSwitcher is a live-stream scene switcher for OBS. Scenes are HTML pages (1920×1080) in a library with one folder per org (brand or channel): templates, assets, projects and their streams. OBS shows the scene on air, with the camera, screen and iPad placed in its slots.",
  "Call get_guide before creating or editing scenes: it has the scene rules (slots, theme, assets, overrides).",
  "Every path starts with the org id, like \"my-channel/templates/brb.html\". list_orgs and scan_library show what's there.",
  "To change a file: read_file it, then write_file with the hash read_file gave you. A stale or missing hash is refused; read again and redo the change.",
  "preview_scene after every visual change, look at the picture, and fix what you see before you say it's done.",
  "To start from a ready-made look, list_template_sets shows the built-in template sets and add_template_set adds one to an org (as the switcher's Add templates does); then scene_from_template makes scenes from its views (\"<set>/<view>\") in a project or stream.",
  "Use the structural tools (scene_from_template, customize_scene, duplicate_scene, rename_scene, customize_transition) instead of copying files by hand.",
  "Only use go_on_air when the user asks. While OBS is streaming or recording, the scene on air and its shared files may be protected; the refusal says what to do instead.",
].join("\n");

const GUIDE = "skills/viewswitcher-scenes/SKILL.md";

/** The scene rules: the library's own copy of the skill (people's edits win), else the kit's. */
export async function readGuide(root: string, kit: string): Promise<string> {
  return readFile(join(root, ".claude", GUIDE), "utf8").catch(() => readFile(join(kit, GUIDE), "utf8"));
}

/** A refusal the agent can act on (shown as the tool's error text). */
class Refusal extends Error {}

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

const orgArg = z.string().describe("The org id (a top-level library folder), from list_orgs.");
const pathArg = (what: string) => z.string().describe(`${what}: a library path starting with the org id, like "my-channel/templates/brb.html".`);
const fullArg = z.boolean().optional().describe("true for the full 1920×1080 picture; the default is 960×540.");

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function createMcpServer(deps: McpDeps): McpServer {
  const { root, port } = deps;
  const { scanner } = deps;
  const server = new McpServer({ name: "viewswitcher", version: "1.0.0" }, { instructions: INSTRUCTIONS, capabilities: { tools: {}, resources: {} } });

  // No absolute path ever reaches the agent, not even inside an error from the file system.
  const scrub = pathScrub(root);

  const text = (data: unknown): CallToolResult => ({ content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });
  const refusal = (message: string): CallToolResult => ({ content: [{ type: "text", text: scrub(message) }], isError: true });
  const run = <A>(fn: (args: A) => Promise<CallToolResult>) => async (args: A): Promise<CallToolResult> => {
    try {
      return await fn(args);
    } catch (e) {
      if (e instanceof Refusal || e instanceof PathError || e instanceof EditError || e instanceof PackError) return refusal(e.message);
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return refusal("That file or folder doesn't exist. scan_library or list_files shows what's there.");
      return refusal(`Couldn't do that: ${(e as Error).message}`);
    }
  };

  /** Where a library path really is (through links), as a library path; the path itself when that can't be told. */
  const realRel = (path: string) => realLibraryPath(root, path);
  /**
   * Live, for the agents' guard: OBS streaming or recording, or connected without having said yet
   * whether it is (just after connecting, before its first status answer). Unknown counts as live.
   */
  const isLive = (s: LiveState) => s.obs.streaming || s.obs.recording || (s.obs.connected && deps.outputsKnown?.() === false);
  /** What the scene on air loads, as the guard needs it (OnAirLoads). */
  type OnAirLoads = Loaded & { pages: string };
  /** The guard (agent-guard.ts) against the state right now; throws the refusal. `loads`: what the scene on air loads. */
  const guardNow = (action: GuardAction, loads?: OnAirLoads) => {
    const s = deps.state();
    const files = loads?.files.flatMap((p) => [p, realRel(p)]);
    const onAir = s.onAir && { path: realRel(s.onAir.path), transition: s.onAir.transition && realRel(s.onAir.transition), loads: files, loadsComplete: loads?.complete };
    // A link to the scene on air is the scene on air.
    const checked: GuardAction = action.kind === "write" ? { kind: "write", paths: action.paths.flatMap((p) => [p, realRel(p)]) } : action;
    const g = agentGuard({ setting: s.agent.onAir, live: isLive(s), onAir, action: checked });
    if (!g.ok) throw new Refusal(g.reason);
  };
  const pagesOnAir = () => {
    const s = deps.state();
    return s.onAir ? [s.onAir.path, s.onAir.transition].filter((p): p is string => !!p) : [];
  };
  /**
   * The files the scene on air (and its transition) load, read only when the guard would use them,
   * or (`evenIfIdle`) whenever something is on air, for a check that runs again later.
   */
  const onAirLoads = async (evenIfIdle = false): Promise<OnAirLoads | undefined> => {
    const s = deps.state();
    if (!s.onAir || s.agent.onAir === "always" || (!evenIfIdle && !isLive(s))) return undefined;
    const pages = pagesOnAir();
    return { ...(await loadedFiles(root, pages)), pages: pages.join("\n") };
  };
  /** Whether every file a scan read still has the text it read (checked synchronously, at a commit instant). */
  const unchanged = (loads: OnAirLoads) =>
    Object.entries(loads.read).every(([p, h]) => {
      try {
        return textHash(readFileSync(inside(root, p), "utf8")) === h;
      } catch {
        return false;
      }
    });
  /**
   * Files a tool reads or writes: each really inside the library, through links too (library-files.ts
   * checked), and so is every folder on the way to it from the org. A new file or folder may get
   * another name in one of them (a free name: "teaching-2", "show-2"), so each folder must be inside
   * on its own, not only through a name further down that links back in.
   */
  const contained = async (...paths: string[]) => {
    for (const p of paths) {
      const parts = p.split("/");
      for (let i = parts.length; i >= 2; i--) await checked(root, parts.slice(0, i).join("/"));
    }
  };
  /**
   * Refuses (throws) a change to `paths` outside the library, or one the agent on-air setting doesn't
   * allow right now. Returns the same check for a file a library helper picks itself (a free name like
   * "brb-2.html" or "logo-2.png"), by its absolute path, to run before it creates it.
   */
  const writes = async (...paths: string[]) => {
    await contained(...paths);
    const loads = await onAirLoads();
    guardNow({ kind: "write", paths }, loads);
    return (abs: string) => guardNow({ kind: "write", paths: [relative(root, abs).split("\\").join("/")] }, loads);
  };
  /** Only the per-name check, for a tool whose file name is chosen by the library helper. */
  const guardFor = async () => {
    const loads = await onAirLoads();
    return (abs: string) => guardNow({ kind: "write", paths: [relative(root, abs).split("\\").join("/")] }, loads);
  };

  const exists = (abs: string) => stat(abs).then(() => true, () => false);
  const needProject = async (org: string, projectId: string) => {
    const dir = await existingOrg(root, org);
    if (!(await exists(inside(dir, `projects/${plainName(projectId)}`)))) throw new Refusal(`${org} has no project "${projectId}". scan_library shows its projects.`);
    return dir;
  };
  const needStream = async (org: string, projectId: string, streamId: string) => {
    const dir = await needProject(org, projectId);
    if (!(await exists(inside(dir, `projects/${projectId}/streams/${plainName(streamId)}`)))) throw new Refusal(`Project ${projectId} has no stream "${streamId}". scan_library shows its streams.`);
    return dir;
  };
  /** A template by its name: "brb", or "<set>/<view>" for one from an installed template set (library.ts templateFile). */
  const templateAt = (org: string, dir: string, template: string) => {
    const { file, name } = lib.templateFile(dir, template);
    return { file, name, path: `${plainName(org)}/${relative(dir, file).split("\\").join("/")}` };
  };
  const needScene = async (path: string) => {
    if (!(await exists(scenePath(root, path)))) throw new Refusal(`There's no scene at ${path}. scan_library shows the scenes.`);
  };

  const stateView = (s: LiveState) => ({
    onAir: s.onAir ? { path: s.onAir.path, label: s.onAir.label, org: s.onAir.org, projectId: s.onAir.projectId ?? null, streamId: s.onAir.streamId ?? null, transition: s.onAir.transition ?? null } : null,
    live: s.obs.streaming || s.obs.recording,
    obs: s.obs,
    obsSetup: s.obsSetup,
    warnings: s.warnings,
    agent: { onAir: s.agent.onAir },
  });

  const picture = (r: PreviewResult, what: string): CallToolResult =>
    r.ok
      ? { content: [{ type: "image", data: Buffer.from(r.png).toString("base64"), mimeType: "image/png" }, { type: "text", text: `${what} (${r.width}×${r.height}).` }] }
      : text(`No picture: ${r.reason.trim().replace(/\.+$/, "")}. ${what} is at ${r.url}`);

  // ------------------------------------------------------------ read

  server.registerTool("get_state", {
    title: "Switcher state",
    description: "What's on air (path, label, org), whether OBS is connected, streaming or recording (\"live\"), any warnings, and the agent on-air setting (never / not-live / always) that decides whether you may use go_on_air.",
    annotations: READ,
  }, run(async () => text(stateView(deps.state()))));

  server.registerTool("list_orgs", {
    title: "List orgs",
    description: "The orgs in the library (id, name, accent, ground). Every library path starts with an org id.",
    annotations: READ,
  }, run(async () => text(await lib.listOrgs(root))));

  server.registerTool("scan_library", {
    title: "Scan an org",
    description: "One org's templates, assets, projects, streams and scenes, with org-prefixed paths. A stream's scene with overrides: true is the stream's own copy of a project scene; sharedScenes are project scenes the stream uses as they are.",
    inputSchema: { org: orgArg },
    annotations: READ,
  }, run(async ({ org }: { org: string }) => {
    await existingOrg(root, org);
    const l = await scanner.scan(plainName(org));
    const projects = l.projects.map((p) => ({
      ...p,
      streams: p.streams.map((s) => {
        const r = resolveStream(p, s);
        return { ...s, scenes: r.own, sharedScenes: r.shared.map((x) => x.name) };
      }),
    }));
    return text({ ...l, projects });
  }));

  server.registerTool("list_files", {
    title: "List files",
    description: "What's in an org's folder or a folder inside it: entries { name, path, type: \"file\" | \"dir\", size }. Pass an org id (\"my-channel\") or a folder path (\"my-channel/templates/_shared\"). Dot-files are left out.",
    inputSchema: { path: z.string().describe("An org id, or a folder path starting with one.") },
    annotations: READ,
  }, run(async ({ path }: { path: string }) => text(await listFiles(root, path))));

  server.registerTool("read_file", {
    title: "Read a file",
    description: "A text file (html, css, js, json, md, svg, txt) and its hash. Pass that hash to write_file or rename_scene: they refuse a file that changed since you read it. Images and other media can't be read here; scenes use them as /library/<path>.",
    inputSchema: { path: pathArg("The file") },
    annotations: READ,
  }, run(async ({ path }: { path: string }) => text(await readText(root, path, port))));

  server.registerTool("get_guide", {
    title: "Scene guide",
    description: "How ViewSwitcher scenes work (slots, theme, assets, templates, streams, overrides, previews). Read it before creating or editing scenes.",
    annotations: READ,
  }, run(async () => text(await readGuide(root, deps.kit))));

  server.registerResource("guide", "viewswitcher://guide", { title: "ViewSwitcher scene guide", description: "How ViewSwitcher scenes work; the same text as get_guide.", mimeType: "text/markdown" }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: await readGuide(root, deps.kit) }],
  }));

  // ------------------------------------------------------------ look

  server.registerTool("preview_scene", {
    title: "Preview a scene",
    description: "A picture of a library scene as OBS renders it (960×540, or 1920×1080 with full), with the ground painted and device slots labelled. Use it after every visual change, look closely, and fix what's wrong. Without OBS it says so and gives the preview URL.",
    inputSchema: { path: pathArg("The scene (.html)"), full: fullArg },
    annotations: READ,
  }, run(async ({ path, full }: { path: string; full?: boolean }) => {
    await needScene(path);
    return picture(await deps.previewer.scene(path, { full }), `Preview of ${path}`);
  }));

  server.registerTool("see_program", {
    title: "See the program output",
    description: "A picture of what OBS is putting out right now: the scene on air INCLUDING the live camera, screen and iPad, so it shows the people on camera. 960×540, or 1920×1080 with full. Use it to check the real result on air.",
    inputSchema: { full: fullArg },
    // Not marked read-only, so clients ask before it runs: it sends live camera frames to the AI provider.
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, run(async ({ full }: { full?: boolean }) => picture(await deps.previewer.program({ full }), "The program output")));

  // ------------------------------------------------------------ write

  server.registerTool("write_file", {
    title: "Write a file",
    description: "Write a text file (html, css, js, json, md, svg, txt; up to 2 MB) inside an org. For a file that exists, pass the hash from read_file; it's refused if the file changed since (read again, redo the change). Leave hash out only to create a new file. Never in dot-folders. The switcher and OBS pick the change up by themselves.",
    inputSchema: { path: pathArg("The file"), text: z.string().describe("The whole new text of the file."), hash: z.string().optional().describe("The hash read_file gave you; required when the file exists.") },
    annotations: WRITE,
  }, run(async ({ path, text: body, hash }: { path: string; text: string; hash?: string }) => {
    const target = String(path).replace(/\/+$/, "");
    await writes(target);
    // Checked again in turn (OBS may have gone live while it waited), and once more in the same tick
    // as the rename, against the state at that instant. The files the scene on air loads are read in
    // turn even while idle, so the last check has them if OBS goes live in between. If what that list
    // depends on changed meanwhile (the setting, what's on air, or the on-air pages' text), the list
    // may be stale, so a live write is refused rather than guessed.
    let loads: OnAirLoads | undefined;
    let setting: string | undefined;
    const r = await writeText(root, path, body, hash, {
      beforeWrite: async () => {
        await contained(target);
        setting = deps.state().agent.onAir;
        loads = await onAirLoads(true);
        guardNow({ kind: "write", paths: [target] }, loads);
      },
      atCommit: () => {
        deps.onCommit?.();
        const s = deps.state();
        if (isLive(s) && s.agent.onAir !== "always") {
          if (s.agent.onAir !== setting) {
            throw new Refusal("The agent on-air setting changed while this was being written, and you're live. Check get_state, then read_file and redo the change if it's still allowed.");
          }
          // The list of what the scene loads was made for what was on air then, from the files as they were.
          if ((loads?.pages ?? "") !== pagesOnAir().join("\n") || (loads && !unchanged(loads))) {
            throw new Refusal("What's on air changed while this was being written, and you're live. read_file it again and redo the change if it isn't part of the scene on air.");
          }
        }
        guardNow({ kind: "write", paths: [target] }, loads);
      },
    });
    if (!r.ok) return refusal(r.hash ? `${r.reason} (current hash: ${r.hash})` : r.reason);
    return text({ path: r.path, hash: r.hash, ...(r.created ? { created: true } : {}), ...(r.changed ? {} : { unchanged: true }) });
  }));

  const MAX_ASSET = 15 * 1024 * 1024;
  server.registerTool("add_asset", {
    title: "Add an asset",
    description: "Save an image, video or audio file into an org's assets/ folder, from base64. Up to 15 MB. Returns its path (a free name is picked if the name is taken); scenes use it as /library/<path>.",
    inputSchema: { org: orgArg, name: z.string().describe("File name with extension, like \"logo.png\"."), base64: z.string().describe("The file's bytes, base64-encoded.") },
    annotations: WRITE,
  }, run(async ({ org, name, base64 }: { org: string; name: string; base64: string }) => {
    const dir = await existingOrg(root, org);
    if (base64.length > Math.ceil(MAX_ASSET / 3) * 4 + 4) throw new Refusal("That file is over 15 MB");
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length === 0) throw new Refusal("That isn't base64 file data");
    if (bytes.length > MAX_ASSET) throw new Refusal("That file is over 15 MB");
    // The assets folder must really be in the library; the guard checks the name the file really gets
    // (a taken name gets a free one, which the scene on air may be asking for).
    await contained(`${org}/assets/${plainName(name)}`);
    const check = await guardFor();
    const saved = await lib.saveAsset(dir, new File([bytes], String(name)), check);
    return text({ path: `${org}/${saved.path}` });
  }));

  // ------------------------------------------------------------ template sets

  const setView = (b: BuiltinPackFiles) => ({ id: b.id, name: b.name, description: b.description, views: b.views });
  /** A built-in set by its id ("grace") or its name ("Grace Community"), in any case. */
  const findSet = async (set: string) => {
    const all = (await deps.templateSets?.()) ?? [];
    const want = String(set ?? "").trim().toLowerCase();
    const b = all.find((x) => x.id === want) ?? all.find((x) => x.name.toLowerCase() === want) ?? all.find((x) => slugify(x.name) === slugify(want));
    if (!b) throw new Refusal(`There's no built-in template set "${set}". list_template_sets shows them: ${all.map((x) => `${x.id} (${x.name})`).join(", ") || "none"}.`);
    return b;
  };

  server.registerTool("list_template_sets", {
    title: "List built-in template sets",
    description: "The template sets that come with ViewSwitcher (the switcher's Add templates): each a whole look with its views (starting soon, main, break, ending…), filled in with the org's name and colors when added. With org, also says which the org has already (an org's installed sets are in scan_library's sets).",
    inputSchema: { org: orgArg.optional() },
    annotations: READ,
  }, run(async ({ org }: { org?: string }) => {
    const sets = ((await deps.templateSets?.()) ?? []).map(setView);
    if (!org) return text(sets);
    await existingOrg(root, org);
    const have = (await scanner.scan(plainName(org))).sets.map((s) => s.id);
    // An added set's folder is its id, or "<id>-2"… when the org had one already.
    return text(sets.map((s) => ({ ...s, added: have.filter((h) => h === s.id || new RegExp(`^${s.id}-\\d+$`).test(h)) })));
  }));

  server.registerTool("add_template_set", {
    title: "Add a built-in template set",
    description: "Add one of the built-in template sets (list_template_sets: by id, like \"grace\", or name, like \"Grace Community\") to an org, exactly as the switcher's Add templates does: it lands as its own set in templates/<set>/, in the org's name and colors. Adding one the org has makes a second copy (\"<id>-2\"). Returns { set, templates }: pass a template to scene_from_template to make a scene from it.",
    inputSchema: { org: orgArg, set: z.string().describe("The built-in set's id or name.") },
    annotations: WRITE,
  }, run(async ({ org, set }: { org: string; set: string }) => {
    await existingOrg(root, org);
    const b = await findSet(set);
    // It lands in a new folder in templates/ (claimed with a plain mkdir, so never over a file on air),
    // and templates/ itself must really be in the library.
    // The agent on-air guard too, as for every write (refused while live if it can't tell what's on air).
    await writes(`${plainName(org)}/templates/${b.id}/pack.json`);
    const staged = await stagePack(root, plainName(org), { files: asDropped(b) }, deps.starterScript ?? null);
    let installed: { set: string };
    try {
      installed = await installPack(root, plainName(org), staged.token);
    } catch (e) {
      await cancelPack(root, plainName(org), staged.token).catch(() => {});
      throw e;
    }
    return text({ set: installed.set, name: b.name, templates: staged.views.map((v) => templateId({ set: installed.set, name: v.name })), ...(staged.warnings.length ? { warnings: staged.warnings } : {}) });
  }));

  server.registerTool("create_project", {
    title: "Create a project",
    description: "A new project in an org (a show or series), optionally starting with copies of some templates as its shared scenes. Returns { projectId }.",
    inputSchema: { org: orgArg, name: z.string().describe("The project's name."), templates: z.array(z.string()).optional().describe("Template names to copy into the project: a file name without .html (\"brb\"), or \"<set>/<view>\" for a template set's (scan_library's sets).") },
    annotations: WRITE,
  }, run(async ({ org, name, templates }: { org: string; name: string; templates?: string[] }) => {
    const dir = await existingOrg(root, org);
    // The templates it copies must really be in the library (a linked template would copy a file from elsewhere).
    for (const t of templates ?? []) {
      const tpl = templateAt(org, dir, t);
      if (await exists(tpl.file)) await contained(tpl.path);
    }
    const check = await writes(`${org}/projects/${slugify(name)}/project.json`);
    return text(await lib.createProject(dir, name, templates ?? [], check));
  }));

  server.registerTool("create_stream", {
    title: "Create a stream",
    description: "A new stream (one episode or broadcast) in a project. date is YYYY-MM-DD, today if left out. Returns { projectId, streamId }.",
    inputSchema: { org: orgArg, projectId: z.string(), name: z.string().describe("The stream's name."), date: z.string().optional().describe("YYYY-MM-DD") },
    annotations: WRITE,
  }, run(async ({ org, projectId, name, date }: { org: string; projectId: string; name: string; date?: string }) => {
    const dir = await needProject(org, projectId);
    await writes(`${org}/projects/${projectId}/streams/${slugify(name)}/stream.json`);
    return text(await lib.createStream(dir, projectId, name, date ?? today()));
  }));

  server.registerTool("scene_from_template", {
    title: "New scene from a template",
    description: "Copy one of the org's templates (its own, or a template set's, such as one add_template_set added) into a project's shared scenes, or into one stream with streamId. Returns { name, path } of the new scene (a free name is picked if needed); then edit it with read_file and write_file, and preview_scene it.",
    inputSchema: { org: orgArg, template: z.string().describe("Template name: a file name without .html (\"brb\"), or \"<set>/<view>\" for a template set's (scan_library's sets)."), projectId: z.string(), streamId: z.string().optional() },
    annotations: WRITE,
  }, run(async ({ org, template, projectId, streamId }: { org: string; template: string; projectId: string; streamId?: string }) => {
    const dir = streamId ? await needStream(org, projectId, streamId) : await needProject(org, projectId);
    const tpl = templateAt(org, dir, template);
    if (!(await exists(tpl.file))) throw new Refusal(`${org} has no template "${template}". scan_library shows its templates and sets.`);
    await contained(tpl.path);
    // The copy may get a free name ("brb-2"): the folder is checked here, the name the copy gets as it's made.
    await contained(`${org}/projects/${projectId}/${streamId ? `streams/${streamId}` : "scenes"}`);
    const check = await guardFor();
    return text(await sceneFromTemplate(root, { org, template, projectId, streamId }, check));
  }));

  server.registerTool("customize_scene", {
    title: "Make a stream copy",
    description: "Give one stream its own copy of a project scene (an override), so it can change without changing the project's or other streams'. Returns { name, path } of the stream copy; edit that path. If the copy already exists, returns it.",
    inputSchema: { org: orgArg, projectId: z.string(), streamId: z.string(), name: z.string().describe("The project scene's name (file name without .html).") },
    annotations: WRITE,
  }, run(async ({ org, projectId, streamId, name }: { org: string; projectId: string; streamId: string; name: string }) => {
    const dir = await needStream(org, projectId, streamId);
    if (!(await exists(inside(dir, `projects/${projectId}/scenes/${plainName(name)}.html`)))) throw new Refusal(`Project ${projectId} has no scene "${name}". scan_library shows its scenes.`);
    await contained(`${org}/projects/${projectId}/scenes/${name}.html`);
    await writes(`${org}/projects/${projectId}/streams/${streamId}/${name}.html`);
    return text(await customizeScene(root, { org, projectId, streamId, name }));
  }));

  server.registerTool("revert_scene", {
    title: "Drop a stream copy",
    description: "Delete a stream's own copy of a project scene, so the stream shows the project's version again. The stream copy's changes are lost.",
    inputSchema: { org: orgArg, projectId: z.string(), streamId: z.string(), name: z.string().describe("The scene's name (file name without .html).") },
    annotations: DESTRUCTIVE,
  }, run(async ({ org, projectId, streamId, name }: { org: string; projectId: string; streamId: string; name: string }) => {
    const dir = await needStream(org, projectId, streamId);
    if (!(await exists(inside(dir, `projects/${projectId}/streams/${streamId}/${plainName(name)}.html`)))) throw new Refusal(`Stream ${streamId} has no copy of "${name}"`);
    await writes(`${org}/projects/${projectId}/streams/${streamId}/${name}.html`);
    await lib.revert(dir, projectId, streamId, name);
    return text({ ok: true });
  }));

  server.registerTool("duplicate_scene", {
    title: "Duplicate a scene",
    description: "Copy a scene beside itself as \"<name>-copy\" (its title gets \" copy\"). Returns { name, path } of the copy.",
    inputSchema: { path: pathArg("The scene (.html)") },
    annotations: WRITE,
  }, run(async ({ path }: { path: string }) => {
    await needScene(path);
    // The scene it copies, and the folder the copy goes in, must really be in the library: a link to a
    // file outside would be copied in. The copy's own name is picked free of anything already there.
    await contained(path);
    const check = await guardFor();
    return text(await duplicateScene(root, path, check));
  }));

  server.registerTool("rename_scene", {
    title: "Rename a scene",
    description: "Give a scene a new name: its <title>, and for a stream's own scene its file name too. Pass the hash from read_file (refused if the scene changed since). Returns the scene's { path, hash } afterwards; the path changes when the file was renamed.",
    inputSchema: { path: pathArg("The scene (.html)"), hash: z.string().describe("The hash read_file gave you."), name: z.string().describe("The new name, in words (\"Q&A\").") },
    annotations: WRITE,
  }, run(async ({ path, hash, name }: { path: string; hash: string; name: string }) => {
    await needScene(path);
    await writes(path, `${path.slice(0, path.lastIndexOf("/"))}/${slugify(name)}.html`);
    const r = await renameScene(root, path, hash, name);
    if (!r.ok) return refusal(`${path} changed since you read it. read_file it again and use the new hash. (current hash: ${r.hash})`);
    await deps.renamed(path, name, r);
    return text({ path: r.path, hash: r.hash });
  }));

  server.registerTool("customize_transition", {
    title: "Give a project its own transition",
    description: "Copy the org's transition (templates/_shared/transition.html) into the project as projects/<id>/transition.html, which then plays for that project's scenes. Returns { path }; edit it with read_file and write_file.",
    inputSchema: { org: orgArg, projectId: z.string() },
    annotations: WRITE,
  }, run(async ({ org, projectId }: { org: string; projectId: string }) => {
    const dir = await needProject(org, projectId);
    const path = `${org}/projects/${projectId}/transition.html`;
    await contained(`${org}/templates/_shared/transition.html`);
    await writes(path);
    await lib.customizeTransition(dir, projectId);
    return text({ path });
  }));

  server.registerTool("revert_transition", {
    title: "Back to the org's transition",
    description: "Delete a project's own transition so its scenes use the org's again. The project transition's changes are lost.",
    inputSchema: { org: orgArg, projectId: z.string() },
    annotations: DESTRUCTIVE,
  }, run(async ({ org, projectId }: { org: string; projectId: string }) => {
    const dir = await needProject(org, projectId);
    await writes(`${org}/projects/${projectId}/transition.html`);
    await lib.revertTransition(dir, projectId);
    return text({ ok: true });
  }));

  // ------------------------------------------------------------ live

  server.registerTool("go_on_air", {
    title: "Put a scene on air",
    description: "Switch OBS to a scene (a template, project scene or stream scene, by its org-prefixed path). Only when the user asks. For a project scene that a stream uses as it is (scan_library's sharedScenes), pass that stream's streamId, as the stream page does. Whether it's allowed depends on the agent on-air setting (get_state): never, not-live (refused while OBS streams or records), or always. Returns the new state.",
    inputSchema: {
      path: pathArg("The scene (.html)"),
      streamId: z.string().optional().describe("For a project scene: the stream it goes on air for (one that shares the scene). Leave it out otherwise."),
    },
    annotations: DESTRUCTIVE,
  }, run(async ({ path, streamId }: { path: string; streamId?: string }) => {
    guardNow({ kind: "go_on_air" });
    await needScene(path);
    const l = await scanner.scan(plainName(orgOf(path)));
    let found: OnAirRequest | null = null;
    // The org's own templates and those of its installed template sets.
    const t = [...l.templates, ...l.sets.flatMap((set) => set.templates)].find((s) => s.path === path);
    if (t) found = { path, label: t.label };
    for (const p of l.projects) {
      const s = p.scenes.find((x) => x.path === path);
      if (s && streamId) {
        // As the stream page puts a shared scene on air: the project's file, labelled and recorded for the stream.
        const st = p.streams.find((x) => x.id === streamId);
        if (!st) throw new Refusal(`Project ${p.id} has no stream "${streamId}". scan_library shows its streams.`);
        const own = resolveStream(p, st).own.find((x) => x.name === s.name);
        if (own) throw new Refusal(`Stream ${st.id} has its own copy of that scene. Put ${own.path} on air instead.`);
        found = { path, label: `${s.label} · ${st.name}`, projectId: p.id, streamId: st.id };
      } else if (s) found = { path, label: s.label, projectId: p.id };
      for (const st of p.streams) {
        const x = st.scenes.find((y) => y.path === path);
        if (x) found = { path, label: `${x.label} · ${st.name}`, projectId: p.id, streamId: st.id };
      }
    }
    if (!found) throw new Refusal("Only an org's templates, project scenes and stream scenes go on air. scan_library lists them.");
    // Checked again as it commits: OBS may have gone live, or the setting changed, in the meantime.
    return text(stateView(await deps.goOnAir(found, () => guardNow({ kind: "go_on_air" }))));
  }));

  return server;
}
