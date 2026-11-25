// Seeds a scratch switcher for the App Store screenshots (scripts/ipad-shots.sh) through its own API, as
// a person would in the app: OBS set up, the Full Count and Grace Community template sets added, a
// project and a stream for each, and Full Count's Pregame on air (the screenshots then tap Both hosts).
// Prints the two stream pages' paths as shell assignments.
//
//   bun apps/apple/scripts/shots-seed.ts http://127.0.0.1:7445
import { rm } from "node:fs/promises";
import { join } from "node:path";

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
  await call("/api/packs/install", { org: orgId, token });
  const lib = await call(`/api/library?org=${orgId}`);
  const set = lib.sets.find((s: { id: string }) => s.id === pack);
  const { projectId } = await call("/api/projects", { org: orgId, name: project, templates: set.templates.map((t: { name: string }) => `${pack}/${t.name}`) });
  const { streamId } = await call("/api/streams", { org: orgId, projectId, name: stream, date: today });
  return { orgId, projectId, streamId, page: `/${orgId}/p/${projectId}/${streamId}` };
}

const fc = await show("Full Count", "#e63946", "#0b1426", "fullcount", "Full Count", "Ep. 112");
const grace = await show("Grace Community", "#c9a45c", "#08080a", "grace", "Sunday Live", "Romans 12");
await call("/api/onair", { path: `${fc.orgId}/projects/${fc.projectId}/scenes/starting-soon.html`, label: "Pregame", projectId: fc.projectId, streamId: fc.streamId });
console.log(`FULLCOUNT=${fc.page}\nGRACE=${grace.page}`);
