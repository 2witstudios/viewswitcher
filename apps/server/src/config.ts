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
  /** What a new library starts with: the agent skill, CLAUDE.md, .gitignore (see library-kit/README.md). */
  libraryKit: resolve(env.VIEWSWITCHER_LIBRARY_KIT ?? join(import.meta.dir, "../library-kit")),
  obs: {
    url: env.OBS_URL ?? "ws://127.0.0.1:4455",
    password: env.OBS_PASSWORD ?? localObsPassword(),
    /** The one OBS scene that holds the program browser source and the devices. */
    scene: env.OBS_SCENE ?? "ViewSwitcher",
    programSource: env.OBS_PROGRAM_SOURCE ?? "ViewSwitcher Program",
    /** Color source under everything; set to the on-air org's ground color. */
    groundSource: env.OBS_GROUND_SOURCE ?? "ViewSwitcher Ground",
    /** OBS sources that scenes can place with data-slot. Hidden when a scene doesn't use them. */
    devices: (env.OBS_DEVICES ?? "Camera,Screen,iPad").split(",").map((s) => s.trim()).filter(Boolean),
  },
};
