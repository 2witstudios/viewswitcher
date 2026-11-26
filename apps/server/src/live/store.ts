// The switcher's live state: what's on air, OBS, the USB link, the agent, and the warnings. It is
// published to every client when it changes (and only then), and the on-air record is saved in
// .viewswitcher/state.json so a restart comes back to the same scene.
//
// Changes to what's on air (a person's tap, an agent's go_on_air, a rename, the on-air file going
// away) run one at a time, in the order they were asked: two requests close together always end on
// the one asked last, and state.json is only ever written by one of them at a time (and atomically).
import { orgOf, projectViewOf } from "@viewswitcher/shared";
import type { LiveState, OnAir, ServerMessage } from "@viewswitcher/shared";
import { writeAtomic } from "../atomic";
import * as lib from "../library";
import { isFile } from "../library";
import { onAirFor, type OnAirRequest, renamedOnAir } from "../library-actions";
import { inside } from "../paths";
import type { RenameResult } from "../scene-edit";
import type { Log } from "../log";

export type LiveStoreOptions = {
  /** The library root. */
  root: string;
  /** Where the on-air record is kept (state.json). */
  file: string;
  /** Sends a message to every client (the live socket's hub); called when the state changes. */
  publish: (msg: ServerMessage) => void;
  /** What the rest of the state starts as. */
  initial: Omit<LiveState, "onAir" | "warnings">;
  log?: Log;
};

export const missingWarning = (on: OnAir) =>
  `"${on.label}" was deleted while on air. Put another view on air: until then the program keeps showing it (only the ground if the program page reloads).`;

