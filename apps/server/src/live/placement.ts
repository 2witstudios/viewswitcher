// Places OBS sources into the data-slot boxes of the scene the program page is showing, and recolors
// the ground for its org.
//
// Only sources ViewSwitcher manages are touched: the configured devices (OBS_DEVICES), any source a
// scene has ever placed (a Guest or Camera 2 box from the editor; remembered across restarts), and
// the current scene's slots. Anything else people put in the ViewSwitcher scene by hand (a mic, a
// music input, a watermark) is never hidden: a hidden audio input is silent on air.
//
// Only the latest report is applied, one placement at a time: overlapping placements would interleave
// their requests and could leave sources from an older scene. Every request has a deadline, so an OBS
// that stalls with its socket open costs one placement, never the rest of the show. Each placement
// reads the slotted sources' sizes in one batch and makes every change in one more; the canvas size
// and the scene's item ids are kept until OBS says its items or sources changed.
import { coverTransform, obsColor } from "@viewswitcher/shared";
import type { Slot } from "@viewswitcher/shared";
import type { BatchRequest, BatchResult } from "../obs";

export type PlacementNames = { scene: string; programSource: string; groundSource: string; /** Sources scenes may place (OBS_DEVICES). */ devices: string[] };

/** What placement needs from OBSClient. */
export type PlacementObs = {
  status: { connected: boolean };
  requestBatch(requests: BatchRequest[], opts?: { timeoutMs?: number }): Promise<BatchResult[]>;
};

export type SceneItem = { sourceName: string; sceneItemId: number };
export type Canvas = { width: number; height: number };

/**
 * After these OBS events the kept item ids or canvas may be wrong: items were added, removed or
 * renamed, or another scene collection or profile was loaded.
 */
export const PLACEMENT_EVENTS = new Set([
  "SceneItemCreated", "SceneItemRemoved", "InputNameChanged", "InputRemoved", "InputCreated",
  "SceneNameChanged", "SceneRemoved", "SceneCreated", "CurrentSceneCollectionChanged", "CurrentProfileChanged",
]);

/** How long one batch may wait for OBS. */
export const PLACEMENT_TIMEOUT_MS = 2000;

/**
 * The OBS changes for one placement, given the scene's items and the slotted sources' sizes (by item
 * id; 0×0 for a source with no picture yet). Every managed item (a device, or a source some scene
 * placed before: `placed`) that isn't in one of this scene's slots is hidden, so a guest camera from
 * the last scene doesn't stay on top of a BRB. The program, the ground and anything else are left alone.
 */
export function planPlacement(
  { items, slots, sizes, canvas, names, placed }: { items: SceneItem[]; slots: Slot[]; sizes: Map<number, Canvas>; canvas: Canvas; names: PlacementNames; placed: { has(source: string): boolean } },
): { requests: BatchRequest[]; warnings: string[] } {
  const warnings: string[] = [];
  const hide: BatchRequest[] = [];
  const show: BatchRequest[] = [];
  const sceneName = names.scene;
  const inSlots = slotted(items, slots);
  for (const source of new Set(slots.map((s) => s.source))) {
    if (!items.some((i) => i.sourceName === source)) warnings.push(`This scene has a "${source}" slot, but OBS scene "${sceneName}" has no source with that name.`);
  }
  for (const item of items) {
    if (item.sourceName === names.programSource || item.sourceName === names.groundSource) continue;
    const slot = inSlots.get(item.sceneItemId);
    if (!slot) {
      if (!names.devices.includes(item.sourceName) && !placed.has(item.sourceName)) continue; // not ours
      hide.push({ requestType: "SetSceneItemEnabled", requestData: { sceneName, sceneItemId: item.sceneItemId, sceneItemEnabled: false } });
      continue;
    }
    const size = sizes.get(item.sceneItemId);
    if (!size?.width || !size.height) {
      warnings.push(`OBS source "${item.sourceName}" has no picture yet, so it can't be fitted to its slot.`);
      continue;
    }
    const sceneItemTransform = coverTransform(slot, size, canvas);
    show.push({ requestType: "SetSceneItemTransform", requestData: { sceneName, sceneItemId: item.sceneItemId, sceneItemTransform } });
    show.push({ requestType: "SetSceneItemEnabled", requestData: { sceneName, sceneItemId: item.sceneItemId, sceneItemEnabled: true } });
  }
  return { requests: [...hide, ...show], warnings };
}

/** Which item each slot places: the first item with the slot's source name; the first slot for a source wins. */
function slotted(items: SceneItem[], slots: Slot[]): Map<number, Slot> {
  const out = new Map<number, Slot>();
  for (const s of slots) {
    const item = items.find((i) => i.sourceName === s.source);
    if (item && !out.has(item.sceneItemId)) out.set(item.sceneItemId, s);
  }
  return out;
}

export type PlacerOptions = {
  obs: PlacementObs;
  names: PlacementNames;
  /** The ground color of a scene's org, or null when it has none. Called on every placement, so keep it cheap. */
  ground: (path: string) => Promise<string | null> | string | null;
  /** After each placement that ran, with what went wrong (empty when nothing did). */
  onPlaced: (warnings: string[]) => void;
  /**
   * The sources scenes have placed before, and where to note new ones (the store keeps them across
   * restarts). A source placed once is hidden by every scene without a slot for it from then on.
   */
  placed: { has(source: string): boolean; remember(sources: string[]): void };
  timeoutMs?: number;
  log?: (line: string) => void;
};

