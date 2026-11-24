// ViewSwitcher.app: runs the ViewSwitcher server (the compiled sidecar in Resources), shows the
// switcher in a window, and keeps a menu-bar item with what's on air and whether OBS and the iPad
// are connected. Closing the window keeps the server running for OBS and the iPad; Quit stops it,
// unless the app attached to a server it didn't start (then that server is left alone).
import { app, BrowserWindow, dialog, Menu, type MenuItemConstructorOptions, nativeImage, Notification, shell, Tray } from "electron";
import { autoUpdater } from "electron-updater";
import { join, resolve } from "node:path";
import type { LiveState, ServerMessage } from "@viewswitcher/shared";
import { connectOrStart, type Launch, PortTakenError, type Server } from "./server";
import { trayStatus } from "./status";
import { forwardScript } from "./undo";

const PORT = process.env.PORT ?? "7420";
const BASE = `http://127.0.0.1:${PORT}`;
const logFile = join(app.getPath("logs"), "server.log");

let server: Server | null = null;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let live: LiveState | null = null;
let quitting = false;

/** The bundled sidecar in a packaged app; `bun apps/server/src/index.ts` from a checkout. */
function launch(): Launch {
  const env = { ...process.env, PORT, VIEWSWITCHER_PARENT_PID: String(process.pid) };
  if (app.isPackaged) {
    const res = process.resourcesPath;
    return {
      command: join(res, "viewswitcher-server"),
      args: [],
      env: { ...env, VIEWSWITCHER_WEB_DIST: join(res, "web"), VIEWSWITCHER_STARTER: join(res, "starter"), VIEWSWITCHER_LIBRARY_KIT: join(res, "library-kit") },
      logFile,
    };
  }
  const repo = resolve(__dirname, "../../..");
  return { command: process.env.BUN ?? "bun", args: [join(repo, "apps/server/src/index.ts")], env, logFile };
}

async function startServer() {
  try {
    server = await connectOrStart(BASE, launch());
  } catch (e) {
    const port = e instanceof PortTakenError;
    dialog.showErrorBox(port ? "Port in use" : "ViewSwitcher couldn't start", (e as Error).message + (port ? "" : `\n\nServer log: ${logFile}`));
    quitting = true;
    app.quit();
    return false;
  }
  server.onExit = (code) => {
    server = null;
    live = null;
    renderTray();
    if (!quitting) new Notification({ title: "ViewSwitcher server stopped", body: `It exited (${code}). Use Restart server in the menu bar.` }).show();
  };
  return true;
}

// ---------------------------------------------------------------- window

function openWindow() {
  if (win) {
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 760,
    minHeight: 520,
    title: "ViewSwitcher",
    backgroundColor: "#0b0c0f",
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.once("ready-to-show", () => win?.show());
  // window.open → the browser; navigating off the server's origin → the browser. Only http(s):
  // a scene is a page anyone can write, and openExternal on file: or a custom scheme would launch things.
  const toBrowser = (url: string) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    toBrowser(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (new URL(url).origin === new URL(BASE).origin) return;
    e.preventDefault();
    toBrowser(url);
  });
  win.loadURL(`${BASE}/`);
  // Closing hides the window; the server keeps serving OBS and the iPad.
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win?.hide();
  });
  win.on("closed", () => (win = null));
}

// ---------------------------------------------------------------- menu bar

const icon = (live: boolean) => {
  const img = nativeImage.createFromPath(join(__dirname, "../assets", live ? "trayLive.png" : "trayTemplate.png"));
  img.setTemplateImage(!live);
  return img;
};

