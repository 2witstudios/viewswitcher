// The Windows app end to end (apps/apple/scripts/e2e.ts's Windows twin): drives the built app
// (apps/windows/build/app, from `bun run win:build --app`) on port 7435 (E2E_PORT) with OBS offline,
// updates off, and a temp library, state and control folder (E2E.cs), never the person's own.
//   bun run win:e2e                 everything but Wi-Fi
//   E2E_LAN=1 bun run win:e2e       also over the Wi-Fi: Windows Firewall asks about the server the first time
// Windows never takes the foreground from the person at the machine: the app shows its windows unactivated.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { listZip, readZipEntrySync } from "../../../packages/packs/src/zip";

const REPO = resolve(import.meta.dir, "../../..");
const APP = join(REPO, "apps/windows/build/app/ViewSwitcher.exe");
const SERVER = join(REPO, "apps/windows/build/app/Helpers/viewswitcher-server.exe");
const PORT = process.env.E2E_PORT ?? "7435";
if (PORT === "7420") throw new Error("never on 7420: that's the person's own ViewSwitcher");
const BASE = `http://127.0.0.1:${PORT}`;
if (!existsSync(APP)) throw new Error(`no ${APP}: run bun run win:build --app first`);

const root = mkdtempSync(join(tmpdir(), "vs-win-e2e-"));
const library = join(root, "library");
const control = join(root, "control");
mkdirSync(control);
const env: Record<string, string> = {
  ...(process.env as Record<string, string>),
  PORT,
  OBS_URL: "ws://127.0.0.1:1",
  VIEWSWITCHER_LIBRARY: library,
  VIEWSWITCHER_STATE: join(root, "state"),
  VIEWSWITCHER_E2E_DIR: control,
  VIEWSWITCHER_UPDATES: "0",
  VIEWSWITCHER_USB: "0",
};

let failures = 0;
const check = (ok: unknown, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => Bun.sleep(ms);
async function until(test: () => boolean | Promise<boolean>, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await Promise.resolve().then(test).catch(() => false)) return true;
    await sleep(100);
  }
  return false;
}