export type Placer = ReturnType<typeof createPlacer>;

export function createPlacer({ obs, names, ground, onPlaced, placed, timeoutMs = PLACEMENT_TIMEOUT_MS, log }: PlacerOptions) {
  let latest: { path: string; slots: Slot[] } | null = null;
  let seq = 0;
  let queue = Promise.resolve();
  let scene: { canvas: Canvas; items: SceneItem[] } | null = null;
  /** The ground color OBS has now, as far as we know. */
  let groundShown: string | null = null;

  const fail = (r: BatchResult | undefined, what: string) => new Error(`${what}: ${r?.requestStatus.comment ?? `error ${r?.requestStatus.code ?? "?"}`}`);

  async function sceneItems() {
    if (scene) return scene;
    const [video, list] = await obs.requestBatch([
      { requestType: "GetVideoSettings" },
      { requestType: "GetSceneItemList", requestData: { sceneName: names.scene } },
    ], { timeoutMs });
    if (!video?.requestStatus.result) throw fail(video, "GetVideoSettings");
    if (!list?.requestStatus.result) {
      if (list?.requestStatus.code === 600) throw new Error(`OBS has no scene "${names.scene}". Press Set up OBS in the switcher.`);
      throw fail(list, "GetSceneItemList");
    }
    const items = ((list.responseData?.sceneItems ?? []) as SceneItem[]).map(({ sourceName, sceneItemId }) => ({ sourceName, sceneItemId }));
    scene = { canvas: { width: video.responseData.baseWidth, height: video.responseData.baseHeight }, items };
    return scene;
  }

  async function placeOnce(path: string, slots: Slot[]): Promise<string[]> {
    const { canvas, items } = await sceneItems();
    const ids = [...slotted(items, slots).keys()];
    const read = ids.length
      ? await obs.requestBatch(ids.map((sceneItemId) => ({ requestType: "GetSceneItemTransform", requestData: { sceneName: names.scene, sceneItemId } })), { timeoutMs })
      : [];
    const sizes = new Map<number, Canvas>();
    read.forEach((r, i) => {
      const t = r.responseData?.sceneItemTransform;
      if (r.requestStatus.result && t) sizes.set(ids[i]!, { width: Number(t.sourceWidth) || 0, height: Number(t.sourceHeight) || 0 });
      else if (r.requestStatus.code === 600) scene = null; // an item went away under us: list again next time
    });
    const slotSources = items.filter((i) => slots.some((s) => s.source === i.sourceName)).map((i) => i.sourceName);
    placed.remember(slotSources);
    const plan = planPlacement({ items, slots, sizes, canvas, names, placed });
    const color = await Promise.resolve(ground(path)).catch(() => null);
    const recolor = color && color !== groundShown ? color : null;
    const requests = recolor
      ? [{ requestType: "SetInputSettings", requestData: { inputName: names.groundSource, inputSettings: { color: obsColor(recolor) } } }, ...plan.requests]
      : plan.requests;
    const results = await obs.requestBatch(requests, { timeoutMs });
    const warnings = [...plan.warnings];
    results.forEach((r, i) => {
      if (r.requestStatus.result) {
        if (recolor && i === 0) groundShown = recolor;
        return;
      }
      if (r.requestStatus.code === 600) scene = null;
      // A missing ground source isn't worth a warning (scenes still show).
      if (!(recolor && i === 0)) warnings.push(`Couldn't place sources in OBS: ${r.requestType}: ${r.requestStatus.comment ?? `error ${r.requestStatus.code}`}`);
    });
    return [...new Set(warnings)];
  }

  function apply(): Promise<void> {
    const mine = ++seq;
    queue = queue.then(async () => {
      if (mine !== seq || !latest) return; // superseded: only the newest report is worth placing
      const { path, slots } = latest;
      if (!obs.status.connected) return onPlaced([]);
      log?.(`[place] ${path.split("/").slice(-2).join("/")}`);
      let warnings: string[];
      try {
        warnings = await placeOnce(path, slots);
      } catch (e) {
        warnings = [`Couldn't place sources in OBS: ${(e as Error).message}`];
      }
      onPlaced(warnings);
    });
    return queue;
  }

  return {
    /** Place `slots` for `path`, the scene now on screen; resolves once it (or a newer report) is placed. */
    report(path: string, slots: Slot[]): Promise<void> {
      latest = { path, slots };
      return apply();
    },
    /** Place the last report again (OBS reconnected). */
    replay(): Promise<void> {
      return latest ? apply() : Promise.resolve();
    },
    /** OBS (re)connected: nothing kept from before is trusted. */
    reset() {
      scene = null;
      groundShown = null;
    },
    /** An OBS event: forget the kept items and canvas when it may have changed them. */
    onEvent(eventType: string) {
      if (PLACEMENT_EVENTS.has(eventType)) scene = null;
    },
  };
}
