// The MCP server: the tools an AI agent (Claude Code, Claude Desktop, Cursor, Codex) uses to read the
// library, change scenes under the switcher's own rules, look at its work, and go on air when that's
// safe. It runs inside the switcher's server and calls the same library functions as /api; it is given
// what it needs (deps) rather than reaching into index.ts.
import { existsSync, realpathSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { EditError, orgOf, resolveStream, slugify } from "@viewswitcher/shared";
import type { LiveState } from "@viewswitcher/shared";
import { z } from "zod";
import { agentGuard, type GuardAction } from "../agent-guard";
import * as lib from "../library";
import { customizeScene, duplicateScene, existingOrg, type OnAirRequest, sceneFromTemplate } from "../library-actions";
import { listFiles, readText, writeText } from "../library-files";
import { inside, PathError, plainName } from "../paths";
import type { Previewer, PreviewResult } from "../preview-types";
import { renameScene, scenePath, type RenameResult } from "../scene-edit";

export type McpDeps = {
  /** The library folder. Never shown to the agent: every path it sees starts with an org id. */
  root: string;
  /** The library kit (config.libraryKit), for the guide when the library has no copy of the skill. */
  kit: string;
  port: number;
  state: () => LiveState;
  /** Put a scene on air exactly as the switcher does (state, persist, publish); resolves to the new state. */
  goOnAir: (b: OnAirRequest) => Promise<LiveState>;
  /** After a scene was renamed: keeps the on-air record pointing at it, as the switcher's rename does. */
  renamed: (from: string, name: string, r: Extract<RenameResult, { ok: true }>) => Promise<void>;
  previewer: Previewer;
};

export const INSTRUCTIONS = [
  "ViewSwitcher is a live-stream scene switcher for OBS. Scenes are HTML pages (1920×1080) in a library with one folder per org (brand or channel): templates, assets, projects and their streams. OBS shows the scene on air, with the camera, screen and iPad placed in its slots.",
  "Call get_guide before creating or editing scenes: it has the scene rules (slots, theme, assets, overrides).",
  "Every path starts with the org id, like \"my-channel/templates/brb.html\". list_orgs and scan_library show what's there.",
  "To change a file: read_file it, then write_file with the hash read_file gave you. A stale or missing hash is refused; read again and redo the change.",
  "preview_scene after every visual change, look at the picture, and fix what you see before you say it's done.",
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
  const server = new McpServer({ name: "viewswitcher", version: "1.0.0" }, { instructions: INSTRUCTIONS, capabilities: { tools: {}, resources: {} } });

  // No absolute path ever reaches the agent, not even inside an error from the file system.
  const realRoot = (() => {
    try {
      return realpathSync(root);
    } catch {
      return root;
    }
  })();
  const scrub = (s: string) => [realRoot, root].reduce((t, r) => t.split(`${r}/`).join("").split(r).join("the library"), s);

  const text = (data: unknown): CallToolResult => ({ content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });
  const refusal = (message: string): CallToolResult => ({ content: [{ type: "text", text: scrub(message) }], isError: true });
  const run = <A>(fn: (args: A) => Promise<CallToolResult>) => async (args: A): Promise<CallToolResult> => {
    try {
      return await fn(args);
    } catch (e) {
      if (e instanceof Refusal || e instanceof PathError || e instanceof EditError) return refusal(e.message);
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return refusal("That file or folder doesn't exist. scan_library or list_files shows what's there.");
      return refusal(`Couldn't do that: ${(e as Error).message}`);
    }
  };

  /** Where a library path really is (through links), as a library path; the path itself when that can't be told. */
  const realRel = (path: string) => {
    try {
      let probe = inside(root, path);
      let rest = "";
      while (!existsSync(probe)) {
        rest = `/${basename(probe)}${rest}`;
        probe = dirname(probe);
      }
      const back = relative(realRoot, realpathSync(probe)) + rest;
      return back.startsWith("..") || isAbsolute(back) ? path : back;
    } catch {
      return path;
    }
  };
  const guard = (action: GuardAction) => {
    const s = deps.state();
    const onAir = s.onAir && { path: realRel(s.onAir.path), transition: s.onAir.transition && realRel(s.onAir.transition) };
    // A link to the scene on air is the scene on air.
    const checked: GuardAction = action.kind === "write" ? { kind: "write", paths: action.paths.flatMap((p) => [p, realRel(p)]) } : action;
    const g = agentGuard({ setting: s.agent.onAir, live: s.obs.streaming || s.obs.recording, onAir, action: checked });
    if (!g.ok) throw new Refusal(g.reason);
  };
  const writes = (...paths: string[]) => guard({ kind: "write", paths });

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
    const l = await lib.scanLibrary(root, plainName(org));
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
    annotations: READ,
  }, run(async ({ full }: { full?: boolean }) => picture(await deps.previewer.program({ full }), "The program output")));

  // ------------------------------------------------------------ write

  server.registerTool("write_file", {
    title: "Write a file",
    description: "Write a text file (html, css, js, json, md, svg, txt; up to 2 MB) inside an org. For a file that exists, pass the hash from read_file; it's refused if the file changed since (read again, redo the change). Leave hash out only to create a new file. Never in dot-folders. The switcher and OBS pick the change up by themselves.",
    inputSchema: { path: pathArg("The file"), text: z.string().describe("The whole new text of the file."), hash: z.string().optional().describe("The hash read_file gave you; required when the file exists.") },
    annotations: WRITE,
  }, run(async ({ path, text: body, hash }: { path: string; text: string; hash?: string }) => {
    writes(String(path).replace(/\/+$/, ""));
    const r = await writeText(root, path, body, hash);
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
    writes(`${org}/assets/${name}`);
    const saved = await lib.saveAsset(dir, new File([bytes], String(name)));
    return text({ path: `${org}/${saved.path}` });
  }));

  server.registerTool("create_project", {
    title: "Create a project",
    description: "A new project in an org (a show or series), optionally starting with copies of some templates as its shared scenes. Returns { projectId }.",
    inputSchema: { org: orgArg, name: z.string().describe("The project's name."), templates: z.array(z.string()).optional().describe("Template names (file names without .html) to copy into the project.") },
    annotations: WRITE,
  }, run(async ({ org, name, templates }: { org: string; name: string; templates?: string[] }) => {
    const dir = await existingOrg(root, org);
    writes(`${org}/projects/${slugify(name)}/project.json`);
    return text(await lib.createProject(dir, name, templates ?? []));
  }));

  server.registerTool("create_stream", {
    title: "Create a stream",
    description: "A new stream (one episode or broadcast) in a project. date is YYYY-MM-DD, today if left out. Returns { projectId, streamId }.",
    inputSchema: { org: orgArg, projectId: z.string(), name: z.string().describe("The stream's name."), date: z.string().optional().describe("YYYY-MM-DD") },
    annotations: WRITE,
  }, run(async ({ org, projectId, name, date }: { org: string; projectId: string; name: string; date?: string }) => {
    const dir = await needProject(org, projectId);
    writes(`${org}/projects/${projectId}/streams/${slugify(name)}/stream.json`);
    return text(await lib.createStream(dir, projectId, name, date ?? today()));
  }));

  server.registerTool("scene_from_template", {
    title: "New scene from a template",
    description: "Copy one of the org's templates into a project's shared scenes, or into one stream with streamId. Returns { name, path } of the new scene (a free name is picked if needed).",
    inputSchema: { org: orgArg, template: z.string().describe("Template name (file name without .html)."), projectId: z.string(), streamId: z.string().optional() },
    annotations: WRITE,
  }, run(async ({ org, template, projectId, streamId }: { org: string; template: string; projectId: string; streamId?: string }) => {
    const dir = streamId ? await needStream(org, projectId, streamId) : await needProject(org, projectId);
    if (!(await exists(inside(dir, `templates/${plainName(template)}.html`)))) throw new Refusal(`${org} has no template "${template}". scan_library shows its templates.`);
    writes(`${org}/projects/${projectId}/${streamId ? `streams/${streamId}` : "scenes"}/${template}.html`);
    return text(await sceneFromTemplate(root, { org, template, projectId, streamId }));
  }));

  server.registerTool("customize_scene", {
    title: "Make a stream copy",
    description: "Give one stream its own copy of a project scene (an override), so it can change without changing the project's or other streams'. Returns { name, path } of the stream copy; edit that path. If the copy already exists, returns it.",
    inputSchema: { org: orgArg, projectId: z.string(), streamId: z.string(), name: z.string().describe("The project scene's name (file name without .html).") },
    annotations: WRITE,
  }, run(async ({ org, projectId, streamId, name }: { org: string; projectId: string; streamId: string; name: string }) => {
    const dir = await needStream(org, projectId, streamId);
    if (!(await exists(inside(dir, `projects/${projectId}/scenes/${plainName(name)}.html`)))) throw new Refusal(`Project ${projectId} has no scene "${name}". scan_library shows its scenes.`);
    writes(`${org}/projects/${projectId}/streams/${streamId}/${name}.html`);
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
    writes(`${org}/projects/${projectId}/streams/${streamId}/${name}.html`);
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
    writes(`${path.slice(0, -5)}-copy.html`);
    return text(await duplicateScene(root, path));
  }));

  server.registerTool("rename_scene", {
    title: "Rename a scene",
    description: "Give a scene a new name: its <title>, and for a stream's own scene its file name too. Pass the hash from read_file (refused if the scene changed since). Returns the scene's { path, hash } afterwards; the path changes when the file was renamed.",
    inputSchema: { path: pathArg("The scene (.html)"), hash: z.string().describe("The hash read_file gave you."), name: z.string().describe("The new name, in words (\"Q&A\").") },
    annotations: WRITE,
  }, run(async ({ path, hash, name }: { path: string; hash: string; name: string }) => {
    await needScene(path);
    writes(path, `${path.slice(0, path.lastIndexOf("/"))}/${slugify(name)}.html`);
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
    writes(path);
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
    writes(`${org}/projects/${projectId}/transition.html`);
    await lib.revertTransition(dir, projectId);
    return text({ ok: true });
  }));

  // ------------------------------------------------------------ live

  server.registerTool("go_on_air", {
    title: "Put a scene on air",
    description: "Switch OBS to a scene (a template, project scene or stream scene, by its org-prefixed path). Only when the user asks. Whether it's allowed depends on the agent on-air setting (get_state): never, not-live (refused while OBS streams or records), or always. Returns the new state.",
    inputSchema: { path: pathArg("The scene (.html)") },
    annotations: DESTRUCTIVE,
  }, run(async ({ path }: { path: string }) => {
    guard({ kind: "go_on_air" });
    await needScene(path);
    const l = await lib.scanLibrary(root, plainName(orgOf(path)));
    let found: OnAirRequest | null = null;
    const t = l.templates.find((s) => s.path === path);
    if (t) found = { path, label: t.label };
    for (const p of l.projects) {
      const s = p.scenes.find((x) => x.path === path);
      if (s) found = { path, label: s.label, projectId: p.id };
      for (const st of p.streams) {
        const x = st.scenes.find((y) => y.path === path);
        if (x) found = { path, label: `${x.label} · ${st.name}`, projectId: p.id, streamId: st.id };
      }
    }
    if (!found) throw new Refusal("Only an org's templates, project scenes and stream scenes go on air. scan_library lists them.");
    return text(stateView(await deps.goOnAir(found)));
  }));

  return server;
}
