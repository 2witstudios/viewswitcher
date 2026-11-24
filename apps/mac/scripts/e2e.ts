// End-to-end check of a built ViewSwitcher.app (MAC-6), without touching a live switcher, OBS or an iPad:
//
//   bun apps/mac/scripts/e2e.ts [path/to/ViewSwitcher.app]     (default: release/mac-arm64 or mac-universal)
//
// Runs the app on PORT (default 7433, never 7420) with OBS offline (ws://127.0.0.1:1), the USB bridge off
// and a fresh temp library, and checks: first run, the bundled server, the window and its user agent,
// the menu-bar status, close-keeps-serving, Undo forwarding, Quit stopping the server, attach mode
// (Quit leaves a server it didn't start), and that the server exits if the app is killed.
import { _electron as electron, type ElectronApplication } from "playwright-core";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PORT = process.env.E2E_PORT ?? "7433";
if (PORT === "7420") throw new Error("Never run this against 7420 (the live switcher).");
const BASE = `http://127.0.0.1:${PORT}`;
const mac = resolve(import.meta.dir, "..");
const appPath = resolve(
  process.argv[2] ?? [join(mac, "release/mac-arm64/ViewSwitcher.app"), join(mac, "release/mac-universal/ViewSwitcher.app")].find(existsSync) ?? "",
);
const exe = join(appPath, "Contents/MacOS/ViewSwitcher");
if (!existsSync(exe)) throw new Error(`No app at ${appPath}`);

let failures = 0;
const check = (ok: unknown, what: string) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const answers = async () => (await fetch(`${BASE}/api/state`, { signal: AbortSignal.timeout(800) }).then((r) => r.ok, () => false));
const until = async (f: () => Promise<boolean> | boolean, ms = 15_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await f()) return true;
    await sleep(150);
  }
  return false;
};
/** PIDs listening on the port. */
const listeners = () => {
  const p = Bun.spawnSync(["lsof", "-nP", `-iTCP:${PORT}`, "-sTCP:LISTEN", "-t"]);
  return p.stdout.toString().split("\n").filter(Boolean).map(Number);
};
const command = (pid: number) => Bun.spawnSync(["ps", "-o", "command=", "-p", String(pid)]).stdout.toString().trim();

if (listeners().length) throw new Error(`Port ${PORT} is busy; stop what's there first.`);
const library = mkdtempSync(join(tmpdir(), "vs-e2e-lib-"));
const env = { ...process.env, PORT, OBS_URL: process.env.OBS_URL ?? "ws://127.0.0.1:1", VIEWSWITCHER_USB: "0", VIEWSWITCHER_LIBRARY: library, VIEWSWITCHER_UPDATES: "0", VIEWSWITCHER_E2E: "1" } as Record<string, string>;
const launch = () => electron.launch({ executablePath: exe, env, timeout: 30_000 });
const trayLabels = (app: ElectronApplication) =>
  app.evaluate(() => ((globalThis as any).viewswitcherE2E.trayMenu()?.items ?? []).map((i: { label: string }) => i.label) as string[]);

