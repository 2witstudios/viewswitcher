import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const env = process.env;

/** On this Mac, read the obs-websocket password from OBS's own settings when OBS_PASSWORD isn't set. */
function localObsPassword(): string | undefined {
  try {
    const file = join(homedir(), "Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json");
    const c = JSON.parse(readFileSync(file, "utf8"));
    return c.auth_required && c.server_password ? c.server_password : undefined;
  } catch {
    return undefined;
  }
}

export const config = {
  port: Number(env.PORT ?? 7420),
  /** The content library agents edit: one folder per org, each with templates, assets, projects. */
  library: resolve(env.VIEWSWITCHER_LIBRARY ?? join(homedir(), "ViewSwitcher Library")),
  // The next three default to the repo; the Mac app's compiled server (where import.meta.dir is
  // inside the binary) passes the copies in its Resources folder.
  /** Copied into each new org: neutral templates and theme. */
  starter: resolve(env.VIEWSWITCHER_STARTER ?? join(import.meta.dir, "../starter")),
  /** Built switcher/program SPA. */
  webDist: resolve(env.VIEWSWITCHER_WEB_DIST ?? join(import.meta.dir, "../../web/dist")),
  /**
   * The built-in template packs, prebuilt by packs:export (the Mac app's Resources/packs).
   * Unset in a source run: they're built from the repo (the starter and @viewswitcher/packs' shows).
   */
  packs: env.VIEWSWITCHER_PACKS ? resolve(env.VIEWSWITCHER_PACKS) : null,
  /** What a new library starts with: the agent skill, CLAUDE.md, AGENTS.md, the MCP configs, .gitignore (see library-kit/README.md). */
  libraryKit: resolve(env.VIEWSWITCHER_LIBRARY_KIT ?? join(import.meta.dir, "../library-kit")),
  /** Extra page origins allowed to POST (comma-separated), beyond this Mac and the page's own host; see origin.ts. */
  allowedOrigins: (env.VIEWSWITCHER_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  /** Where the server listens for this Mac (HOST: an old escape hatch; everything not from this Mac is still gated, gate.ts). */
  host: env.HOST ?? "127.0.0.1",
  /** Phones and tablets on the Wi-Fi: listen on the network too, from the start. The Mac app passes its remembered setting. */
  lan: env.VIEWSWITCHER_LAN === "1",
  /** The address the Wi-Fi listener binds: every IPv4 interface, or one address (the integration test binds this Mac's LAN IP). */
  lanHost: env.VIEWSWITCHER_LAN_HOST || "0.0.0.0",
  /** A secret the Mac app makes at each launch, for the pairing endpoints only it may call (/api/remote…). Unset: they answer 404. */
  adminToken: env.VIEWSWITCHER_ADMIN_TOKEN || "",
  obs: {
    url: env.OBS_URL ?? "ws://127.0.0.1:4455",
    /**
     * Read on every connect, not once at start: the password is often turned on or changed in OBS
     * after the switcher is already running.
     */
    password: (): string | undefined => env.OBS_PASSWORD ?? localObsPassword(),
    /** The one OBS scene that holds the program browser source and the devices. */
    scene: env.OBS_SCENE ?? "ViewSwitcher",
    programSource: env.OBS_PROGRAM_SOURCE ?? "ViewSwitcher Program",
    /** Color source under everything; set to the on-air org's ground color. */
    groundSource: env.OBS_GROUND_SOURCE ?? "ViewSwitcher Ground",
    /** A scene of its own, never the program, whose one browser source renders scenes for agents to look at (preview.ts). */
    previewScene: env.OBS_PREVIEW_SCENE ?? "ViewSwitcher Preview",
    previewSource: env.OBS_PREVIEW_SOURCE ?? "ViewSwitcher Preview Render",
    /** OBS sources that scenes can place with data-slot. Hidden when a scene doesn't use them. */
    devices: (env.OBS_DEVICES ?? "Camera,Screen,iPad").split(",").map((s) => s.trim()).filter(Boolean),
  },
};
