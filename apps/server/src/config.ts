import { homedir } from "node:os";
import { join, resolve } from "node:path";

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 7420),
  /** The content library agents edit: templates, assets, projects. */
  library: resolve(env.DAISY_LIBRARY ?? join(homedir(), "Daisy Production Library")),
  /** Built switcher/program SPA. */
  webDist: resolve(import.meta.dir, "../../web/dist"),
  obs: {
    url: env.OBS_URL ?? "ws://127.0.0.1:4455",
    password: env.OBS_PASSWORD,
    /** The one OBS scene that holds the program browser source and the devices. */
    scene: env.OBS_SCENE ?? "Daisy Live",
    programSource: env.OBS_PROGRAM_SOURCE ?? "Daisy Program",
    /** OBS sources that scenes can place with data-slot. Hidden when a scene doesn't use them. */
    devices: (env.OBS_DEVICES ?? "Camera,Screen,iPad").split(",").map((s) => s.trim()).filter(Boolean),
  },
};