type AppState = { pid: number; state: string; attempt: number; error: string | null; serverPid: number | null; owned: boolean | null; menu: { title: string; enabled: boolean; checked: boolean }[]; window: boolean; userAgent: string | null; remotes: boolean; wifi: boolean; opened: string[]; alerts: string[]; notices: string[] };
const state = (): AppState => JSON.parse(readFileSync(join(control, "app.json"), "utf8"));
let n = 0;
async function cmd(c: string) {
  const id = ++n;
  writeFileSync(join(control, `cmd-${id}.json`), JSON.stringify({ cmd: c }));
  const res = join(control, `res-${id}.json`);
  if (!(await until(() => existsSync(res), 15_000))) throw new Error(`no answer to ${c}`);
  const r = JSON.parse(readFileSync(res, "utf8"));
  if (!r.ok) throw new Error(`${c}: ${r.error}`);
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const answers = async () => fetch(`${BASE}/api/state`).then((r) => r.ok, () => false);
let app: ReturnType<typeof Bun.spawn> | null = null;
const launch = () => (app = Bun.spawn([APP], { env, stdout: "ignore", stderr: "ignore" }));
const kill = (pid: number) => Bun.spawnSync(["taskkill", "/F", "/PID", String(pid)], { stdout: "ignore", stderr: "ignore" });

try {
  // ------------------------------------------------------------ first run: the bundled server, owned
  launch();
  check(await until(() => existsSync(join(control, "app.json")) && state().state === "Owned"), "the app starts its bundled server and owns it");
  const first = state();
  const info = await fetch(`${BASE}/api/info`).then((r) => r.json());
  check(info.sidecar === true && info.parentPid === first.pid && info.pid === first.serverPid, "the server knows the app started it (parentPid), for orphan checks");
  check(info.library === library && existsSync(join(library, "CLAUDE.md")) && existsSync(join(library, "my-channel/org.json")), "first run: a library with the agent kit and a first show");
  check(existsSync(join(control, "server.log")) && readFileSync(join(control, "server.log"), "utf8").includes("[viewswitcher]"), "the server logs into this run's own folder");
  check(String(info.stdio).toLowerCase() === `${SERVER} --mcp-stdio --port ${PORT}`.toLowerCase() || String(info.stdio).toLowerCase().startsWith(`"${SERVER}"`.toLowerCase()), `Edit with AI's stdio command is the bundled server (${info.stdio})`);
  check(/^Set-Location '.*'; claude$/.test(info.claudeCode), "Edit with AI's Claude Code command is PowerShell's");
  const state0 = await fetch(`${BASE}/api/state`).then((r) => r.json());
  check(state0.host === "windows", "the live state says the server runs on Windows (the switcher says PC)");

  // ------------------------------------------------------------ the window and the tray
  check(await until(() => state().window && !!state().userAgent), "the switcher window opens");
  check(/ViewSwitcher-Windows\/\d+\.\d+\.\d+/.test(state().userAgent ?? ""), `the window identifies as ViewSwitcher-Windows (${state().userAgent})`);
  await cmd("capture-switcher");
  check(existsSync(join(control, "switcher.png")), "the switcher draws (switcher.png)");
  const titles = state().menu.map((m) => m.title);
  check(await until(() => state().menu[0]?.title === "Nothing on air"), "the tray follows the live state (Nothing on air)");
  check(titles.includes("Let Phones and Tablets on This Wi-Fi Connect") && titles.includes("Quit ViewSwitcher") && !titles.some((t) => /USB/.test(t)), "the tray menu: Wi-Fi, Quit, and no USB line on Windows");
  check(state().menu.find((m) => m.title.startsWith("Set Up OBS"))?.enabled === false, "Set Up OBS waits for OBS");

  // ------------------------------------------------------------ agents
  const rpc = (id: number, method: string, params: Record<string, unknown> = {}) => ({ jsonrpc: "2.0", id, method, params });
  const init = rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "vs-e2e", version: "1" } });
  const mcpInit = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(init) }).then((r) => r.json(), () => null);
  check(mcpInit?.result?.serverInfo, "the bundled server answers /mcp initialize");
  const relay = Bun.spawn([SERVER, "--mcp-stdio", "--port", PORT], { env: { ...env, PORT: "1", VIEWSWITCHER_E2E_DIR: "" }, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
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
        const line = relayed.slice(0, relayed.lastIndexOf("\n") + 1).split("\n").find((l) => l.includes('"id":2'));
        if (line) return JSON.parse(line);
      }
    })(),
    sleep(10_000).then(() => null),
  ]);
  relay.kill();
  check((listed?.result?.tools?.length ?? 0) >= 20, `viewswitcher-server.exe --mcp-stdio relays tools/list (${listed?.result?.tools?.length} tools)`);
  const mcpb = new Uint8Array(await (await fetch(`${BASE}/api/agent/viewswitcher.mcpb`)).arrayBuffer());
  const entries = listZip(mcpb);
  const manifest = JSON.parse(new TextDecoder().decode(readZipEntrySync(mcpb, entries.find((e) => e.name === "manifest.json")!)));
  check(manifest.compatibility.platforms[0] === "win32" && manifest.server.entry_point === "server/viewswitcher.cmd" && entries.some((e) => e.name === "server/viewswitcher.cmd"), "the Claude Desktop extension is made for Windows, with a .cmd launcher");
  check(manifest.server.mcp_config.command.toLowerCase() === SERVER.toLowerCase(), "its command is this app's bundled server");
  const evil = await fetch(`${BASE}/api/onair`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "text/plain" }, body: "{}" });
  check(evil.status === 403, "a cross-site POST is refused with 403");

  // ------------------------------------------------------------ Phones and Tablets
  await cmd("open-remotes");
  check(await until(() => state().remotes), "Phones and Tablets opens");
  await sleep(1500);
  await cmd("capture-remotes");
  check(existsSync(join(control, "remotes.png")), "Phones and Tablets draws (remotes.png)");
  if (process.env.E2E_LAN === "1") {
    const lan = Object.entries(networkInterfaces())
      .filter(([name]) => !/tailscale|vethernet|vmware|virtualbox|loopback/i.test(name))
      .flatMap(([, l]) => l ?? [])
      .find((i) => i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254."))?.address;
    await cmd("toggle-wifi");
    check(await until(() => state().wifi && state().menu.find((m) => m.title.startsWith("Let Phones"))?.checked === true), "Wi-Fi on: remembered and checked in the tray");
    if (lan) {
      const phone = `http://${lan}:${PORT}`;
      check(await until(async () => (await fetch(`${phone}/api/state`)).status === 401), `a phone at ${phone} reaches the server, which asks it to pair first`);
      await cmd("pair-code");
      const code = readFileSync(join(control, "code.txt"), "utf8");
      const paired = await fetch(`${phone}/api/pair`, { method: "POST", headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }, body: JSON.stringify({ code, name: "Test iPhone" }) });
      const cookie = paired.headers.get("set-cookie")?.split(";")[0] ?? "";
      check(paired.status === 200 && cookie, "the phone pairs with the code Phones and Tablets shows");
      check((await fetch(`${phone}/api/state`, { headers: { cookie } })).status === 200, "and then uses the switcher over the Wi-Fi");
    } else check(false, "no Wi-Fi or Ethernet address on this PC");
    await cmd("toggle-wifi");
    check(await until(() => !state().wifi), "Wi-Fi off again");
  } else console.log("skip Wi-Fi (E2E_LAN=1 runs it; Windows Firewall asks about the server the first time)");

  // ------------------------------------------------------------ the server stopping by itself
  const before = state().serverPid!;
  kill(before);
  check(await until(() => state().state === "Owned" && state().serverPid !== before && state().serverPid !== null), "a server that dies is restarted at once");
  check(state().notices.some((m) => m.startsWith("ViewSwitcher server stopped")) && state().notices.some((m) => m.startsWith("ViewSwitcher server restarted")), "with a notification each way");
  check(await answers(), "and answers again");

  // ------------------------------------------------------------ closing the window keeps serving; Quit frees the port
  await cmd("close-window");
  check(await until(() => !state().window), "closing the window hides it");
  check(await answers(), "the server keeps serving with the window closed");
  const serverPid = state().serverPid!;
  await cmd("quit");
  check(await until(async () => !(await answers()), 10_000), "Quit stops the server it started");
  check(await until(() => !alive(serverPid), 5000), "the server process is gone (stdin closed)");
  check(await until(() => !alive(first.pid), 10_000), "and the app ends");

  // ------------------------------------------------------------ ended from Task Manager: the server goes with it
  rmSync(join(control, "app.json"), { force: true });
  n = 0;
  for (const f of new Bun.Glob("{cmd,res}-*.json").scanSync({ cwd: control })) rmSync(join(control, f));
  launch();
  check(await until(() => existsSync(join(control, "app.json")) && state().state === "Owned"), "the app starts again");
  const orphanPid = state().serverPid!;
  kill(state().pid);
  check(await until(() => !alive(orphanPid), 8000), "an app ended from Task Manager takes its server with it (Job Object)");
  check(await until(async () => !(await answers()), 5000), "and the port is free");

  // ------------------------------------------------------------ a server someone else started: attached, never stopped
  // As `bun run dev` would be: started by hand, with the app's resources but no app.
  const res = join(REPO, "apps/windows/build/app/Resources");
  const other = Bun.spawn([SERVER], { env: { ...env, VIEWSWITCHER_E2E_DIR: "", VIEWSWITCHER_PARENT_PID: "", VIEWSWITCHER_WEB_DIST: join(res, "web"), VIEWSWITCHER_STARTER: join(res, "starter"), VIEWSWITCHER_LIBRARY_KIT: join(res, "library-kit"), VIEWSWITCHER_PACKS: join(res, "packs") }, stdout: "ignore", stderr: "ignore" });
  check(await until(answers), "another server runs on the port");
  rmSync(join(control, "app.json"), { force: true });
  n = 0;
  for (const f of new Bun.Glob("{cmd,res}-*.json").scanSync({ cwd: control })) rmSync(join(control, f));
  launch();
  check(await until(() => existsSync(join(control, "app.json")) && state().state === "Attached"), "the app attaches to a server it didn't start");
  check(state().menu.at(-1)?.title === "Quit ViewSwitcher (server keeps running)", "and says Quit leaves it running");
  check(state().menu.find((m) => m.title === "Phones and Tablets…")?.enabled === false, "pairing needs the app's own server");
  const attachedApp = state().pid;
  await cmd("quit");
  check(await until(() => !alive(attachedApp), 10_000), "Quit ends the app");
  check(await answers(), "and the other server keeps running");
  other.kill();
  await until(async () => !(await answers()), 5000);

  // ------------------------------------------------------------ the port held by something else
  const squatter = Bun.serve({ hostname: "127.0.0.1", port: Number(PORT), fetch: () => new Response("<html>not ViewSwitcher</html>", { headers: { "content-type": "text/html" } }) });
  rmSync(join(control, "app.json"), { force: true });
  n = 0;
  launch();
  // It fails, says why, and quits: the last report may already be Quitting.
  check(await until(() => existsSync(join(control, "app.json")) && ["Failed", "Quitting"].includes(state().state) && state().serverPid === null), "with the port taken, the app doesn't start a server");
  check(state().alerts.some((a) => a.startsWith("Port in use")), "and says the port is in use");
  check(await until(() => !alive(state().pid), 10_000), "and ends");
  squatter.stop(true);
} catch (e) {
  check(false, (e as Error).message);
} finally {
  if (app && alive(app.pid)) kill(app.pid);
  await sleep(500);
  // The windows' pictures stay in apps/windows/build/e2e for a look.
  const shots = join(REPO, "apps/windows/build/e2e");
  mkdirSync(shots, { recursive: true });
  for (const p of ["switcher.png", "remotes.png"]) if (existsSync(join(control, p))) copyFileSync(join(control, p), join(shots, p));
  if (failures === 0) rmSync(root, { recursive: true, force: true });
  else console.log(`kept ${root} for a look`);
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