export class LiveStore {
  readonly state: LiveState;
  private placementWarnings: string[] = [];
  /** The state as last published, serialized. */
  private published = "";
  private onAirWarnings: string[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  /** Every OBS source a scene has placed in a slot, ever: placement hides these when a scene has no slot for them. */
  private placed: Set<string>;
  /** Each org's ground color, read once from org.json and forgotten when that file changes. */
  private grounds = new Map<string, Promise<string | null>>();

  private constructor(private opts: LiveStoreOptions, onAir: OnAir | null, placed: string[]) {
    this.state = { ...opts.initial, onAir, warnings: [] };
    this.placed = new Set(placed);
  }

  /** The store as it was saved: the scene that was on air, with its transition looked up again. */
  static async open(opts: LiveStoreOptions): Promise<LiveStore> {
    const file = await Bun.file(opts.file).json().catch(() => null);
    const saved = (file?.onAir ?? null) as OnAir | null;
    const placed = Array.isArray(file?.placed) ? file.placed.filter((p: unknown): p is string => typeof p === "string") : [];
    const store = new LiveStore(opts, saved && typeof saved.path === "string" ? saved : null, placed);
    const on = store.state.onAir;
    if (on) {
      on.transition = await lib.resolveTransition(opts.root, on.path).catch(() => null);
      delete on.missing;
      // Gone while the server was off: the same as while it runs (the project's scene, or a warning).
      if (!(await isFile(store.abs(on.path)))) await store.serial(() => store.removed(on));
    }
    return store;
  }

  /** Publish the state as it is now, if it differs from what was last published. */
  publish() {
    // Every client re-reads the state it's sent: a report that changed nothing (OBS repeating its
    // status, a placement with the same warnings, an agent seen again) isn't worth sending.
    const text = JSON.stringify(this.state);
    if (text === this.published) return;
    this.published = text;
    this.opts.publish({ t: "state", state: this.state });
  }

  /** Change the parts of the state other modules own (OBS, its setup, USB, the agent) and publish. */
  update(patch: Partial<Pick<LiveState, "obs" | "obsSetup" | "usb" | "agent">>) {
    Object.assign(this.state, patch);
    this.publish();
  }

  /** What the last placement in OBS reported (replacing the previous placement's warnings). */
  setPlacementWarnings(warnings: string[]) {
    // Placement reports come every 33 ms while a box is dragged; publish() sends only a change.
    this.placementWarnings = warnings;
    this.composeWarnings();
    this.publish();
  }

  /**
   * Put a scene on air: for the switcher (POST /api/onair) and for agents (go_on_air). `check` is the
   * agent guard: it runs once the scene is looked up, and again right after the record is saved; if
   * it refuses then, the saved record goes back to the scene on air.
   */
  goOnAir(b: OnAirRequest, check?: () => void): Promise<LiveState> {
    return this.serial(() => this.commit(b, check));
  }

  /** A scene was renamed (switcher or agent): if it's the one on air, the on-air record follows it. */
  renamed(from: string, name: string, r: Extract<RenameResult, { ok: true }>): Promise<void> {
    return this.serial(async () => {
      const on = this.state.onAir;
      if (!on || on.path !== from) return;
      this.state.onAir = renamedOnAir(on, from, name, r);
      // The file has moved: everyone hears about it even if saving the state fails (the next change saves it).
      this.publish();
      await this.persistOrLog(this.state.onAir);
    });
  }

  /**
   * Library files changed (the watcher, debounced). The scene on air may have lost its file (Revert
   * on a stream's copy, Finder, a removed set) or got it back, and its transition may have changed.
   * Run before clients hear about the change, so none reloads the on-air scene into a 404.
   */
  filesChanged(paths: string[]): Promise<void> {
    if (paths.some((p) => p.endsWith("org.json") || !p.includes("/"))) this.grounds.clear();
    return this.serial(async () => {
      const on = this.state.onAir;
      if (!on) return;
      const there = await isFile(this.abs(on.path));
      if (!there && !on.missing) return this.removed(on);
      if (there && on.missing) {
        delete on.missing;
        this.onAirWarnings = [];
        this.composeWarnings();
        this.publish();
      }
      if (paths.some((p) => p.endsWith("transition.html"))) {
        const transition = await lib.resolveTransition(this.opts.root, on.path).catch(() => null);
        // Only for the scene it was worked out for: another may have gone on air meanwhile.
        if (this.state.onAir === on && transition !== on.transition) {
          on.transition = transition;
          this.publish();
        }
      }
    });
  }

  /** The sources placed before, for placement: `has` asks, `remember` notes new ones and saves them. */
  readonly placedSources = {
    has: (source: string) => this.placed.has(source),
    remember: (sources: string[]) => {
      const added = sources.filter((s) => !this.placed.has(s));
      if (!added.length) return;
      for (const s of added) this.placed.add(s); // seen by the very next placement, before it's saved
      void this.serial(() => this.persistOrLog(this.state.onAir));
    },
  };

  /** The ground color of the org `path` belongs to, from its org.json (cached). */
  groundFor(path: string): Promise<string | null> {
    const org = orgOf(path);
    let g = this.grounds.get(org);
    if (!g) {
      g = lib.readOrg(this.opts.root, org).then((o) => o.ground ?? null, () => null);
      this.grounds.set(org, g);
    }
    return g;
  }

  // ---------------------------------------------------------------- inside the queue

  private async commit(b: OnAirRequest, check?: () => void, extra: Partial<OnAir> = {}): Promise<LiveState> {
    this.opts.log?.(`[onair] ${String(b.path).split("/").slice(-2).join("/")}`);
    const next = { ...(await onAirFor(this.opts.root, b)), ...extra };
    check?.(); // an agent's go_on_air: the on-air setting against the state now, after the await
    // Saved first: if saving fails, the scene on air stays as it was (nothing else can pick up a new
    // scene that wasn't saved).
    await this.persist(next);
    try {
      check?.();
    } catch (e) {
      await this.persistOrLog(this.state.onAir);
      throw e;
    }
    this.state.onAir = next;
    this.onAirWarnings = [];
    this.placementWarnings = [];
    this.composeWarnings();
    this.publish();
    return this.state;
  }

  /** The on-air file is gone: the project's scene it overrode, else keep showing it with a warning. */
  private async removed(on: OnAir) {
    const fallback = projectViewOf(on.path);
    if (fallback && (await isFile(this.abs(fallback)))) {
      try {
        // The same view, back to the project's version: swapped in place, like a rename, not a transition.
        await this.commit({ path: fallback, label: on.label, projectId: on.projectId, streamId: on.streamId }, undefined, { renamedFrom: on.path });
        return;
      } catch (e) {
        console.error("[state] couldn't put the project's scene back on air:", (e as Error).message);
      }
    }
    this.markMissing(on);
    this.publish();
  }

  private markMissing(on: OnAir) {
    on.missing = true;
    this.onAirWarnings = [missingWarning(on)];
    this.composeWarnings();
  }

  private composeWarnings() {
    this.state.warnings = [...this.onAirWarnings, ...this.placementWarnings];
  }

  /** state.json: the on-air record and the sources ever placed. */
  private persist(onAir: OnAir | null) {
    const { missing: _, ...saved } = onAir ?? ({} as OnAir);
    return writeAtomic(this.opts.file, JSON.stringify({ onAir: onAir ? saved : null, placed: [...this.placed].sort() }, null, 2), { plainParent: true });
  }

  /** For a save nothing waits on: a failure is logged, and the next change saves again. */
  private persistOrLog(onAir: OnAir | null) {
    return this.persist(onAir).catch((e) => console.error("[state] couldn't save:", (e as Error).message));
  }

  private abs(path: string) {
    try {
      return inside(this.opts.root, path);
    } catch {
      return "";
    }
  }

  /** Runs `fn` after every change asked before it; a failure is its caller's, never the next one's. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => {});
    return run;
  }
}
