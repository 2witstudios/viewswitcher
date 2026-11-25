// End-to-end check of a built ViewSwitcher.app (MAC-11 … MAC-13a), without touching a live switcher,
// OBS or an iPad:
//
//   bun apps/apple/scripts/e2e.ts [path/to/ViewSwitcher.app]     (default: apps/apple/build/export)
//
// Runs the app on E2E_PORT (default 7435, never 7420) with OBS offline (ws://127.0.0.1:1), the USB
// bridge off, updates off and a fresh temp library. It drives the app through VIEWSWITCHER_E2E_DIR
// (apps/apple/Mac/E2E.swift) and checks: first run, the bundled server, the window and its user
// agent, the menu-bar status, agents (the sidecar's /mcp and --mcp-stdio, Edit with AI), navigation
// and permissions, Undo forwarding, the traffic lights and drag regions (MAC-13a), close-keeps-serving, Quit stopping the server, attach mode (Quit leaves a
// server it didn't start), Restart Server, a port held by something else, and that the server exits
// if the app is killed, and phones and tablets on the Wi-Fi (MAC-23 … MAC-26: the menu, the Wi-Fi
// listener on this Mac's LAN address E2E_LAN_IP, pairing from that address, removing a device,
// turning it off). SCREENSHOTS=<dir> also saves the window, windowed and full screen, and the
// Phones and Tablets window and the menu.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { networkInterfaces, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PORT = process.env.E2E_PORT ?? "7435";
if (PORT === "7420") throw new Error("Never run this against 7420 (the live switcher).");
const BASE = `http://127.0.0.1:${PORT}`;
const apple = resolve(import.meta.dir, "..");
const repo = resolve(apple, "../..");
const appPath = resolve(process.argv[2] ?? join(apple, "build/export/ViewSwitcher.app"));
const exe = join(appPath, "Contents/MacOS/ViewSwitcher");
const sidecar = join(appPath, "Contents/Helpers/viewswitcher-server");
if (!existsSync(exe)) throw new Error(`No app at ${appPath} (build it with bun run mac:build --app)`);
const shots = process.env.SCREENSHOTS ? resolve(process.env.SCREENSHOTS) : null;
if (shots) mkdirSync(shots, { recursive: true });

let failures = 0;
const check = (ok: unknown, what: string) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const answers = async () => await fetch(`${BASE}/api/state`, { signal: AbortSignal.timeout(800) }).then((r) => r.ok, () => false);
const until = async (f: () => Promise<unknown> | unknown, ms = 15_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await f()) return true;
    } catch {}
    await sleep(150);
  }
  return false;
};
/** PIDs listening on the port. */
const listeners = () => Bun.spawnSync(["lsof", "-nP", `-iTCP:${PORT}`, "-sTCP:LISTEN", "-t"]).stdout.toString().split("\n").filter(Boolean).map(Number);
const command = (pid: number) => Bun.spawnSync(["ps", "-o", "command=", "-p", String(pid)]).stdout.toString().trim();

if (listeners().length) throw new Error(`Port ${PORT} is busy; stop what's there first.`);
const LAN_IP = process.env.E2E_LAN_IP ?? Object.values(networkInterfaces()).flat().find((i) => i?.family === "IPv4" && !i.internal && /^(192\.168|10|172\.(1[6-9]|2\d|3[01]))\./.test(i.address))?.address;
const library = mkdtempSync(join(tmpdir(), "vs-e2e-lib-"));
const control = mkdtempSync(join(tmpdir(), "vs-e2e-ctl-"));
const env = {
  ...process.env,
  PORT,
  OBS_URL: process.env.OBS_URL ?? "ws://127.0.0.1:1",
  VIEWSWITCHER_USB: "0",
  VIEWSWITCHER_LIBRARY: library,
  VIEWSWITCHER_UPDATES: "0",
  VIEWSWITCHER_E2E_DIR: control,
  // The Wi-Fi listener binds only this Mac's LAN address, so the check reaches it the way a phone does.
  ...(LAN_IP ? { VIEWSWITCHER_LAN_HOST: LAN_IP } : {}),
} as Record<string, string>;

