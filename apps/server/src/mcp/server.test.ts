// The MCP tools through a real SDK Client on the in-memory transport, against a temp library made
// the way a new one is (ensureLibrary: the kit and a first org from the starter).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { LiveState } from "@viewswitcher/shared";
import { config } from "../config";
import { onAirFor, renamedOnAir } from "../library-actions";
import { writeText } from "../library-files";
import { ensureLibrary } from "../library-kit";
import type { PreviewResult } from "../preview-types";
import { readForEdit, sceneHash } from "../scene-edit";
import { createMcpServer, INSTRUCTIONS } from "./server";

const root = mkdtempSync(join(tmpdir(), "vs-mcp-"));
const realRoot = realpathSync(root);
const outside = mkdtempSync(join(tmpdir(), "vs-mcp-outside-"));
const ORG = "my-channel";
const PORT = 7433;

const fresh = (): LiveState => ({
  onAir: null,
  obs: { connected: false, recording: false, streaming: false },
  obsSetup: null,
  usb: { enabled: false, attached: false, connected: false },
  warnings: [],
  agent: { onAir: "not-live", lastSeen: null, client: null },
});
let state = fresh();
/** Runs inside goOnAir after the scene is looked up and before it commits (a test makes OBS go live there). */
let beforeCommit: (() => void) | null = null;
let previews: { scene: PreviewResult; program: PreviewResult };
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

let client: Client;
/** Every result text, to check none of them has the library's absolute path. */
const seen: string[] = [];

beforeAll(async () => {
  await ensureLibrary(root, { kit: config.libraryKit, starter: config.starter, gitInit: async () => false });
  // The starter has no transition; most orgs make one.
  await writeFile(join(root, ORG, "templates/_shared/transition.html"), "<title>Wipe</title>");
  const server = createMcpServer({
    root,
    kit: config.libraryKit,
    port: PORT,
    state: () => state,
    // As main.ts does it: look the scene up, run the agent's check, then commit.
    goOnAir: async (b, check) => {
      const next = await onAirFor(root, b);
      beforeCommit?.();
      check?.();
      state.onAir = next;
      return state;
    },
    renamed: async (from, name, r) => {
      if (state.onAir?.path === from) state.onAir = renamedOnAir(state.onAir, from, name, r);
    },
    previewer: { scene: async () => previews.scene, program: async () => previews.program },
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "test-agent", version: "1" });
  await client.connect(b);
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});
beforeEach(() => {
  state = fresh();
  beforeCommit = null;
  previews = { scene: { ok: true, png, width: 960, height: 540 }, program: { ok: false, reason: "Previews need OBS", url: `http://127.0.0.1:${PORT}/program` } };
});

type Result = { isError: boolean; text: string; content: { type: string; text?: string; data?: string; mimeType?: string }[] };
async function call(name: string, args: Record<string, unknown> = {}): Promise<Result> {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Result["content"] };
  const text = r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  seen.push(JSON.stringify(r));
  return { isError: !!r.isError, text, content: r.content };
}
const data = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await call(name, args);
  if (r.isError) throw new Error(`${name} refused: ${r.text}`);
  return JSON.parse(r.text);
};
const live = () => {
  state.obs = { connected: true, streaming: true, recording: false };
};

