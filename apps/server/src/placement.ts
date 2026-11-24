// Places OBS device sources into a scene's data-slot boxes.
import { coverTransform } from "@viewswitcher/shared";
import type { Slot } from "@viewswitcher/shared";
import type { OBSClient } from "./obs";

type Options = { scene: string; devices: string[] };

/**
 * For every known device: if the scene has a slot for it, move/crop it there and show it;
 * otherwise hide it. Returns human-readable warnings (missing sources, etc.).
 */
export async function placeDevices(obs: OBSClient, slots: Slot[], { scene, devices }: Options): Promise<string[]> {
  const warnings: string[] = [];
  const video = await obs.request("GetVideoSettings");
  const canvas = { width: video.baseWidth, height: video.baseHeight };
  const names = [...new Set([...devices, ...slots.map((s) => s.source)])];

  for (const sourceName of names) {
    const slot = slots.find((s) => s.source === sourceName);
    let sceneItemId: number;
    try {
      ({ sceneItemId } = await obs.request("GetSceneItemId", { sceneName: scene, sourceName }));
    } catch {
      if (slot) warnings.push(`This scene has a "${sourceName}" slot, but OBS scene "${scene}" has no source with that name.`);
      continue;
    }
    if (!slot) {
      await obs.request("SetSceneItemEnabled", { sceneName: scene, sceneItemId, sceneItemEnabled: false });
      continue;
    }
    const { sceneItemTransform: current } = await obs.request("GetSceneItemTransform", { sceneName: scene, sceneItemId });
    if (!current.sourceWidth || !current.sourceHeight) {
      warnings.push(`OBS source "${sourceName}" has no picture yet, so it can't be fitted to its slot.`);
      continue;
    }
    const sceneItemTransform = coverTransform(slot, { width: current.sourceWidth, height: current.sourceHeight }, canvas);
    await obs.request("SetSceneItemTransform", { sceneName: scene, sceneItemId, sceneItemTransform });
    await obs.request("SetSceneItemEnabled", { sceneName: scene, sceneItemId, sceneItemEnabled: true });
  }
  return warnings;
}