/** A request that arrives from this Mac's LAN address, as a phone's would (node:http: it sends the Host and Origin given). */
function fromLan(path: string, { method = "GET", headers = {} as Record<string, string>, body = "" } = {}) {
  return new Promise<{ status: number; body: string; cookie: string }>((resolve, reject) => {
    const req = http.request({ host: LAN_IP, port: Number(PORT), path, method, agent: false, headers: { host: `${LAN_IP}:${PORT}`, ...headers } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data, cookie: String(res.headers["set-cookie"]?.[0] ?? "").split(";")[0] }));
    });
    req.on("error", reject);
    // A stalled connection mustn't hold up the polling around it: give up after 3 s.
    const deadline = setTimeout(() => req.destroy(new Error("timed out")), 3000);
    req.on("close", () => clearTimeout(deadline));
    req.end(body);
  });
}
const lanOpen = () => fromLan("/").then(() => true, () => false);

// ------------------------------------------------------------ driving the app
let seq = 0;
async function cmd<T = any>(op: string, args: Record<string, unknown> = {}, ms = 10_000): Promise<T> {
  const id = String(++seq).padStart(5, "0");
  const tmp = join(control, `tmp-cmd-${id}`);
  writeFileSync(tmp, JSON.stringify({ op, ...args }));
  renameSync(tmp, join(control, `cmd-${id}.json`));
  const res = join(control, `res-${id}.json`);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (existsSync(res)) {
      const { result } = JSON.parse(readFileSync(res, "utf8"));
      rmSync(res);
      if (result && typeof result === "object" && "error" in result && Object.keys(result).length === 1) throw new Error(`${op}: ${result.error}`);
      return result as T;
    }
    await sleep(50);
  }
  throw new Error(`${op}: no answer from the app`);
}
type Remotes = { visible: boolean; enabled: boolean; code: string; pairUrl: string; devices: string[]; error: string };
type State = {
  wifi: boolean; remotes: Remotes | null;
  menu: string[]; menuEnabled: string[]; statusTitle: string; statusLive: boolean;
  server: { owned: boolean; pid: number } | null;
  window: { visible: boolean; number: number; fullscreen: boolean; url: string; frame: [number, number]; lights: number[][]; events: string[] } | null;
  opened: string[]; alerts: string[]; notices: string[]; loginItem: boolean; updater: boolean; undoRoute: string; feed: string;
};
const state = () => cmd<State>("state");
const evalJs = <T = any>(js: string) => cmd<T>("eval", { js });

type App = { proc: ReturnType<typeof Bun.spawn>; exited: boolean };
/** Every app process this script started: cleanup kills only these, never another copy (say, an installed one serving 7420). */
const started: ReturnType<typeof Bun.spawn>[] = [];
async function launch(): Promise<App> {
  for (const f of readdirSync(control)) rmSync(join(control, f), { force: true });
  const proc = Bun.spawn([exe], { env, stdout: "ignore", stderr: "ignore" });
  started.push(proc);
  const app = { proc, exited: false };
  proc.exited.then(() => (app.exited = true));
  if (!(await until(() => state(), 20_000))) throw new Error("the app didn't come up");
  return app;
}
async function quit(app: App) {
  await cmd("quit").catch(() => {});
  return until(() => app.exited, 10_000);
}
const shoot = async (name: string) => {
  if (!shots) return;
  const s = await state();
  if (!s.window) return;
  await sleep(700);
  const file = join(shots, `${name}.png`);
  // screencapture needs Screen Recording permission for whatever runs this; without it, the app draws its own window.
  const p = Bun.spawnSync(["screencapture", "-x", "-o", `-l${s.window.number}`, file]);
  if (p.exitCode || !existsSync(file)) {
    await cmd("snapshot", { path: file }, 15_000).then(
      () => console.log(`  screenshot ${name}.png (drawn by the app: page snapshot + its title bar views)`),
      (e) => console.log(`  screenshot ${name}.png failed: ${e.message}`),
    );
  } else console.log(`  screenshot ${name}.png`);
};