describe("initialize", () => {
  test("instructions say what ViewSwitcher is, get_guide first, preview after changes, org-prefixed paths", () => {
    const i = client.getInstructions() ?? "";
    expect(i).toBe(INSTRUCTIONS);
    expect(i).toContain("live-stream scene switcher for OBS");
    expect(i).toContain("Call get_guide before creating or editing scenes");
    expect(i).toContain("preview_scene after every visual change");
    expect(i).toContain("fix what you see");
    expect(i).toContain("Every path starts with the org id");
  });
  test("see_program isn't read-only: clients ask before it sends camera frames", async () => {
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "see_program")!.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: true });
  });
  test("every tool in the contract, with read-only and destructive hints", async () => {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual([
      "add_asset", "create_project", "create_stream", "customize_scene", "customize_transition", "duplicate_scene", "get_guide", "get_state",
      "go_on_air", "list_files", "list_orgs", "preview_scene", "read_file", "rename_scene", "revert_scene", "revert_transition", "scan_library",
      "scene_from_template", "see_program", "write_file",
    ]);
    for (const n of ["get_state", "list_orgs", "scan_library", "list_files", "read_file", "get_guide", "preview_scene"]) {
      expect({ n, ro: byName[n]!.annotations?.readOnlyHint }).toEqual({ n, ro: true });
    }
    for (const n of ["go_on_air", "revert_scene", "revert_transition"]) expect({ n, d: byName[n]!.annotations?.destructiveHint }).toEqual({ n, d: true });
    for (const n of ["write_file", "add_asset", "create_project", "create_stream", "scene_from_template", "customize_scene", "duplicate_scene", "rename_scene", "customize_transition"]) {
      expect({ n, ro: byName[n]!.annotations?.readOnlyHint, d: byName[n]!.annotations?.destructiveHint }).toEqual({ n, ro: false, d: false });
    }
    expect(byName.see_program!.description).toContain("INCLUDING the live camera");
    expect(byName.write_file!.description).toContain("hash");
    expect(byName.read_file!.description).toContain("hash");
  });
});

describe("read tools", () => {
  test("get_state: on air, OBS, warnings, the agent setting", async () => {
    state.onAir = await onAirFor(root, { path: `${ORG}/templates/brb.html`, label: "BRB" });
    state.warnings = ["Camera isn't in OBS"];
    const s = await data("get_state");
    expect(s.onAir).toMatchObject({ path: `${ORG}/templates/brb.html`, label: "BRB", org: ORG });
    expect(s).toMatchObject({ live: false, obs: { connected: false, streaming: false, recording: false }, warnings: ["Camera isn't in OBS"], agent: { onAir: "not-live" } });
  });
  test("list_orgs and scan_library return what the API does, paths starting with the org", async () => {
    const orgs = await data("list_orgs");
    expect(orgs.map((o: { id: string }) => o.id)).toEqual([ORG]);
    const l = await data("scan_library", { org: ORG });
    expect(l.org.id).toBe(ORG);
    expect(l.templates.map((t: { path: string }) => t.path)).toContain(`${ORG}/templates/brb.html`);
    for (const t of l.templates) expect(t.path.startsWith(`${ORG}/`)).toBe(true);
    expect((await call("scan_library", { org: "nope" })).text).toContain("There's no org \"nope\"");
    expect((await call("scan_library", { org: "../etc" })).isError).toBe(true);
  });
  test("scan_library marks a stream's overrides and the project scenes it shares", async () => {
    const { projectId } = await data("create_project", { org: ORG, name: "Scan Show", templates: ["brb", "ending"] });
    const { streamId } = await data("create_stream", { org: ORG, projectId, name: "Ep 1", date: "2026-12-04" });
    await data("customize_scene", { org: ORG, projectId, streamId, name: "brb" });
    const l = await data("scan_library", { org: ORG });
    const s = l.projects.find((p: { id: string }) => p.id === projectId).streams[0];
    expect(s.scenes.map((x: { name: string; overrides: boolean }) => [x.name, x.overrides])).toEqual([["brb", true]]);
    expect(s.sharedScenes).toEqual(["ending"]);
  });
  test("list_files: an org or a folder in it, no dot-files", async () => {
    const top = await data("list_files", { path: ORG });
    expect(top.find((e: { name: string }) => e.name === "templates")).toEqual({ name: "templates", path: `${ORG}/templates`, type: "dir", size: 0 });
    expect(top.find((e: { name: string }) => e.name === "org.json")).toMatchObject({ path: `${ORG}/org.json`, type: "file" });
    const shared = await data("list_files", { path: `${ORG}/templates/_shared` });
    expect(shared.length).toBeGreaterThan(0);
    await writeFile(join(root, ORG, ".secret"), "x");
    expect((await data("list_files", { path: ORG })).some((e: { name: string }) => e.name.startsWith("."))).toBe(false);
    for (const path of ["", ".viewswitcher", `${ORG}/../..`, "/etc", `${ORG}/.git`]) expect({ path, err: (await call("list_files", { path })).isError }).toEqual({ path, err: true });
  });
  test("read_file: the text and the same hash the scene editor uses", async () => {
    const path = `${ORG}/templates/brb.html`;
    const r = await data("read_file", { path });
    const text = await readFile(join(root, path), "utf8");
    expect(r).toEqual({ text, hash: sceneHash(text) });
    expect(r.hash).toBe((await readForEdit(root, path)).hash);
  });
  test("read_file refuses binaries, pointing at /library/<path>", async () => {
    await writeFile(join(root, ORG, "assets", "logo.png"), png);
    const r = await call("read_file", { path: `${ORG}/assets/logo.png` });
    expect(r.isError).toBe(true);
    expect(r.text).toContain(`/library/${ORG}/assets/logo.png`);
  });
  test("read_file refuses dot-folders, other orgs' escapes and links out of the library", async () => {
    await writeFile(join(outside, "secret.md"), "secret");
    await symlink(join(outside, "secret.md"), join(root, ORG, "link.md"));
    for (const path of [".viewswitcher/state.json", ".claude/skills/viewswitcher-scenes/SKILL.md", `${ORG}/../CLAUDE.md`, `${ORG}/link.md`, `${ORG}/.git/config`]) {
      const r = await call("read_file", { path });
      expect({ path, err: r.isError, leaked: r.text.includes("secret") && !r.text.includes("Bad path") }).toEqual({ path, err: true, leaked: false });
    }
  });
  test("get_guide and viewswitcher://guide: the library's skill, else the kit's", async () => {
    const mine = join(root, ".claude/skills/viewswitcher-scenes/SKILL.md");
    const kit = await readFile(join(config.libraryKit, "skills/viewswitcher-scenes/SKILL.md"), "utf8");
    expect((await call("get_guide")).text).toBe(await readFile(mine, "utf8"));
    await writeFile(mine, "# My own scene rules\n");
    expect((await call("get_guide")).text).toBe("# My own scene rules\n");
    const res = await client.readResource({ uri: "viewswitcher://guide" });
    expect(res.contents[0]).toMatchObject({ uri: "viewswitcher://guide", mimeType: "text/markdown", text: "# My own scene rules\n" });
    await rm(mine);
    expect((await call("get_guide")).text).toBe(kit);
  });
});

