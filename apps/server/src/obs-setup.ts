// OBS setup: the "ViewSwitcher" scene with the ground color at the bottom, the program browser
// source on top, and the devices in between; then OBS switches to it. Run from the switcher's
// "Set up OBS" (POST /api/obs/setup) or `bun run obs:setup`. Safe to run again (e.g. after adding
// devices, to put the browser source back on top). Renames the old Daisy-era scene and sources if
// it finds them, so devices placed in them carry over.
import type { ObsSetup } from "@viewswitcher/shared";
import { OBSRequestError } from "./obs";

/** What setup needs from an obs-websocket client (OBSClient, or a fake in tests). */
export type ObsRequester = { request<T = any>(requestType: string, requestData?: object): Promise<T> };

export type SetupNames = {
  scene: string;
  programSource: string;
  groundSource: string;
  devices: string[];
};

export type SetupReport = {
  /** One line per thing done, for the CLI and the switcher. */
  log: string[];
  /** Devices to add to the scene by hand (names must match exactly). */
  missing: string[];
  /** Whether OBS was switched to the scene (never while it's streaming or recording). */
  switched: boolean;
};

export type SetupOptions = {
  /** Switch OBS's program to the scene. Pass false while OBS is live: setup must never cut the stream. */
  switchProgram?: boolean;
};

const LEGACY = { scene: "Daisy Live", program: "Daisy Program", ground: "Daisy Ground" };

// 127.0.0.1, not localhost: OBS's browser may resolve localhost to IPv6 (::1), which the server doesn't listen on.
export const programUrl = (port: number) => `http://127.0.0.1:${port}/program`;

export async function setupObs(obs: ObsRequester, names: SetupNames, port: number, { switchProgram = true }: SetupOptions = {}): Promise<SetupReport> {
  const { scene, programSource, groundSource, devices } = names;
  const url = programUrl(port);
  const log: string[] = [];

  const rename = async (request: string, from: string, to: string, key: string, newKey: string) => {
    try {
      await obs.request(request, { [key]: from, [newKey]: to });
      log.push(`Renamed "${from}" → "${to}".`);
    } catch {} // not there, or the new name is already taken
  };
  await rename("SetSceneName", LEGACY.scene, scene, "sceneName", "newSceneName");
  await rename("SetInputName", LEGACY.program, programSource, "inputName", "newInputName");
  await rename("SetInputName", LEGACY.ground, groundSource, "inputName", "newInputName");

  try {
    await obs.request("CreateScene", { sceneName: scene });
    log.push(`Created scene "${scene}".`);
  } catch (e) {
    if (!(e instanceof OBSRequestError && e.code === 601)) throw e; // 601 = already exists
  }

  const settings = { url, width: 1920, height: 1080, fps_custom: false, reroute_audio: false, shutdown: false };
  let itemId: number;
  try {
    ({ sceneItemId: itemId } = await obs.request("GetSceneItemId", { sceneName: scene, sourceName: programSource }));
    await obs.request("SetInputSettings", { inputName: programSource, inputSettings: settings });
  } catch {
    ({ sceneItemId: itemId } = await obs.request("CreateInput", {
      sceneName: scene, inputName: programSource, inputKind: "browser_source", inputSettings: settings, sceneItemEnabled: true,
    }));
    log.push(`Created browser source "${programSource}" → ${url}.`);
  }

  // The ground color every scene sits on (scenes are transparent). The server recolors it to the
  // on-air org's ground (org.json) whenever a scene from another org goes on air.
  const ground = { color: 0xff130f0e /* #0e0f13, the default ground */, width: 1920, height: 1080 };
  let groundId: number;
  try {
    ({ sceneItemId: groundId } = await obs.request("GetSceneItemId", { sceneName: scene, sourceName: groundSource }));
    // Keep its color: the server sets it to the on-air org's ground.
    await obs.request("SetInputSettings", { inputName: groundSource, inputSettings: { width: ground.width, height: ground.height } });
  } catch {
    ({ sceneItemId: groundId } = await obs.request("CreateInput", {
      sceneName: scene, inputName: groundSource, inputKind: "color_source_v3", inputSettings: ground, sceneItemEnabled: true,
    }));
    log.push(`Created color source "${groundSource}".`);
  }

  // Ground at the bottom, program browser source on top, devices in between.
  const { sceneItems } = await obs.request<{ sceneItems: { sourceName: string }[] }>("GetSceneItemList", { sceneName: scene });
  await obs.request("SetSceneItemIndex", { sceneName: scene, sceneItemId: groundId, sceneItemIndex: 0 });
  await obs.request("SetSceneItemIndex", { sceneName: scene, sceneItemId: itemId, sceneItemIndex: sceneItems.length - 1 });
  if (switchProgram) {
    await obs.request("SetCurrentProgramScene", { sceneName: scene });
    log.push(`OBS is on "${scene}" with "${programSource}" on top.`);
  } else {
    log.push(`"${scene}" is ready with "${programSource}" on top. OBS is live, so it stays on its current scene: switch to "${scene}" in OBS when you're ready.`);
  }

  const present = new Set(sceneItems.map((i) => i.sourceName));
  return { log, missing: devices.filter((d) => !present.has(d)), switched: switchProgram };
}

/** Whether OBS has what the switcher needs: the scene, both sources (the program pointing here), and the devices. */
export async function checkObsSetup(obs: ObsRequester, names: SetupNames, port: number): Promise<ObsSetup> {
  const { scenes } = await obs.request<{ scenes: { sceneName: string }[] }>("GetSceneList");
  if (!scenes.some((s) => s.sceneName === names.scene)) return { scene: false, program: false, ground: false, missingDevices: names.devices };
  const { sceneItems } = await obs.request<{ sceneItems: { sourceName: string }[] }>("GetSceneItemList", { sceneName: names.scene });
  const present = new Set(sceneItems.map((i) => i.sourceName));
  let program = present.has(names.programSource);
  if (program) {
    const { inputSettings } = await obs.request<{ inputSettings: { url?: string } }>("GetInputSettings", { inputName: names.programSource });
    program = inputSettings.url === programUrl(port);
  }
  return { scene: true, program, ground: present.has(names.groundSource), missingDevices: names.devices.filter((d) => !present.has(d)) };
}

if (import.meta.main) {
  const { config } = await import("./config");
  const { OBSClient } = await import("./obs");
  const obs = new OBSClient({ url: config.obs.url, password: config.obs.password }).start();
  try {
    await obs.ready();
    const { log, missing } = await setupObs(obs, config.obs, config.port);
    for (const line of log) console.log(line);
    if (missing.length) {
      console.log(`\nAdd these sources to "${config.obs.scene}" (names must match exactly), then run this again:`);
      for (const d of missing) console.log(`  • ${d}`);
    } else {
      console.log(`Devices found: ${config.obs.devices.join(", ")}.`);
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  } finally {
    obs.stop();
  }
}
