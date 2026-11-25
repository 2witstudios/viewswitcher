// The program page's switching loop, apart from React and the DOM so it can be tested.
//
// Switching is one serialized loop, so it's deterministic however fast scenes are tapped: only one
// switch runs at a time, and when it finishes it checks for a newer request and runs again. A request
// that a newer one supersedes is dropped at once, even mid-load: the screen always ends on the latest
// one, and never waits for one nobody wants any more. A new version of the scene already on air (a
// saved edit) swaps in without the transition. The scene that goes off air is unloaded once it's
// hidden, so its audio, video and timers stop.
import type { Slot } from "@viewswitcher/shared";
import type { FrameState } from "./scene-frame";

/** `from`: the path the scene had before (renamed on air, or the stream copy it replaced): no transition for that. */
export type Job = { url: string; path: string; from?: string };
/** One of the two scene frames the page swaps between. */
export type FrameIndex = 0 | 1;

/** What the loop does to the page. Everything it awaits may take as long as it likes, or forever. */
export type ProgramEffects = {
  /** Put `url` in scene frame `i`; resolves once it has loaded (or given up). */
  load(i: FrameIndex, url: string): Promise<void>;
  /** Make sure the transition frame has the transition of the scene going on air. */
  loadTransition(): Promise<void>;
  /** Ask scene frame `i` (its bridge) for its slots and version; null when it doesn't answer. */
  ask(i: FrameIndex): Promise<FrameState | null>;
  /** Tell the server where the shown scene's slots are, so OBS places the sources there. */
  reportSlots(path: string, slots: Slot[]): Promise<unknown>;
  /** Show scene frame `i`, hiding the other. */
  show(i: FrameIndex): void;
  /** Empty scene frame `i`. */
  unload(i: FrameIndex): void;
  /** Cover the screen with the transition (true: play it), or uncover it. */
  wipe(on: boolean): void;
  /** How long the transition stays fully on screen. */
  hold(): number;
  sleep(ms: number): Promise<void>;
  /** Run `fn` after `ms`. */
  later(ms: number, fn: () => void): void;
  /** Something for the server log (the OBS browser has no devtools). */
  log(data: object): void;
};

const WIPE_IN = 170;
/** The longest a switch waits for the server to place the sources: OBS may be slow or stuck. */
const REPORT_MS = 1500;
/** When a scene didn't answer, ask again this much later (a scene that was only slow still gets its sources). */
const LATE_ASKS = [2000, 6000];

const versionOf = (url: string) => new URL(url, "http://x").searchParams.get("v");
const other = (i: FrameIndex): FrameIndex => (i === 0 ? 1 : 0);

export function createProgramLoop(fx: ProgramEffects) {
  let desired: Job | null = null;
  let shown: Job | null = null;
  let front: FrameIndex = 0;
  let running = false;
  /** The file version each scene frame shows (its data-vs-hash), from its bridge. */
  const frameVersion: [string | null, string | null] = [null, null];
  /** What each scene's bridge last said, by path, for the version it's for (the url's v=); null slots: it didn't answer. */
  const known = new Map<string, { v: string | null; slots: Slot[] | null }>();
  /** Settles when a new request arrives, so whatever the loop is waiting on can be dropped. */
  let nudge = signal();

  /** `p`, or null as soon as a newer request arrives (whichever is first). */
  const unlessNewer = <T>(p: Promise<T>, newer: Promise<void>) => Promise.race([p, newer.then(() => null)]);
  /** Empty scene frame `i`: what it showed stops. */
  const clear = (i: FrameIndex) => {
    fx.unload(i);
    frameVersion[i] = null;
  };

  async function run() {
    if (running) return;
    running = true;
    try {
      while (desired && desired.url !== shown?.url) {
        const job = desired;
        const newer = nudge.promise;
        const superseded = () => desired !== job;
        const back = other(front);
        await unlessNewer(Promise.all([fx.load(back, job.url), fx.loadTransition()]), newer);
        if (superseded()) continue; // go straight to the newer one
        const v = versionOf(job.url);
        const before = known.get(job.path);
        const seen = before && before.v === v ? before : null;
        let st = await unlessNewer(fx.ask(back), newer);
        // A scene busy right after loading (OBS's browser on a cold start) gets a second chance, the
        // first time only: a version that never answers costs one ask per switch, not two.
        if (!st && !seen && !superseded()) st = await unlessNewer(fx.ask(back), newer);
        if (superseded()) continue;
        frameVersion[back] = st?.version ?? null;
        if (st || !seen) known.set(job.path, { v, slots: st?.slots ?? null });
        // No answer (a scene's own CSP blocking the bridge, markup that swallows it, a busy cold
        // start): the slots this version last reported. Otherwise no sources, on purpose: a camera
        // left over a BRB or a full-screen scene is worse on air than a missing one.
        const slots = st?.slots ?? seen?.slots ?? [];
        if (!st) {
          fx.log({ warning: `scene didn't answer the bridge: ${seen?.slots ? "keeping its last known slots" : "showing no sources until it does"}`, path: job.path });
          askLater(job, back, v);
        }
        const wipeIt = shown !== null && shown.path !== job.path && !(job.from && job.from === shown.path);
        if (wipeIt) {
          fx.wipe(true);
          await fx.sleep(WIPE_IN);
        }
        await Promise.race([fx.reportSlots(job.path, slots).catch(() => {}), fx.sleep(REPORT_MS)]);
        const old = front;
        front = back;
        fx.show(back);
        shown = job;
        if (wipeIt) {
          await fx.sleep(fx.hold());
          fx.wipe(false);
        }
        // Off air: emptied once it's hidden, so nothing in it keeps playing.
        clear(old);
      }
      // Idle: the hidden frame is empty. A load abandoned for the scene already on screen (a tap on
      // another scene, then back) must not keep playing behind it.
      clear(other(front));
    } catch (e) {
      fx.log({ error: String(e) });
    } finally {
      running = false;
      fx.wipe(false);
      // A request may have arrived after the loop's last check.
      if (desired && desired.url !== shown?.url) void run();
    }
  }

  function askLater(job: Job, slot: FrameIndex, v: string | null) {
    let answered = false;
    for (const ms of LATE_ASKS) {
      fx.later(ms, async () => {
        if (answered || shown !== job) return;
        const late = await fx.ask(slot);
        if (!late || answered || shown !== job) return;
        answered = true;
        known.set(job.path, { v, slots: late.slots });
        frameVersion[slot] = late.version;
        fx.reportSlots(job.path, late.slots).catch(() => {});
      });
    }
  }

  return {
    /** Show `job` as soon as it can, superseding anything asked before it. */
    request(job: Job) {
      desired = job;
      const n = nudge;
      nudge = signal();
      n.fire();
      void run();
    },
    /** What's on screen, and what was asked for last. */
    shown: () => shown,
    desired: () => desired,
    /** The scene frame on screen, and the file version it shows. */
    front: () => front,
    frontVersion: () => frameVersion[front],
  };
}

function signal() {
  let fire!: () => void;
  const promise = new Promise<void>((r) => (fire = r));
  return { promise, fire };
}