describe("look tools", () => {
  test("preview_scene returns the PNG and one line of text", async () => {
    const r = await call("preview_scene", { path: `${ORG}/templates/brb.html` });
    expect(r.isError).toBe(false);
    expect(r.content[0]).toEqual({ type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" });
    expect(r.text).toBe(`Preview of ${ORG}/templates/brb.html (960×540).`);
  });
  test("without a picture: the reason and the URL, as text, not an error", async () => {
    previews.scene = { ok: false, reason: "Previews need OBS", url: `http://127.0.0.1:${PORT}/library/${ORG}/templates/brb.html?preview` };
    const r = await call("preview_scene", { path: `${ORG}/templates/brb.html` });
    expect(r.isError).toBe(false);
    expect(r.text).toBe(`No picture: Previews need OBS. Preview of ${ORG}/templates/brb.html is at http://127.0.0.1:${PORT}/library/${ORG}/templates/brb.html?preview`);
    expect(r.text).toContain(`http://127.0.0.1:${PORT}/library/${ORG}/templates/brb.html?preview`);
    // A reason that already ends a sentence isn't given a second period.
    previews.scene = { ok: false, reason: "OBS isn't connected. Open the URL in a browser at 1920×1080 if you can.", url: `http://127.0.0.1:${PORT}/library/${ORG}/templates/brb.html?preview` };
    expect((await call("preview_scene", { path: `${ORG}/templates/brb.html` })).text).toBe(
      `No picture: OBS isn't connected. Open the URL in a browser at 1920×1080 if you can. Preview of ${ORG}/templates/brb.html is at http://127.0.0.1:${PORT}/library/${ORG}/templates/brb.html?preview`,
    );
    const p = await call("see_program");
    expect(p.isError).toBe(false);
    expect(p.text).toContain(`http://127.0.0.1:${PORT}/program`);
  });
  test("see_program returns OBS's output", async () => {
    previews.program = { ok: true, png, width: 1920, height: 1080 };
    const r = await call("see_program", { full: true });
    expect(r.content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(r.text).toContain("1920×1080");
  });
  test("preview_scene of something that isn't a scene is refused", async () => {
    expect((await call("preview_scene", { path: `${ORG}/templates/nope.html` })).text).toContain("There's no scene");
    expect((await call("preview_scene", { path: `${ORG}/org.json` })).isError).toBe(true);
  });
});

describe("write_file", () => {
  const path = `${ORG}/templates/_shared/extra.css`;
  test("creates a new file without a hash, then needs the current hash", async () => {
    expect(await data("write_file", { path, text: "a{}" })).toEqual({ path, hash: sceneHash("a{}"), created: true });
    const missing = await call("write_file", { path, text: "b{}" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("read_file it first");
    expect(missing.text).toContain(`current hash: ${sceneHash("a{}")}`);
    const stale = await call("write_file", { path, text: "b{}", hash: sceneHash("old") });
    expect(stale.text).toContain("changed since you read it");
    expect(stale.text).toContain(`current hash: ${sceneHash("a{}")}`);
    expect(await readFile(join(root, path), "utf8")).toBe("a{}");
    expect(await data("write_file", { path, text: "b{}", hash: sceneHash("a{}") })).toEqual({ path, hash: sceneHash("b{}") });
    expect(await readFile(join(root, path), "utf8")).toBe("b{}");
    expect(await data("write_file", { path, text: "b{}", hash: sceneHash("b{}") })).toEqual({ path, hash: sceneHash("b{}"), unchanged: true });
  });
  test("a hash for a file that isn't there is refused", async () => {
    expect((await call("write_file", { path: `${ORG}/templates/ghost.html`, text: "x", hash: "abc" })).text).toContain("doesn't exist any more");
  });
  test("makes missing folders inside an org", async () => {
    await data("write_file", { path: `${ORG}/projects/new-folder/notes.md`, text: "# hi" });
    expect(await readFile(join(root, ORG, "projects/new-folder/notes.md"), "utf8")).toBe("# hi");
  });
  test("text types only, 2 MB at most", async () => {
    expect((await call("write_file", { path: `${ORG}/assets/x.png`, text: "x" })).text).toContain("Only text files");
    expect((await call("write_file", { path: `${ORG}/run.sh`, text: "x" })).text).toContain("Only text files");
    expect((await call("write_file", { path: `${ORG}/big.txt`, text: "x".repeat(2 * 1024 * 1024 + 1) })).text).toContain("over 2 MB");
    for (const ext of ["html", "css", "js", "json", "md", "svg", "txt"]) expect((await call("write_file", { path: `${ORG}/t.${ext}`, text: "x" })).isError).toBe(false);
  });
  test("never outside an existing org, in dot-folders or through links out of the library", async () => {
    await symlink(outside, join(root, ORG, "out"));
    for (const p of ["CLAUDE.md", ".viewswitcher/settings.json", `${ORG}/.git/config`, `${ORG}/templates/.hidden.css`, "nope/x.css", `${ORG}/../x.css`, `/${ORG}/x.css`, `${ORG}/out/x.css`, `${ORG}//x.css`]) {
      expect({ p, err: (await call("write_file", { path: p, text: "x" })).isError }).toEqual({ p, err: true });
    }
    expect(await stat(join(outside, "x.css")).catch(() => null)).toBeNull();
    expect(await stat(join(root, "nope")).catch(() => null)).toBeNull();
  });
});

describe("structural tools", () => {
  test("project, stream, scene from a template, stream copy, revert", async () => {
    const { projectId } = await data("create_project", { org: ORG, name: "Live Demo", templates: ["teaching"] });
    expect(projectId).toBe("live-demo");
    const { streamId } = await data("create_stream", { org: ORG, projectId, name: "First", date: "2026-12-04" });
    expect(streamId).toBe("12-04-first");
    expect(await data("scene_from_template", { org: ORG, template: "brb", projectId })).toEqual({ name: "brb", path: `${ORG}/projects/live-demo/scenes/brb.html` });
    expect(await data("scene_from_template", { org: ORG, template: "brb", projectId, streamId })).toEqual({ name: "brb", path: `${ORG}/projects/live-demo/streams/12-04-first/brb.html` });
    expect(await data("customize_scene", { org: ORG, projectId, streamId, name: "teaching" })).toEqual({ name: "teaching", path: `${ORG}/projects/live-demo/streams/12-04-first/teaching.html` });
    expect(await data("revert_scene", { org: ORG, projectId, streamId, name: "teaching" })).toEqual({ ok: true });
    expect(await stat(join(root, ORG, "projects/live-demo/streams/12-04-first/teaching.html")).catch(() => null)).toBeNull();
    await data("scene_from_template", { org: ORG, template: "ending", projectId, streamId });
    expect((await call("revert_scene", { org: ORG, projectId, streamId, name: "ending" })).text).toContain("Only an override");
    expect((await call("scene_from_template", { org: ORG, template: "nope", projectId })).text).toContain("no template");
    expect((await call("create_stream", { org: ORG, projectId: "nope", name: "x" })).text).toContain("no project");
    expect((await call("customize_scene", { org: ORG, projectId, streamId: "nope", name: "teaching" })).text).toContain("no stream");
  });
  test("create_stream defaults to today", async () => {
    const { projectId } = await data("create_project", { org: ORG, name: "Dated" });
    const { streamId } = await data("create_stream", { org: ORG, projectId, name: "Now" });
    const d = new Date();
    expect(streamId).toBe(`${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-now`);
  });
  test("duplicate and rename (with the hash rule)", async () => {
    const dup = await data("duplicate_scene", { path: `${ORG}/templates/brb.html` });
    expect(dup).toEqual({ name: "brb-copy", path: `${ORG}/templates/brb-copy.html` });
    const { hash } = await data("read_file", { path: dup.path });
    expect((await call("rename_scene", { path: dup.path, hash: "stale", name: "Back Soon" })).text).toContain(`current hash: ${hash}`);
    const r = await data("rename_scene", { path: dup.path, hash, name: "Back Soon" });
    expect(r.path).toBe(dup.path); // templates keep their file name
    expect(r.hash).toBe((await data("read_file", { path: dup.path })).hash);
    expect(await readFile(join(root, dup.path), "utf8")).toContain("<title>Back Soon</title>");
  });
  test("rename of a stream's own scene renames the file, and the on-air record follows", async () => {
    const { projectId } = await data("create_project", { org: ORG, name: "Rename Show" });
    const { streamId } = await data("create_stream", { org: ORG, projectId, name: "Ep", date: "2026-12-05" });
    const { path } = await data("scene_from_template", { org: ORG, template: "brb", projectId, streamId });
    await data("go_on_air", { path });
    const { hash } = await data("read_file", { path });
    const r = await data("rename_scene", { path, hash, name: "Coffee Break" });
    expect(r.path).toBe(`${ORG}/projects/${projectId}/streams/${streamId}/coffee-break.html`);
    expect(state.onAir).toMatchObject({ path: r.path, label: "Coffee Break · Ep", renamedFrom: path });
  });
  test("customize and revert a project's transition", async () => {
    const { projectId } = await data("create_project", { org: ORG, name: "Trans" });
    expect(await data("customize_transition", { org: ORG, projectId })).toEqual({ path: `${ORG}/projects/trans/transition.html` });
    expect(await stat(join(root, ORG, "projects/trans/transition.html")).then((s) => s.isFile())).toBe(true);
    expect(await data("revert_transition", { org: ORG, projectId })).toEqual({ ok: true });
    expect(await stat(join(root, ORG, "projects/trans/transition.html")).catch(() => null)).toBeNull();
  });
  test("add_asset saves base64 into assets/, 15 MB at most", async () => {
    const r = await data("add_asset", { org: ORG, name: "photo.png", base64: Buffer.from(png).toString("base64") });
    expect(r).toEqual({ path: `${ORG}/assets/photo.png` });
    expect(new Uint8Array(await readFile(join(root, r.path)))).toEqual(png);
    expect((await data("add_asset", { org: ORG, name: "photo.png", base64: Buffer.from(png).toString("base64") })).path).toBe(`${ORG}/assets/photo-2.png`);
    expect((await call("add_asset", { org: ORG, name: "big.png", base64: "A".repeat(21 * 1024 * 1024) })).text).toContain("over 15 MB");
    expect((await call("add_asset", { org: ORG, name: "x.png", base64: "" })).isError).toBe(true);
    expect((await call("add_asset", { org: "nope", name: "x.png", base64: "AAAA" })).text).toContain("no org");
  });
  test("structural tools never make a new org", async () => {
    expect((await call("create_project", { org: "brand-new", name: "X" })).text).toContain("no org");
    expect(await stat(join(root, "brand-new")).catch(() => null)).toBeNull();
  });
});

describe("go_on_air and the agent guard", () => {
  const brb = `${ORG}/templates/brb.html`;
  test("not-live: goes on air when OBS isn't live, with the scene's label", async () => {
    const s = await data("go_on_air", { path: brb });
    expect(s.onAir).toMatchObject({ path: brb, org: ORG });
    expect(state.onAir?.label).toBeTruthy();
    expect(state.onAir?.label).not.toBe(brb);
  });
  test("not-live: refused while streaming or recording", async () => {
    live();
    const r = await call("go_on_air", { path: brb });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("streaming or recording");
    expect(state.onAir).toBeNull();
    state.obs = { connected: true, streaming: false, recording: true };
    expect((await call("go_on_air", { path: brb })).isError).toBe(true);
  });
  test("never: always refused; always: allowed while live", async () => {
    state.agent.onAir = "never";
    expect((await call("go_on_air", { path: brb })).text).toContain("never put scenes on air");
    state.agent.onAir = "always";
    live();
    expect((await call("go_on_air", { path: brb })).isError).toBe(false);
  });
  test("only scenes in the library's scene folders go on air", async () => {
    expect((await call("go_on_air", { path: `${ORG}/templates/nope.html` })).isError).toBe(true);
    await writeFile(join(root, ORG, "assets", "page.html"), "<title>x</title>");
    expect((await call("go_on_air", { path: `${ORG}/assets/page.html` })).text).toContain("Only an org's templates");
  });
  test("while live, writes to the on-air scene, its transitions and _shared are refused with a way around", async () => {
    const { projectId } = await data("create_project", { org: ORG, name: "Guarded", templates: ["teaching"] });
    const { streamId } = await data("create_stream", { org: ORG, projectId, name: "Live", date: "2026-12-06" });
    const copy = await data("customize_scene", { org: ORG, projectId, streamId, name: "teaching" });
    await data("go_on_air", { path: copy.path });
    const { hash } = await data("read_file", { path: copy.path });
    const shared = await data("read_file", { path: `${ORG}/templates/_shared/transition.html` });
    live();
    const refusals = [
      await call("write_file", { path: copy.path, text: "x", hash }),
      await call("rename_scene", { path: copy.path, hash, name: "Other" }),
      await call("revert_scene", { org: ORG, projectId, streamId, name: "teaching" }),
      await call("customize_transition", { org: ORG, projectId }),
      await call("write_file", { path: `${ORG}/templates/_shared/transition.html`, text: "x", hash: shared.hash }),
      await call("write_file", { path: `${ORG}/templates/_shared/new.css`, text: "x" }),
    ];
    // The same file by another spelling (the Mac's disk ignores case) or through a link.
    await symlink(join(root, copy.path), join(root, ORG, "templates", "alias.html"));
    refusals.push(await call("write_file", { path: copy.path.replace("teaching", "Teaching"), text: "x", hash }));
    refusals.push(await call("write_file", { path: `${ORG}/templates/alias.html`, text: "x", hash }));
    for (const r of refusals) expect({ err: r.isError, why: /you're live/.test(r.text), instead: /customize_scene|Wait until the stream ends|wait until the stream ends/.test(r.text) }).toEqual({ err: true, why: true, instead: true });
    expect(refusals[0]!.text).toBe("That scene is on air and you're live. Make a stream copy with customize_scene (or duplicate_scene) and change that, or wait until the stream ends.");
    expect(await readFile(join(root, copy.path), "utf8")).not.toBe("x");
    expect(await stat(join(root, ORG, `projects/${projectId}/transition.html`)).catch(() => null)).toBeNull();
    // Everything else is fine while live.
    expect((await call("duplicate_scene", { path: copy.path })).isError).toBe(false);
    expect((await call("write_file", { path: `${ORG}/templates/teaching.html`, text: "x", hash: (await data("read_file", { path: `${ORG}/templates/teaching.html` })).hash })).isError).toBe(false);
    // Off air again, the same writes go through.
    state.obs = { connected: true, streaming: false, recording: false };
    expect((await call("write_file", { path: copy.path, text: "<title>T</title>", hash })).isError).toBe(false);
  });
});

describe("structural tools stay inside the library (CodeRabbit)", () => {
  test("duplicate_scene of a link to a file outside is refused; a link inside still copies", async () => {
    await writeFile(join(outside, "elsewhere.html"), "<title>Secret</title>");
    await symlink(join(outside, "elsewhere.html"), join(root, ORG, "templates", "linked-out.html"));
    const r = await call("duplicate_scene", { path: `${ORG}/templates/linked-out.html` });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("outside the library");
    expect(await stat(join(root, ORG, "templates/linked-out-copy.html")).catch(() => null)).toBeNull();
    await symlink(join(root, ORG, "templates/brb.html"), join(root, ORG, "templates", "linked-in.html"));
    expect((await data("duplicate_scene", { path: `${ORG}/templates/linked-in.html` })).path).toBe(`${ORG}/templates/linked-in-copy.html`);
    // A leading slash isn't an org path.
    expect((await call("duplicate_scene", { path: `/${ORG}/templates/brb.html` })).isError).toBe(true);
  });
  test("a destination folder linked outside the library is refused", async () => {
    const { projectId } = await data("create_project", { org: ORG, name: "Linked", templates: [] });
    await rm(join(root, ORG, "projects", projectId, "streams"), { recursive: true, force: true });
    await symlink(outside, join(root, ORG, "projects", projectId, "streams"));
    const r = await call("create_stream", { org: ORG, projectId, name: "Out", date: "2026-12-08" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("outside the library");
  });
  test("two add_asset uploads with the same name at once get two files", async () => {
    const b64 = (t: string) => Buffer.from(t).toString("base64");
    const [a, b] = await Promise.all([data("add_asset", { org: ORG, name: "twin.svg", base64: b64("<svg>a</svg>") }), data("add_asset", { org: ORG, name: "twin.svg", base64: b64("<svg>b</svg>") })]);
    expect(a.path).not.toBe(b.path);
    const texts = [await readFile(join(root, a.path), "utf8"), await readFile(join(root, b.path), "utf8")].sort();
    expect(texts).toEqual(["<svg>a</svg>", "<svg>b</svg>"]);
  });
});

describe("go_on_air for a stream", () => {
  test("a project scene a stream shares goes on air for that stream, as the stream page does", async () => {
    const { projectId } = await data("create_project", { org: ORG, name: "Shared", templates: ["teaching", "brb"] });
    const { streamId } = await data("create_stream", { org: ORG, projectId, name: "Sunday", date: "2026-12-07" });
    const teaching = `${ORG}/projects/${projectId}/scenes/teaching.html`;
    await data("go_on_air", { path: teaching, streamId });
    expect(state.onAir).toMatchObject({ path: teaching, projectId, streamId });
    expect(state.onAir!.label).toEndWith(" · Sunday");
    // Without streamId it's the project's scene, as before.
    await data("go_on_air", { path: teaching });
    expect(state.onAir!.streamId).toBeUndefined();
    // A stream with its own copy: that copy goes on air, not the project's.
    const copy = await data("customize_scene", { org: ORG, projectId, streamId, name: "teaching" });
    const r = await call("go_on_air", { path: teaching, streamId });
    expect(r.isError).toBe(true);
    expect(r.text).toContain(copy.path);
    expect((await call("go_on_air", { path: teaching, streamId: "nope" })).text).toContain('no stream "nope"');
  });
});

describe("the guard covers what the scene on air loads, and is checked again as a change commits", () => {
  test("while live, files the on-air scene loads (pictures, stylesheets, through its theme) are refused; others aren't", async () => {
    await writeFile(join(root, ORG, "assets/live-logo.svg"), "<svg/>");
    await writeFile(join(root, ORG, "assets/spare.svg"), "<svg/>");
    await writeFile(join(root, ORG, "assets/live.css"), ".x { background: url(tex.svg) }");
    await writeFile(join(root, ORG, "assets/tex.svg"), "<svg/>");
    const scene = `${ORG}/templates/live-scene.html`;
    await writeFile(join(root, scene), `<title>Live</title><link rel="stylesheet" href="/library/${ORG}/assets/live.css"><img src="../assets/live-logo.svg"><img src="/library/${ORG}/assets/soon.png">`);
    await data("go_on_air", { path: scene });
    const hashOf = async (p: string) => (await data("read_file", { path: p })).hash;
    const [logo, css, tex, spare] = [await hashOf(`${ORG}/assets/live-logo.svg`), await hashOf(`${ORG}/assets/live.css`), await hashOf(`${ORG}/assets/tex.svg`), await hashOf(`${ORG}/assets/spare.svg`)];
    live();
    for (const [path, hash] of [[`${ORG}/assets/live-logo.svg`, logo], [`${ORG}/assets/live.css`, css], [`${ORG}/assets/tex.svg`, tex]] as const) {
      const r = await call("write_file", { path, text: "<svg>new</svg>", hash });
      expect({ path, err: r.isError, text: r.text }).toEqual({ path, err: true, text: "The scene on air uses that file, and you're live. Save your version under a new name and use it in a stream copy of the scene (customize_scene), or wait until the stream ends." });
    }
    expect(await readFile(join(root, ORG, "assets/live-logo.svg"), "utf8")).toBe("<svg/>");
    // A picture the scene asks for but that isn't there yet would show the moment it's created.
    expect((await call("add_asset", { org: ORG, name: "soon.png", base64: Buffer.from("png").toString("base64") })).isError).toBe(true);
    // An upload whose name is taken gets a free name, so it never replaces what's on air.
    expect((await data("add_asset", { org: ORG, name: "live-logo.svg", base64: Buffer.from("<svg/>").toString("base64") })).path).not.toBe(`${ORG}/assets/live-logo.svg`);
    expect((await call("write_file", { path: `${ORG}/assets/spare.svg`, text: "<svg>new</svg>", hash: spare })).isError).toBe(false);
    state.obs = { connected: true, streaming: false, recording: false };
    expect((await call("write_file", { path: `${ORG}/assets/live-logo.svg`, text: "<svg>new</svg>", hash: logo })).isError).toBe(false);
  });
  test("go_on_air: OBS going live while the scene is looked up stops it", async () => {
    beforeCommit = live;
    const r = await call("go_on_air", { path: `${ORG}/templates/brb.html` });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("streaming or recording");
    expect(state.onAir).toBeNull();
  });
  test("go_on_air: the setting changed to never in the meantime stops it", async () => {
    beforeCommit = () => (state.agent.onAir = "never");
    expect((await call("go_on_air", { path: `${ORG}/templates/brb.html` })).text).toContain("never put scenes on air");
    expect(state.onAir).toBeNull();
  });
  test("writeText runs beforeWrite in turn, after the hash check and before writing; a throw writes nothing", async () => {
    const p = `${ORG}/templates/queued.html`;
    await writeFile(join(root, p), "<title>A</title>");
    const order: string[] = [];
    const refuse = () => {
      order.push("check");
      throw new Error("live now");
    };
    expect(writeText(root, p, "<title>B</title>", sceneHash("<title>A</title>"), { beforeWrite: refuse })).rejects.toThrow("live now");
    expect(writeText(root, `${ORG}/templates/queued-new.html`, "x", undefined, { beforeWrite: refuse })).rejects.toThrow("live now");
    await Bun.sleep(10);
    expect(order).toEqual(["check", "check"]);
    expect(await readFile(join(root, p), "utf8")).toBe("<title>A</title>");
    expect(await stat(join(root, ORG, "templates/queued-new.html")).catch(() => null)).toBeNull();
    // A stale hash is refused before the check runs.
    expect((await writeText(root, p, "x", "stale", { beforeWrite: refuse })).ok).toBe(false);
    expect(order.length).toBe(2);
  });
});

describe("no absolute paths", () => {
  test("no result, refusal or error has the library's path in it", async () => {
    await call("read_file", { path: `${ORG}/templates/missing.html` });
    await call("customize_transition", { org: ORG, projectId: "nope" });
    await call("list_files", { path: `${ORG}/nope` });
    expect(seen.length).toBeGreaterThan(50);
    for (const s of seen) {
      expect(s.includes(root)).toBe(false);
      expect(s.includes(realRoot)).toBe(false);
      expect(s.includes(outside)).toBe(false);
    }
  });
});