try {
  // ------------------------------------------------------------ first run, bundled server, window
  console.log(`\n${appPath}\nport ${PORT}, library ${library}\n`);
  let app = await launch();
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  check(await until(answers), "the bundled server answers");
  const [pid] = listeners();
  check(pid && command(pid).includes(join(appPath, "Contents/Resources/viewswitcher-server")), "it is the app's own sidecar");
  check(await app.evaluate(() => (globalThis as any).viewswitcherE2E.server()?.owned), "the app owns it");
  check(existsSync(join(library, ".claude/skills/viewswitcher-scenes/SKILL.md")) && existsSync(join(library, "CLAUDE.md")), "first run: the library has the skill and CLAUDE.md");
  check(existsSync(join(library, "my-channel/org.json")), "first run: a first org");
  check(existsSync(join(library, ".git")) || !Bun.which("git"), "first run: git init (when git is available)");
  check(readFileSync(join(library, ".gitignore"), "utf8").includes(".viewswitcher/"), "first run: .gitignore");
  check(page.url().startsWith(`${BASE}/`), `the window shows the switcher (${page.url()})`);
  const ua = await page.evaluate(() => navigator.userAgent);
  check(/ViewSwitcher-Mac\//.test(ua) && !/ViewSwitcher\/\d/.test(ua) && !/ViewSwitcher-iPad/.test(ua), "user agent is ViewSwitcher-Mac, not the iPad's");
  await page.waitForSelector(".setup-card", { timeout: 10_000 }).catch(() => null);
  check(await page.locator(".setup-card h2", { hasText: "Connect OBS" }).count(), "the switcher (not the iPad connector) with the OBS setup card");
  check(!(await page.locator(".pill.link").count()), "no USB/Network pill: not taken for the iPad app");

  // ------------------------------------------------------------ menu bar
  check(await until(async () => (await trayLabels(app)).includes("OBS: not connected")), "menu bar: OBS not connected");
  const labels = await trayLabels(app);
  console.log(`  menu: ${labels.filter(Boolean).join(" | ")}`);
  for (const l of ["Nothing on air", "iPad: USB link off", "Open ViewSwitcher", "Open in Browser", "Open Library Folder", "Open at Login", "Quit ViewSwitcher"]) check(labels.includes(l), `menu bar: "${l}"`);
  const orgScene = "my-channel/templates/brb.html";
  await fetch(`${BASE}/api/onair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: orgScene, label: "Be right back" }) });
  check(await until(async () => (await trayLabels(app)).includes("On air: Be right back")), "menu bar: shows what's on air");
  check((await app.evaluate(() => (globalThis as any).viewswitcherE2E.trayTitle())).includes("Be right back"), "menu bar title: the on-air scene");
  check(!(await app.evaluate(({ app }) => app.getLoginItemSettings().openAtLogin)), "not opening at login by default");

  // ------------------------------------------------------------ Undo forwards to the page
  await page.evaluate(() => {
    (window as any).__keys = [];
    window.addEventListener("keydown", (e) => (window as any).__keys.push(`${e.metaKey ? "⌘" : ""}${e.shiftKey ? "⇧" : ""}${e.key}`));
    (document.activeElement as HTMLElement | null)?.blur();
  });
  const clickEdit = (label: string) =>
    app.evaluate(({ Menu, BrowserWindow }, label) => {
      const edit = Menu.getApplicationMenu()!.items.find((i) => i.label === "Edit")!.submenu!;
      edit.items.find((i) => i.label === label)!.click(undefined, BrowserWindow.getAllWindows()[0], undefined as any);
    }, label);
  await page.bringToFront();
  await clickEdit("Undo");
  await clickEdit("Redo");
  check(await until(async () => JSON.stringify(await page.evaluate(() => (window as any).__keys)) === JSON.stringify(["⌘z", "⌘⇧z"]), 3000), "Edit → Undo/Redo reach the page as ⌘Z/⇧⌘Z (the editor's Undo)");
  await page.evaluate(() => {
    const i = document.createElement("input");
    i.id = "e2e-field";
    document.body.append(i);
    i.focus();
    (window as any).__keys = [];
  });
  await page.keyboard.type("abc");
  await clickEdit("Undo");
  await sleep(300);
  check(
    (await page.evaluate(() => (document.getElementById("e2e-field") as HTMLInputElement).value)) !== "abc" && (await page.evaluate(() => (window as any).__keys.length)) === 3,
    "in a text field, Undo is the native text undo",
  );
  await page.evaluate(() => document.getElementById("e2e-field")?.remove());

  // ------------------------------------------------------------ close keeps serving; Quit stops
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
  await sleep(800);
  check(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((w) => !w.isVisible())), "closing hides the window");
  check(await answers(), "the server keeps serving with the window closed");
  const closed = app.waitForEvent("close");
  await app.evaluate(({ app }) => app.quit());
  await closed;
  check(await until(async () => !(await answers()) && listeners().length === 0, 8000), `Quit stops the server: port ${PORT} free`);

  // ------------------------------------------------------------ attach: leave a server it didn't start
  const own = Bun.spawn(["bun", join(mac, "../server/src/index.ts")], { env, stdout: "ignore", stderr: "ignore" });
  check(await until(answers), "a separately started server answers");
  app = await launch();
  await app.firstWindow();
  check((await app.evaluate(() => (globalThis as any).viewswitcherE2E.server()?.owned)) === false, "the app attaches instead of starting another");
  check(listeners().length === 1 && listeners()[0] === own.pid, "only that server listens");
  check((await trayLabels(app)).includes("Quit ViewSwitcher (server keeps running)"), "menu says Quit leaves it running");
  const closed2 = app.waitForEvent("close");
  await app.evaluate(({ app }) => app.quit());
  await closed2;
  await sleep(800);
  check(await answers(), "after Quit, the server it didn't start is still running");
  own.kill();
  await own.exited;
  check(await until(async () => listeners().length === 0, 5000), "(test server stopped)");

  // ------------------------------------------------------------ the app dies: its server follows
  app = await launch();
  await app.firstWindow();
  check(await until(answers), "relaunched: server up");
  const mainPid = app.process().pid!;
  process.kill(mainPid, "SIGKILL");
  check(await until(async () => listeners().length === 0, 8000), "when the app is killed, its server exits too (no orphan on the port)");
} finally {
  for (const pid of listeners()) if (/viewswitcher-server|apps\/server\/src\/index\.ts/.test(command(pid))) process.kill(pid, "SIGTERM");
  rmSync(library, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
