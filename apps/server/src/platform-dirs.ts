// Where this computer keeps per-user app data: ~/Library/Application Support on macOS, %APPDATA%
// (Roaming) on Windows, $XDG_CONFIG_HOME or ~/.config elsewhere. OBS keeps its settings in the same
// place, under obs-studio/.
import { homedir } from "node:os";
import { join } from "node:path";

export function appSupport(platform: NodeJS.Platform = process.platform, env: Record<string, string | undefined> = process.env, home = homedir()): string {
  if (platform === "darwin") return join(home, "Library/Application Support");
  if (platform === "win32") return env.APPDATA || join(home, "AppData", "Roaming");
  return env.XDG_CONFIG_HOME || join(home, ".config");
}

/** obs-websocket's settings (its password), as OBS on this computer writes them. */
export const obsWebsocketConfig = (dir = appSupport()) => join(dir, "obs-studio", "plugin_config", "obs-websocket", "config.json");

/** This computer's ViewSwitcher state root (machine-state.ts), unless VIEWSWITCHER_STATE moves it. */
export const stateRoot = (dir = appSupport()) => join(dir, "ViewSwitcher");

/** What people call the computer the server runs on, in what phones and agents are told: "Mac" or "PC". */
export const COMPUTER: "Mac" | "PC" = process.platform === "win32" ? "PC" : "Mac";