try {
  console.log(`\n${appPath}\nport ${PORT}, library ${library}\n`);

  // ------------------------------------------------------------ first run, bundled server, window (MAC-11)
  let app = await launch();
  check(await until(answers), "the bundled server answers");
  const [pid] = listeners();
  check(pid && command(pid).startsWith(sidecar), `it is the app's own sidecar (${pid && command(pid)})`);
  check(await until(async () => (await state()).server?.owned === true), "the app owns it");
  check(existsSync(join(library, ".claude/skills/viewswitcher-scenes/SKILL.md")) && existsSync(join(library, "CLAUDE.md")), "first run: the library has the skill and CLAUDE.md");
  check(existsSync(join(library, "my-channel/org.json")), "first run: a first org");
  check(existsSync(join(library, ".git")) || !Bun.which("git"), "first run: git init (when git is available)");
  check(readFileSync(join(library, ".gitignore"), "utf8").includes(".viewswitcher/"), "first run: .gitignore");
  // EDIT-29: the built-in template packs ship in Resources/packs and the bundled server lists them.
  const builtin = await fetch(`${BASE}/api/packs/builtin`).then((r) => r.json(), () => []) as { id: string }[];
  check(existsSync(join(appPath, "Contents/Resources/packs/fullcount/pack.json")), "the app ships the built-in template packs (Resources/packs)");
  check(builtin.map((p) => p.id).join() === "starter,fullcount,nova,grace,remi,riverside,kitchen", `the bundled server lists them (${builtin.map((p) => p.id).join(", ")})`);
  check(await until(async () => (await state()).window?.url.startsWith(`${BASE}/`)), `the window shows the switcher`);
  check(await until(() => evalJs("return document.readyState === 'complete' && !!document.querySelector('.app')")), "the switcher page has loaded");
  const ua = await evalJs<string>("return navigator.userAgent");
  check(/ViewSwitcher-Mac\/\d/.test(ua) && !/ViewSwitcher-iPad/.test(ua), `user agent is ViewSwitcher-Mac, not the iPad's (${ua})`);
  check(await until(() => evalJs("return !![...document.querySelectorAll('.setup-card h2')].find((h) => /Connect OBS/.test(h.textContent))"), 10_000), "the switcher (not the iPad connector) with the OBS setup card");
  check(!(await evalJs("return !!document.querySelector('.pill.link')")), "no USB/Network pill: not taken for the iPad app");
  const info = await state();
  check(info.feed === "https://github.com/2witstudios/viewswitcher/releases/latest/download/appcast.xml", `Sparkle feed is the latest release's appcast (${info.feed})`);
  const plist = Bun.spawnSync(["/usr/libexec/PlistBuddy", "-c", "Print :SUPublicEDKey", join(appPath, "Contents/Info.plist")]).stdout.toString().trim();
  check(plist.length === 44, "Sparkle public EdDSA key is in Info.plist");

  // ------------------------------------------------------------ menu bar (MAC-12)
  check(await until(async () => (await state()).menu.includes("OBS: not connected")), "menu bar: OBS not connected");
  const s1 = await state();
  console.log(`  menu: ${s1.menu.filter(Boolean).join(" | ")}`);
  for (const l of ["Nothing on air", "iPad: USB link off", "Open ViewSwitcher", "Open in Browser", "Open Library Folder", "Set Up OBS…", "Check for Updates…", "Open at Login", "Show Server Log", "Quit ViewSwitcher"]) check(s1.menu.includes(l), `menu bar: "${l}"`);
  check(!s1.menuEnabled.includes("Set Up OBS…"), "menu bar: Set Up OBS waits for OBS");
  check(!s1.menu.includes("Restart Server"), "menu bar: no Restart Server while a server runs");
  const orgScene = "my-channel/templates/brb.html";
  await fetch(`${BASE}/api/onair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: orgScene, label: "Be right back" }) });
  check(await until(async () => (await state()).menu.includes("On air: Be right back")), "menu bar: shows what's on air");
  const s2 = await state();
  check(s2.statusTitle.includes("Be right back") && s2.statusLive, "menu bar title and red icon: the on-air scene");
  check(!s2.loginItem, "not opening at login by default");
  await cmd("menu", { item: "Open in Browser" });
  await cmd("menu", { item: "Open Library Folder" });
  check(await until(async () => {
    const o = (await state()).opened;
    return o.includes(`${BASE}/`) && o.some((p) => resolve(p) === resolve(library) || p.endsWith(library.split("/").pop()!));
  }, 5000), "menu bar: Open in Browser and Open Library Folder");

  // ------------------------------------------------------------ the page may change things; other sites may not
  const fromPage = await evalJs<number>(`return (await fetch("/api/onair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: ${JSON.stringify(orgScene)}, label: "Be right back" }) })).status`);
  check(fromPage === 200, "a POST from the switcher's own page is accepted");
  const evil = await fetch(`${BASE}/api/obs/stream`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "text/plain" }, body: "{}" });
  check(evil.status === 403, "a cross-site POST (Origin: https://evil.example) is refused with 403");

  // ------------------------------------------------------------ agents: MCP and Edit with AI (MCP-10)
  const rpc = (id: number, method: string, params: Record<string, unknown> = {}) => ({ jsonrpc: "2.0", id, method, params });
  const init = rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "vs-e2e", version: "1" } });
  const mcpInit = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(init) }).then((r) => r.json(), () => null);
  check(mcpInit?.result?.serverInfo && /get_guide/.test(mcpInit.result.instructions ?? ""), `the bundled server answers /mcp initialize (${JSON.stringify(mcpInit?.result?.serverInfo)})`);
  // As Edit with AI's command runs it: the port on the command line, and a PORT in the agent's own environment that it ignores.
  const relay = Bun.spawn([sidecar, "--mcp-stdio", "--port", PORT], { env: { ...env, PORT: "1", VIEWSWITCHER_E2E_DIR: "" }, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  relay.stdin.write(`${JSON.stringify(init)}\n${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n${JSON.stringify(rpc(2, "tools/list"))}\n`);
  relay.stdin.flush();
  let relayed = "";
  const reader = relay.stdout.getReader();
  const listed = await Promise.race([
    (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return null;
        relayed += new TextDecoder().decode(value);
        // Only whole lines: a read can end partway through one.
        const line = relayed.slice(0, relayed.lastIndexOf("\n") + 1).split("\n").find((l) => l.includes('"id":2'));
        if (line) return JSON.parse(line);
      }
    })(),
    sleep(10_000).then(() => null),
  ]);
  relay.kill();
  const tools = listed?.result?.tools?.length;
  check(tools === 22 && relayed.slice(0, relayed.lastIndexOf("\n")).split("\n").filter(Boolean).every((l) => JSON.parse(l).jsonrpc === "2.0"), `<sidecar> --mcp-stdio relays tools/list: ${tools} tools, only JSON-RPC on stdout`);

  // The bundled server's built-in template sets (Resources/packs) reach agents, as Add templates lists them.
  const setsCall = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(rpc(3, "tools/call", { name: "list_template_sets", arguments: {} })) }).then((r) => r.json(), () => null);
  const setIds = ((): string[] => {
    try {
      return JSON.parse(setsCall.result.content[0].text).map((s: { id: string }) => s.id);
    } catch {
      return [];
    }
  })();
  check(setIds.includes("starter") && setIds.includes("grace") && setIds.length === 7, `/mcp list_template_sets: the 7 built-in template sets (${setIds.join(", ")})`);

  check((await state()).menu.includes("Edit with AI…"), 'menu bar: "Edit with AI…"');
  await cmd("menu", { item: "Edit with AI…" });
  check(await until(() => evalJs("return !!document.querySelector('.agent-sheet') && !location.search.includes('ai') && location.hash !== '#ai'"), 8000), "Edit with AI… opens the window on the sheet");
  // The sheet fills in as /api/info and /api/agent/clients answer (the Claude Desktop button needs info), so wait for it to settle.
  let rows: string[] = [];
  const settled = await until(async () => {
    rows = await evalJs<string[]>("return [...document.querySelectorAll('.agent-way h3')].map((h) => h.firstChild.textContent)");
    return ["Claude Code", "Claude Desktop", "Cursor", "Codex, VS Code and other agents"].every((r) => rows.includes(r)) &&
      (await evalJs("return !!document.querySelector('.agent-guide') && !document.querySelector('.agent-builtin') && [...document.querySelectorAll('.agent-way a')].some((a) => a.textContent === 'Add to Claude Desktop')"));
  }, 8000);
  check(settled, `the sheet in the Mac window: every way in and the Setup guide link, no built-in AI row (${JSON.stringify(rows)})`);
  const before = (await state()).opened.length;
  await evalJs(`[...document.querySelectorAll(".agent-way a")].find((a) => a.textContent === "Add to Claude Desktop").click(); return true`);
  check(await until(async () => (await state()).opened.slice(before).some((p) => p.endsWith("/ViewSwitcher.mcpb")), 8000), "Add to Claude Desktop saves the extension and opens it");
  const mcpb = (await state()).opened.slice(before).find((p) => p.endsWith("/ViewSwitcher.mcpb"));
  if (mcpb) {
    const out = mkdtempSync(join(tmpdir(), "vs-e2e-mcpb-"));
    Bun.spawnSync(["unzip", "-q", mcpb, "-d", out]);
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    check(manifest.server.mcp_config.command === sidecar && manifest.server.mcp_config.args.join(" ") === `--mcp-stdio --port ${PORT}`, `its command is this app's sidecar with --mcp-stdio on port ${PORT}`);
    rmSync(out, { recursive: true, force: true });
  }
  await evalJs(`[...document.querySelectorAll(".agent-way a")].find((a) => a.textContent === "Add to Cursor").click(); return true`);
  check(await until(async () => (await state()).opened.some((u) => u.startsWith("cursor://anysphere.cursor-deeplink/mcp/install?")), 5000), "Add to Cursor opens Cursor's install link (the one app URL the window opens)");
  await evalJs(`document.querySelector(".agent-guide").click(); return true`);
  check(await until(async () => (await state()).opened.includes("https://viewswitcher.com/ai"), 5000), "Setup guide opens viewswitcher.com/ai in the browser");
  await evalJs(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); return true`);

  // ------------------------------------------------------------ permissions and navigation (MAC-13)
  const perms = await evalJs<Record<string, string>>(`
    const out = {};
    out.notifications = typeof Notification === "undefined" ? "unavailable" : await Notification.requestPermission();
    out.geolocation = await new Promise((r) => { if (!navigator.geolocation) return r("unavailable"); navigator.geolocation.getCurrentPosition(() => r("granted"), (e) => r(e.code === 1 ? "denied" : "error " + e.code)); setTimeout(() => r("no answer"), 3000); });
    out.camera = await navigator.mediaDevices?.getUserMedia({ video: true }).then(() => "granted", (e) => e.name) ?? "unavailable";
    return out;`);
  check(perms.notifications !== "granted" && !/granted/.test(perms.geolocation) && perms.camera !== "granted", `browser permissions are refused (${JSON.stringify(perms)})`);
  const openedBefore = (await state()).opened.length;
  await evalJs(`
    const a = document.createElement("a");
    a.href = "file:///System/Applications/Calculator.app";
    document.body.append(a); a.click(); a.remove();
    window.open("x-apple.systempreferences:com.apple.preference.security");
    window.open("https://example.com/");
    const b = document.createElement("a");
    b.href = "https://example.org/"; document.body.append(b); b.click(); b.remove();
    return true;`);
  await sleep(800);
  const s3 = await state();
  const opened = s3.opened.slice(openedBefore).filter((u) => /^https?:\/\/example\./.test(u) || !u.startsWith("/") && !u.startsWith(BASE));
  check(s3.window!.url.startsWith(BASE) && JSON.stringify(opened) === JSON.stringify(["https://example.com/", "https://example.org/"]), `only http(s) leaves the window, in the browser (opened: ${JSON.stringify(opened)}; events: ${JSON.stringify(s3.window!.events.filter((e) => e.startsWith("denied")))})`);

  // ------------------------------------------------------------ Undo forwards to the page (MAC-13)
  await evalJs(`window.__keys = []; window.addEventListener("keydown", (e) => window.__keys.push((e.metaKey ? "⌘" : "") + (e.shiftKey ? "⇧" : "") + e.key.toLowerCase())); document.activeElement?.blur(); return true;`);
  await cmd("menu", { menu: "Edit", item: "Undo" });
  await cmd("menu", { menu: "Edit", item: "Redo" });
  check(await until(async () => JSON.stringify(await evalJs("return window.__keys")) === JSON.stringify(["⌘z", "⌘⇧z"]), 3000), "Edit → Undo/Redo from the menu reach the page as ⌘Z/⇧⌘Z (the editor's Undo)");
  await evalJs("window.__keys = []; return true");
  await cmd("key", { key: "z", mods: ["cmd"] });
  await sleep(600);
  const typed = await evalJs<string[]>("return window.__keys");
  check(JSON.stringify(typed) === JSON.stringify(["⌘z"]), `a typed ⌘Z reaches the page exactly once (${JSON.stringify(typed)}, ${(await state()).undoRoute})`);
  await evalJs(`const i = document.createElement("input"); i.id = "e2e-field"; document.body.append(i); i.focus(); document.execCommand("insertText", false, "abc"); window.__keys = []; return i.value;`);
  await cmd("menu", { menu: "Edit", item: "Undo" });
  // The native undo lands a moment later on a busy machine: wait for it rather than sample once.
  let field = "abc";
  await until(async () => (field = await evalJs<string>(`return document.getElementById("e2e-field").value`)) !== "abc", 3000);
  check(field !== "abc" && (await evalJs<string[]>("return window.__keys")).length === 0 && (await state()).undoRoute === "native", `in a text field, Undo is the native text undo ("abc" → "${field}")`);
  await evalJs(`document.getElementById("e2e-field")?.remove(); return true`);

  // ------------------------------------------------------------ safe zones (MAC-13a)
  await cmd("resize", { w: 1280, h: 800 });
  await sleep(500);
  const s4 = await state();
  const lights = s4.window!.lights;
  const layout = await evalJs<any>(`
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; };
    const css = getComputedStyle(document.documentElement);
    return { shell: document.documentElement.dataset.shell, lights: css.getPropertyValue("--shell-lights").trim(), header: css.getPropertyValue("--shell-header").trim(),
      brand: r(".brand"), brandText: r(".brand span"), drag: r(".shell-drag"), main: r(".page-head") };`);
  console.log(`  lights ${JSON.stringify(lights)}  page ${JSON.stringify(layout)}`);
  const [close, , zoom] = lights;
  const lightsMid = close[1] + close[3] / 2;
  const brandMid = layout.brandText[1] + layout.brandText[3] / 2;
  check(layout.shell === "mac" && layout.lights !== "0px" && layout.header === "64px", "the page knows it's in the Mac window (data-shell, --shell-*)");
  check(Math.abs(lightsMid - 32) <= 1 && Math.abs(brandMid - lightsMid) <= 2, `the traffic lights line up with the header row (lights at ${lightsMid}, brand at ${brandMid})`);
  check(layout.brandText[0] >= zoom[0] + zoom[2] + 6, "the brand clears the traffic lights");
  check(layout.drag && layout.drag[3] === 28 && layout.main[1] >= 28, "a 28 px drag band at the top, with no controls under it");
  // A click in the title bar's band still reaches the page (the band is the page's, not AppKit's).
  await evalJs(`const b = document.createElement("button"); b.id = "e2e-top"; b.textContent = "x"; b.style.cssText = "position:fixed;top:40px;left:600px;z-index:99;width:40px;height:20px"; b.onclick = () => (window.__clicked = true); document.body.append(b); return true;`);
  await cmd("click", { x: 620, y: 50 });
  check(await until(() => evalJs("return !!window.__clicked"), 2000), "a control in the header row (y = 50) still gets clicks");
  await evalJs(`document.getElementById("e2e-top")?.remove(); return true`);
  await evalJs(`document.querySelector(".brand").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 1 })); document.querySelector(".brand").dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0 })); document.querySelector(".org-switch")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 1 })); return true;`);
  await sleep(300);
  const ev = (await state()).window!.events.filter((e) => e === "drag" || e === "zoom");
  check(JSON.stringify(ev) === JSON.stringify(["drag", "zoom"]), `the brand row drags and zooms the window; a control doesn't (${JSON.stringify(ev)})`);
  await cmd("resize", { w: 1280, h: 800 }); // the zoom above
  await sleep(600);
  await shoot("mac-windowed");
  await evalJs(`location.href = "/my-channel/edit?path=" + encodeURIComponent("my-channel/templates/brb.html"); return true`).catch(() => {});
  await sleep(2500);
  const ed = await evalJs<any>(`const e = document.querySelector(".editor-top"); if (!e) return null; const b = e.getBoundingClientRect(); const first = e.querySelector("button, a"); const f = first?.getBoundingClientRect(); return { top: [b.top, b.height], first: f && [f.left, f.top + f.height / 2] };`).catch(() => null);
  if (ed) {
    check(ed.top[1] === 64 && ed.first[0] >= zoom[0] + zoom[2] + 6 && Math.abs(ed.first[1] - 32) <= 2, `the editor's top bar clears the lights, centered with them (${JSON.stringify(ed)})`);
    await shoot("mac-editor-windowed");
  } else console.log("  (the editor didn't open for this scene; skipped its safe-zone check)");
  await evalJs(`location.href = "/"; return true`).catch(() => {});
  await sleep(1500);
  await cmd("fullscreen");
  check(await until(async () => (await state()).window?.fullscreen, 5000), "full screen");
  await sleep(1200);
  const fs = await evalJs<any>(`const css = getComputedStyle(document.documentElement); return { full: document.documentElement.classList.contains("shell-fullscreen"), lights: css.getPropertyValue("--shell-lights").trim(), brand: document.querySelector(".brand").getBoundingClientRect().left, drag: getComputedStyle(document.querySelector(".shell-drag")).display };`);
  check(fs.full && fs.lights === "0px" && fs.brand < 40 && fs.drag === "none", `in full screen the inset goes away (${JSON.stringify(fs)})`);
  await shoot("mac-fullscreen");
  await cmd("fullscreen");
  check(await until(async () => !(await state()).window?.fullscreen, 5000), "out of full screen");
  await sleep(1200);
  const back = await evalJs<any>(`return { full: document.documentElement.classList.contains("shell-fullscreen"), lights: getComputedStyle(document.documentElement).getPropertyValue("--shell-lights").trim() };`);
  const backLights = (await state()).window!.lights[0];
  check(!back.full && back.lights !== "0px" && Math.abs(backLights[1] + backLights[3] / 2 - 32) <= 1, `back from full screen, the lights and inset return (${JSON.stringify(back)})`);

  // ------------------------------------------------------------ phones and tablets on the Wi-Fi (MAC-23 … MAC-26)
  if (!LAN_IP) console.log("- no LAN address: skipping the Wi-Fi checks");
  else {
    const WIFI = "Let Phones and Tablets on This Wi-Fi Connect";
    const s0 = await state();
    check(s0.menu.includes(WIFI) && s0.menu.includes("Phones and Tablets…") && !s0.wifi, "the menu has the Wi-Fi setting, off by default, and Phones and Tablets…");
    check(!(await lanOpen()), `off: nothing listens on ${LAN_IP}:${PORT}`);
    await cmd("menu", { item: WIFI });
    check(await until(async () => (await state()).wifi && (await lanOpen()), 8000), `turned on from the menu: the server listens on ${LAN_IP}:${PORT}`);
    const unpaired = await fromLan("/");
    check(unpaired.status === 401 && unpaired.body.includes("Pair with ViewSwitcher"), "an unpaired device gets the pairing page");
    check((await fromLan("/api/state")).status === 401, "…and 401 for the API");
    check(await answers(), "this Mac is unchanged");
    if (shots) writeFileSync(join(shots, "pair-page.html"), unpaired.body);
    await cmd("remotes");
    check(await until(async () => !!(await state()).remotes?.code, 8000), "Phones and Tablets… shows a code");
    const r = (await state()).remotes!;
    check(r.pairUrl === `http://${LAN_IP}:${PORT}/pair?code=${r.code}`, `the QR code links to this Mac's LAN address with the code (${r.pairUrl})`);
    if (shots) {
      await sleep(500);
      await cmd("remotesSnapshot", { path: join(shots, "mac-remotes-qr.png") }).then(() => console.log("  screenshot mac-remotes-qr.png"));
    }
    const paired = await fromLan("/api/pair", { method: "POST", headers: { "content-type": "application/json", origin: `http://${LAN_IP}:${PORT}` }, body: JSON.stringify({ code: r.code, name: "E2E phone" }) });
    check(paired.status === 200 && paired.cookie.startsWith("vs_device="), "the phone pairs with the code");
    check((await fromLan("/api/state", { headers: { cookie: paired.cookie } })).status === 200, "…and is let in");
    check(await until(async () => (await state()).remotes?.devices.includes("E2E phone"), 6000), "the window lists it");
    check(await until(async () => !(await state()).remotes?.code, 4000), "the code is used up");
    if (shots) {
      await cmd("remotesSnapshot", { path: join(shots, "mac-remotes-devices.png") }).then(() => console.log("  screenshot mac-remotes-devices.png"));
      await cmd("menuPicture", { path: join(shots, "mac-menu.png") }).then(() => console.log("  screenshot mac-menu.png (drawn from the menu's items)"));
    }
    await cmd("remotesRemove", { name: "E2E phone" });
    check((await fromLan("/api/state", { headers: { cookie: paired.cookie } })).status === 401, "removed: its token stops at once");
    await cmd("menu", { item: WIFI });
    check(await until(async () => !(await state()).wifi && !(await lanOpen()), 8000), "turned off: the LAN port closes");
    check(await answers(), "…and this Mac carries on");
    check((await state()).menuEnabled.includes(WIFI), "the setting stays in the menu");
  }

  // ------------------------------------------------------------ close keeps serving; Quit stops (MAC-11)
  await cmd("close");
  await sleep(800);
  check((await state()).window?.visible === false, "closing hides the window");
  check(await answers(), "the server keeps serving with the window closed");
  await cmd("open");
  check(await until(async () => (await state()).window?.visible, 3000), "Open ViewSwitcher brings it back");
  check(await quit(app), "Quit ends the app");
  check(await until(async () => !(await answers()) && listeners().length === 0, 8000), `Quit stops the server: port ${PORT} free`);

  // ------------------------------------------------------------ attach: leave a server it didn't start
  const own = Bun.spawn(["bun", join(repo, "apps/server/src/index.ts")], { env, stdout: "ignore", stderr: "ignore" });
  check(await until(answers), "a separately started server answers");
  app = await launch();
  check(await until(async () => (await state()).server?.owned === false), "the app attaches instead of starting another");
  check(listeners().length === 1 && listeners()[0] === own.pid, "only that server listens");
  check((await state()).menu.includes("Quit ViewSwitcher (server keeps running)"), "menu says Quit leaves it running");
  check(await quit(app), "Quit ends the app");
  await sleep(800);
  check(await answers(), "after Quit, the server it didn't start is still running");

  // The attached server goes away while the app runs: the menu offers Restart Server, which starts the bundled one.
  app = await launch();
  check(await until(async () => (await state()).server?.owned === false), "attached again");
  own.kill();
  await own.exited;
  check(await until(async () => (await state()).menu.includes("Restart Server"), 8000), "the attached server stops: the menu offers Restart Server");
  check(!app.exited, "the app keeps running");
  await cmd("menu", { item: "Restart Server" });
  check(await until(answers), "Restart Server brings a server back");
  check(await until(async () => (await state()).server?.owned === true, 8000), "…the app's own, which Quit stops");
  check(await until(async () => (await state()).window?.url.startsWith(BASE) && evalJs("return !!document.querySelector('.app')"), 8000), "the window shows the switcher again");
  check(await quit(app), "Quit ends the app");
  check(await until(async () => listeners().length === 0, 8000), `port ${PORT} free`);

  // ------------------------------------------------------------ the app dies: its server follows
  app = await launch();
  check(await until(answers), "relaunched: server up");
  process.kill(app.proc.pid, "SIGKILL");
  check(await until(async () => listeners().length === 0, 8000), "when the app is killed, its server exits too (no orphan on the port)");

  // ------------------------------------------------------------ the port is someone else's
  const squatter = Bun.serve({ hostname: "127.0.0.1", port: Number(PORT), fetch: () => new Response("not us", { status: 404 }) });
  const proc = Bun.spawn([exe], { env, stdout: "ignore", stderr: "ignore" });
  started.push(proc);
  const ended = await Promise.race([proc.exited.then(() => true), sleep(15_000).then(() => false)]);
  squatter.stop(true);
  check(ended, "a port held by another app: the app says so and quits");
} finally {
  for (const pid of listeners()) if (command(pid).startsWith(sidecar) || /apps\/server\/src\/index\.ts/.test(command(pid))) process.kill(pid, "SIGTERM");
  for (const p of started) if (p.exitCode === null && p.signalCode === null) p.kill("SIGTERM");
  rmSync(library, { recursive: true, force: true });
  rmSync(control, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
