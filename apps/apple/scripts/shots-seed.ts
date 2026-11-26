// Seeds a scratch switcher for the App Store screenshots (scripts/ipad-shots.sh) through its own API, as
// a person would in the app: OBS set up, the Full Count and Grace Community template sets added, a
// project and a stream for each, and Full Count's Pregame on air (the screenshots then tap Both hosts).
// Every device box shows a picture, as OBS would put a camera there: the site's photos for that show
// (apps/site/src/assets/media, credited in apps/site/CREDITS.md), added to the scratch copy of the
// template set only. Prints the two stream pages' paths as shell assignments.
//
//   bun apps/apple/scripts/shots-seed.ts http://127.0.0.1:7445
import { appendFile, copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SHOWS } from "../../../packages/packs/src/shows";

const base = process.argv[2] ?? "";
const library = process.env.VIEWSWITCHER_LIBRARY ?? "";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base) || base.endsWith(":7420")) throw new Error("usage: shots-seed.ts http://127.0.0.1:<port> (never 7420)");
if (!library || library.includes("ViewSwitcher Library")) throw new Error("set VIEWSWITCHER_LIBRARY to the scratch library (never ~/ViewSwitcher Library)");

async function call(path: string, body?: unknown) {
  const r = await fetch(base + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${await r.text()}`);
  return r.json();
}

const state = await call("/api/state");
if (!state.obs.connected) throw new Error("OBS (the fake one) isn't connected");
await call("/api/obs/setup", {});

// A fresh library starts with a "My channel" org; these shots show two real-looking shows instead.
for (const org of await call("/api/orgs")) await rm(join(library, org.id), { recursive: true, force: true });

const today = new Date().toISOString().slice(0, 10);
async function show(name: string, accent: string, ground: string, pack: string, project: string, stream: string) {
  const { orgId } = await call("/api/orgs", { name, accent, ground });
  const { token } = await call("/api/packs/builtin/stage", { org: orgId, id: pack });
  await call("/api/sets/install", { org: orgId, token });
  await fillDevices(orgId, pack);
  // Not the starter views every new org gets: their boxes would be empty.
  const templates = join(library, orgId, "templates");
  for (const f of await readdir(templates)) if (f.endsWith(".html")) await rm(join(templates, f));
  const lib = await call(`/api/library?org=${orgId}`);
  const set = lib.sets.find((s: { id: string }) => s.id === pack);
  const { projectId } = await call("/api/projects", { org: orgId, name: project, templates: set.templates.map((t: { name: string }) => `${pack}/${t.name}`) });
  const { streamId } = await call("/api/streams", { org: orgId, projectId, name: stream, date: today });
  // The show's views become the org's own templates, so its Templates page shows them first and nothing
  // empty: copies of the set's views (they keep linking its _shared/), and the set's pack.json goes.
  const names = set.templates.map((t: { name: string }) => t.name);
  for (const n of names) await copyFile(join(templates, pack, `${n}.html`), join(templates, `${n}.html`));
  await writeFile(join(templates, "_shared", "order.json"), JSON.stringify({ order: names }) + "\n");
  await rm(join(templates, pack, "pack.json"));
  return { orgId, projectId, streamId, page: `/${orgId}/p/${projectId}/${streamId}` };
}

/** The show's photo in each device box (Camera, Guest, Screen), through the set's own theme.css. */
async function fillDevices(orgId: string, pack: string) {
  const media = resolve(import.meta.dir, "../../site/src/assets/media");
  const slots = new Map<string, string>();
  for (const v of SHOWS.find((x) => x.id === pack)?.views ?? []) for (const [slot, m] of Object.entries(v.media ?? {})) if (!slots.has(slot)) slots.set(slot, m);
  const shared = join(library, orgId, "templates", pack, "_shared");
  await mkdir(join(shared, "shots"), { recursive: true });
  let css = "\n/* App Store screenshots (apps/apple/scripts/shots-seed.ts): a picture in every device box. */\n.slot::before { content: none !important; }\n";
  for (const [slot, m] of slots) {
    await copyFile(join(media, `${m}.jpg`), join(shared, "shots", `${m}.jpg`));
    css += `.slot[data-slot="${slot}"] { background: url(shots/${m}.jpg) center / cover !important; outline: none !important; }\n`;
  }
  await appendFile(join(shared, "theme.css"), css);
}

const fc = await show("Full Count", "#e63946", "#0b1426", "fullcount", "Full Count", "Ep. 112");
const grace = await show("Grace Community", "#c9a45c", "#08080a", "grace", "Sunday Live", "Romans 12");
await call("/api/onair", { path: `${fc.orgId}/projects/${fc.projectId}/scenes/starting-soon.html`, label: "Pregame", projectId: fc.projectId, streamId: fc.streamId });
console.log(`FULLCOUNT=${fc.page}\nGRACE=${grace.page}`);
