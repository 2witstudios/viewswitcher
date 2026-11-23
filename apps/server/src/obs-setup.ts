// One-time OBS setup: `bun run obs:setup`.
// Creates the "Daisy Live" scene with the program browser source on top, and switches OBS to it.
// Safe to run again (e.g. after adding devices, to put the browser source back on top).
import { config } from "./config";
import { OBSClient, OBSRequestError } from "./obs";

const obs = new OBSClient({ url: config.obs.url, password: config.obs.password }).start();
// 127.0.0.1, not localhost: OBS's browser may resolve localhost to IPv6 (::1), which the server doesn't listen on.
const programUrl = `http://127.0.0.1:${config.port}/program`;
const { scene, programSource, devices } = config.obs;

try {
  await obs.ready();

  try {
    await obs.request("CreateScene", { sceneName: scene });
    console.log(`Created scene "${scene}".`);
  } catch (e) {
    if (!(e instanceof OBSRequestError && e.code === 601)) throw e; // 601 = already exists
    console.log(`Scene "${scene}" already exists.`);
  }

  const settings = { url: programUrl, width: 1920, height: 1080, fps_custom: false, reroute_audio: false, shutdown: false };
  let itemId: number;
  try {
    ({ sceneItemId: itemId } = await obs.request("GetSceneItemId", { sceneName: scene, sourceName: programSource }));
    await obs.request("SetInputSettings", { inputName: programSource, inputSettings: settings });
    console.log(`Updated browser source "${programSource}" → ${programUrl}`);
  } catch {
    ({ sceneItemId: itemId } = await obs.request("CreateInput", {
      sceneName: scene, inputName: programSource, inputKind: "browser_source", inputSettings: settings, sceneItemEnabled: true,
    }));
    console.log(`Created browser source "${programSource}" → ${programUrl}`);
  }

  // The ground color every scene sits on (scenes are transparent; see theme.css --ground).
  const groundName = "Daisy Ground";
  const ground = { color: 0xff12180d /* #0d1812 as OBS ABGR */, width: 1920, height: 1080 };
  let groundId: number;
  try {
    ({ sceneItemId: groundId } = await obs.request("GetSceneItemId", { sceneName: scene, sourceName: groundName }));
    await obs.request("SetInputSettings", { inputName: groundName, inputSettings: ground });
  } catch {
    ({ sceneItemId: groundId } = await obs.request("CreateInput", {
      sceneName: scene, inputName: groundName, inputKind: "color_source_v3", inputSettings: ground, sceneItemEnabled: true,
    }));
    console.log(`Created color source "${groundName}".`);
  }

  // Ground at the bottom, program browser source on top, devices in between.
  const { sceneItems } = await obs.request("GetSceneItemList", { sceneName: scene });
  await obs.request("SetSceneItemIndex", { sceneName: scene, sceneItemId: groundId, sceneItemIndex: 0 });
  await obs.request("SetSceneItemIndex", { sceneName: scene, sceneItemId: itemId, sceneItemIndex: sceneItems.length - 1 });
  await obs.request("SetCurrentProgramScene", { sceneName: scene });

  const present = new Set(sceneItems.map((i: { sourceName: string }) => i.sourceName));
  const missing = devices.filter((d) => !present.has(d));
  console.log(`\nOBS is on "${scene}" with "${programSource}" on top.`);
  if (missing.length) {
    console.log(`Add these sources to "${scene}" (names must match exactly), then run this again:`);
    for (const d of missing) console.log(`  • ${d}`);
  } else {
    console.log(`Devices found: ${devices.join(", ")}.`);
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  obs.stop();
}
