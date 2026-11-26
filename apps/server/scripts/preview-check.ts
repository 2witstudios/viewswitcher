// Real-OBS check for previews, serving the library itself on --port and printing timings and OBS's program before/after: OBS_URL=… OBS_PASSWORD=… bun apps/server/scripts/preview-check.ts --library <dir> --scene <org/…/scene.html> --out <file.png> [--full] [--program] [--port 7433]
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { config } from "../src/config";
import { OBSClient } from "../src/obs";
import { inside } from "../src/paths";
import { isBlankPng } from "../src/png";
import { createPreviewer } from "../src/preview";

const { values: args } = parseArgs({
  options: {
    library: { type: "string" },
    scene: { type: "string" },
    out: { type: "string" },
    full: { type: "boolean", default: false },
    program: { type: "boolean", default: false },
    port: { type: "string", default: "7433" },
  },
});
if (!args.library || !args.out || (!args.scene && !args.program)) {
  console.error("Usage: bun apps/server/scripts/preview-check.ts --library <dir> --scene <org/…/scene.html> --out <file.png> [--full] [--program] [--port 7433]");
  process.exit(2);
}
const port = Number(args.port);
if (port === 7420) {
  console.error("Use another port: 7420 is the live switcher's.");
  process.exit(2);
}
const library = resolve(args.library);

// Just the library's files, which is all a ?preview page loads.
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    if (!path.startsWith("/library/")) return new Response("Not found", { status: 404 });
    try {
      const file = Bun.file(inside(library, path.slice("/library/".length)));
      return (await file.exists()) ? new Response(file, { headers: { "cache-control": "no-store" } }) : new Response("Not found", { status: 404 });
    } catch {
      return new Response("Bad path", { status: 400 });
    }
  },
});

const obs = new OBSClient({ url: config.obs.url, password: config.obs.password }).start();
const ms = (since: number) => `${Math.round(performance.now() - since)} ms`;
const program = async () => {
  const [{ currentProgramSceneName }, stream, record] = await Promise.all([
    obs.request("GetCurrentProgramScene"), obs.request("GetStreamStatus"), obs.request("GetRecordStatus"),
  ]);
  return `program "${currentProgramSceneName}", streaming ${stream.outputActive}, recording ${record.outputActive}`;
};

try {
  await obs.ready();
  const before = await program();
  console.log(`Before: ${before}`);
  const previewer = createPreviewer(obs, { obs: config.obs, port, library });

  const started = performance.now();
  const r = args.program ? await previewer.program({ full: args.full }) : await previewer.scene(args.scene!, { full: args.full });
  console.log(`${args.program ? "Program" : "Preview"}: ${ms(started)}`);

  if (!args.program) {
    const { videoActive, videoShowing } = await obs.request("GetSourceActive", { sourceName: config.obs.previewSource });
    console.log(`Preview source: active ${videoActive}, showing ${videoShowing}`);
  }
  if (r.ok) {
    await Bun.write(args.out, r.png);
    console.log(`Saved ${r.width}×${r.height}, ${r.png.length} bytes, to ${args.out}${isBlankPng(r.png) ? " (empty!)" : ""}`);
  } else {
    console.log(`No picture: ${r.reason}\nURL: ${r.url}`);
    process.exitCode = 1;
  }

  // A second, warm run: the source exists and the browser is up.
  if (!args.program) {
    const again = performance.now();
    const r2 = await previewer.scene(args.scene!, { full: args.full });
    console.log(`Again: ${ms(again)} (${r2.ok ? "picture" : "no picture"})`);
  }

  const after = await program();
  console.log(`After:  ${after}${after === before ? "" : "  ← CHANGED"}`);
  if (after !== before) process.exitCode = 1;
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  obs.stop();
  server.stop(true);
}