async function post(path: string) {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

async function setUpObs() {
  try {
    const r = await post("/api/obs/setup");
    const missing: string[] = r.missing ?? [];
    new Notification({
      title: "OBS is set up",
      body: missing.length ? `Add ${missing.join(", ")} to the ViewSwitcher scene in OBS, then set up again.` : "The ViewSwitcher scene is ready.",
    }).show();
  } catch (e) {
    dialog.showErrorBox("Couldn't set up OBS", (e as Error).message);
  }
}

async function openLibrary() {
  try {
    const info = (await (await fetch(`${BASE}/api/info`)).json()) as { library: string };
    const err = await shell.openPath(info.library);
    if (err) throw new Error(err);
  } catch (e) {
    dialog.showErrorBox("Couldn't open the library folder", (e as Error).message);
  }
}

function renderTray() {
  if (!tray) return;
  const s = trayStatus(server ? live : null);
  tray.setImage(icon(s.live));
  tray.setTitle(s.title ? ` ${s.title}` : "");
  tray.setToolTip(s.onAir);
  const items: MenuItemConstructorOptions[] = [
    { label: s.onAir, enabled: false },
    { label: s.obs, enabled: false },
    { label: s.ipad, enabled: false },
    { type: "separator" },
    { label: "Open ViewSwitcher", click: openWindow },
    { label: "Open in Browser", click: () => shell.openExternal(`${BASE}/`), enabled: !!server },
    { label: "Open Library Folder", click: openLibrary, enabled: !!server },
    { label: s.obsReady ? "Set Up OBS Again" : "Set Up OBS…", click: setUpObs, enabled: !!live?.obs.connected },
    { type: "separator" },
    ...(server ? [] : [{ label: "Restart Server", click: restartServer } satisfies MenuItemConstructorOptions]),
    {
      label: "Open at Login",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { label: "Show Server Log", click: () => shell.openPath(logFile) },
    { type: "separator" },
    { label: server && !server.owned ? "Quit ViewSwitcher (server keeps running)" : "Quit ViewSwitcher", click: () => app.quit() },
  ];
  trayMenu = Menu.buildFromTemplate(items);
  tray.setContextMenu(trayMenu);
}
let trayMenu: Menu | null = null;

// For the end-to-end check (scripts/e2e.ts), which drives the built app: read the menu-bar item.
if (process.env.VIEWSWITCHER_E2E === "1") {
  Object.assign(globalThis, { viewswitcherE2E: { trayMenu: () => trayMenu, trayTitle: () => tray?.getTitle(), server: () => server && { owned: server.owned } } });
}

async function restartServer() {
  if (await startServer()) {
    watchState();
    win?.reload();
  }
}

// The menu bar follows the live state over the server's WebSocket, like any switcher page.
let ws: WebSocket | null = null;
function watchState() {
  ws?.close();
  const sock = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  ws = sock;
  sock.onmessage = (e) => {
    const msg = JSON.parse(String(e.data)) as ServerMessage;
    if (msg.t === "state") {
      live = msg.state;
      renderTray();
    }
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    live = null;
    renderTray();
    if (!quitting) setTimeout(() => ws === sock && watchState(), 2000);
  };
}

// ---------------------------------------------------------------- app menu

function appMenu() {
  // Undo/Redo forward to the page (see undo.ts): a plain role: "undo" would swallow the editor's ⌘Z.
  const forward = (redo: boolean) => async () => {
    const contents = BrowserWindow.getFocusedWindow()?.webContents;
    if (!contents) return;
    const where = await contents.executeJavaScript(forwardScript(redo)).catch(() => "native");
    if (where === "native") redo ? contents.redo() : contents.undo();
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "fileMenu" },
      {
        label: "Edit",
        submenu: [
          { label: "Undo", accelerator: "CmdOrCtrl+Z", click: forward(false) },
          { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", click: forward(true) },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "pasteAndMatchStyle" },
          { role: "delete" },
          { role: "selectAll" },
        ],
      },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
}

// ---------------------------------------------------------------- lifecycle

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", openWindow);
  // The switcher tells the Mac window from the iPad app by its user agent (apps/web/src/lib/client-kind.ts).
  app.userAgentFallback = `${app.userAgentFallback.replace(/\s*ViewSwitcher\/\S+/, "")} ViewSwitcher-Mac/${app.getVersion()}`;

  app.whenReady().then(async () => {
    appMenu();
    tray = new Tray(icon(false));
    renderTray();
    if (!(await startServer())) return;
    watchState();
    renderTray();
    openWindow();
    if (app.isPackaged && process.env.VIEWSWITCHER_UPDATES !== "0") {
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
      setInterval(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 6 * 60 * 60 * 1000);
    }
  });

  // The Dock icon (or opening the app again) brings the window back.
  app.on("activate", openWindow);
  // No window doesn't mean quit: the server keeps running.
  app.on("window-all-closed", () => {});

  let stopped = false;
  app.on("before-quit", (e) => {
    quitting = true;
    if (stopped || !server?.owned) return;
    e.preventDefault();
    const s = server;
    server = null;
    s.stop().finally(() => {
      stopped = true;
      app.quit();
    });
  });
}
