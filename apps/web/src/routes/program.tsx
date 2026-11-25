// The OBS browser source (1920×1080). Shows the on-air scene and tells the server where its device slots are.
//
// Switching is a single serialized loop, so it's deterministic however fast scenes are tapped:
// only one transition runs at a time, and when it finishes it checks for a newer request and runs again.
// Requests that are superseded while loading are dropped; the screen always ends on the latest one.
// A new version of the scene already on air (a saved edit) swaps in without the transition, and the
// scene editor's live previews apply to the on-air frame in place.
//
// Scenes run in sandboxed frames with an opaque origin (EDIT-26): this page can't reach into them, and
// their scripts can't reach the switcher. Where the slots are, the transition's hold and live previews
// go through the bridge the server adds to each scene (apps/server/src/scene-bridge.ts).
import { editKind } from "@viewswitcher/shared";
import type { Slot } from "@viewswitcher/shared";
import { createFileRoute } from "@tanstack/react-router";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { freshUrl, shouldBackstop } from "../lib/backstop";
import { cleanSlots, type FrameState, frameState, SCENE_SANDBOX } from "../lib/scene-frame";
import { onScenePreview, sceneUrl, useLive } from "../lib/live";

// Report errors to the server log: the OBS browser has no devtools by default.
const report = (data: object) => fetch("/api/log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ where: "program", ...data }) }).catch(() => {});
if (typeof window !== "undefined") {
  addEventListener("error", (e) => report({ error: e.message, at: `${e.filename}:${e.lineno}` }));
  addEventListener("unhandledrejection", (e) => report({ error: String(e.reason) }));
}

const WIPE_IN = 170;
const WIPE_HOLD = 90; // a transition page can ask for longer: <meta name="viewswitcher:hold" content="600">
const LOAD_TIMEOUT = 6000;
/** A live preview that's neither saved nor refreshed this long (the editor went away) is dropped: the frame reloads. */
const PREVIEW_BACKSTOP_MS = 5000;

// Slot reports are numbered per page, so the server applies them in the order they were made (live
// drag reports go out every 33 ms and can swap on the way).
const slotPage = Math.random().toString(36).slice(2);
let slotSeq = 0;
const slotOrder = () => ({ page: slotPage, seq: ++slotSeq });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `from`: the path this scene had before it was renamed on air (EDIT-19): no transition for that. */
type Job = { url: string; path: string; from?: string };

/** How long to wait for a scene's bridge to answer (a scene without one reports no slots). */
const ASK_MS = 1000;
let asked = 0;
const waiting = new Map<number, { win: Window; done: (s: FrameState | null) => void }>();
if (typeof window !== "undefined") {
  addEventListener("message", (e) => {
    const s = frameState(e.data);
    const w = s && waiting.get(s.id);
    // Only the frame that was asked can answer.
    if (!s || !w || e.source !== w.win) return;
    waiting.delete(s.id);
    w.done(s);
  });
}
/** Ask a scene frame for its slots, version and hold. */
function ask(frame: HTMLIFrameElement | null): Promise<FrameState | null> {
  const win = frame?.contentWindow;
  if (!win) return Promise.resolve(null);
  const id = ++asked;
  return new Promise((resolve) => {
    const done = (s: FrameState | null) => {
      waiting.delete(id);
      resolve(s);
    };
    waiting.set(id, { win, done });
    setTimeout(() => done(null), ASK_MS);
    win.postMessage({ viewswitcher: "frame:hello", id }, "*");
  });
}

export const Route = createFileRoute("/program")({
  component: function Program() {
    const { state, versions } = useLive();
    const onAir = state?.onAir ?? null;
    // Scenes load with data-vs element ids (?edit) so the editor's live previews can find their element.
    const target = onAir ? sceneUrl(onAir.path, versions, false, true, true) : null;

    const [frames, setFrames] = useState<[string | null, string | null]>([null, null]);
    const [front, setFront] = useState(0);
    const [wipe, setWipe] = useState(false);
    const [transitionSrc, setTransitionSrc] = useState<string | null>(null);
    const transitionRef = useRef<HTMLIFrameElement>(null);
    const transitionLoaded = useRef<string | null>(null); // transition URL in the frame (without &load)
    // The transition of the scene going on air (read by the loop, so an edit applies from the next switch).
    const wantedTransition = useRef<string | null>(null);
    wantedTransition.current = onAir?.transition ? sceneUrl(onAir.transition, versions, false, false, true) : null;
    const [scale, setScale] = useState(1);
    const refs = [useRef<HTMLIFrameElement>(null), useRef<HTMLIFrameElement>(null)];

    const desired = useRef<Job | null>(null); // latest request
    const shown = useRef<Job | null>(null); // what's on screen
    const frontRef = useRef(0);
    const running = useRef(false);
    const seq = useRef(0);
    const waiters = useRef<Map<string, () => void>>(new Map()); // frame src → resolve on load
    const backstop = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    /** The file version each scene frame shows (its data-vs-hash), from its bridge. */
    const frameVersion = useRef<[string | null, string | null]>([null, null]);
    const transitionHold = useRef<number>(WIPE_HOLD);
    /** The slots each scene last reported, for a scene that doesn't answer next time. */
    const knownSlots = useRef(new Map<string, Slot[]>());

    useEffect(() => {
      const fit = () => setScale(Math.min(innerWidth / 1920, innerHeight / 1080));
      fit();
      addEventListener("resize", fit);
      return () => removeEventListener("resize", fit);
    }, []);

    /** Give a frame `url` via `put` and wait for it to load (or time out). */
    const load = (url: string, put: (src: string) => void) =>
      new Promise<void>((resolve) => {
        const src = `${url}&load=${++seq.current}`;
        const done = () => {
          waiters.current.delete(src);
          resolve();
        };
        waiters.current.set(src, done);
        setTimeout(done, LOAD_TIMEOUT);
        put(src);
      });
    const loadInto = (i: number, url: string) => load(url, (src) => setFrames((f) => (i === 0 ? [src, f[1]] : [f[0], src])));

    /** Make sure the transition frame holds `url` (null: no transition page, just the ground color). */
    const loadTransition = async (url: string | null) => {
      if (url === transitionLoaded.current) return;
      transitionLoaded.current = url;
      transitionHold.current = WIPE_HOLD;
      if (url) {
        await load(url, setTransitionSrc);
        const ms = Number((await ask(transitionRef.current))?.hold ?? NaN);
        transitionHold.current = Number.isFinite(ms) && ms >= 0 ? Math.min(ms, 5000) : WIPE_HOLD;
      } else setTransitionSrc(null);
    };

    const onLoad = (frame: HTMLIFrameElement | null) => {
      const src = frame?.getAttribute("src");
      if (src) waiters.current.get(src)?.();
    };

    /** How long the transition page wants to stay fully on screen (its <meta name="viewswitcher:hold">). */
    const holdFor = () => transitionHold.current;

    const run = async () => {
      if (running.current) return;
      running.current = true;
      try {
        while (desired.current && desired.current.url !== shown.current?.url) {
          const job = desired.current;
          const back = 1 - frontRef.current;
          await Promise.all([loadInto(back, job.url), loadTransition(wantedTransition.current)]);
          if (desired.current !== job) continue; // superseded while loading: go straight to the newer one
          // A scene busy right after loading (OBS's browser on a cold start) gets a second chance.
          const st = (await ask(refs[back].current)) ?? (desired.current === job ? await ask(refs[back].current) : null);
          if (desired.current !== job) continue;
          frameVersion.current[back] = st?.version ?? null;
          if (st) knownSlots.current.set(job.path, st.slots);
          else report({ warning: "scene didn't answer the bridge: keeping its last known slots", path: job.path });
          // No answer (a scene's own CSP blocking the bridge, markup that swallows it): the slots it
          // last reported, else leave OBS as it is rather than hide every device.
          const slots: Slot[] | null = st?.slots ?? knownSlots.current.get(job.path) ?? null;
          const firstShow = shown.current === null;
          // Same scene, new version (an edit was saved): swap frames with no transition.
          // Renamed on air (EDIT-19): the same scene under a new path, also no transition.
          const wipeIt = !firstShow && shown.current?.path !== job.path && !(job.from && job.from === shown.current?.path);
          if (wipeIt) {
            // Tell the transition page to play (it can animate on the "play" class; see scene.js).
            transitionRef.current?.contentWindow?.postMessage({ viewswitcher: "transition" }, "*");
            setWipe(true);
            await sleep(WIPE_IN);
          }
          if (slots) await api.reportSlots({ path: job.path, slots, ...slotOrder() }).catch(() => {});
          frontRef.current = back;
          setFront(back);
          shown.current = job;
          if (wipeIt) {
            await sleep(holdFor());
            setWipe(false);
          }
        }
      } catch (e) {
        report({ error: String(e) });
      } finally {
        running.current = false;
        setWipe(false);
        // A request may have arrived after the loop's last check.
        if (desired.current && desired.current.url !== shown.current?.url) run();
      }
    };

    // Live edits from the scene editor: change the on-air frame's DOM (never the file), only when the
    // edit was made against the version this frame shows. When a moved element is or holds a device
    // slot, report the slots again (at most ~30 times a second) so OBS follows it. If previews stop
    // without a save (the editor went away mid-drag), reload the frame so the stream matches the file.
    useEffect(() => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let slotsToReport: { path: string; slots: Slot[] } | null = null;
      // Newest preview seq applied, per editor and element, for the version on screen (reset with it).
      const latest = new Map<string, number>();
      let latestFor = "";
      let sent = 0;
      const off = onScenePreview((path, hash, edit, order) => {
        const job = shown.current;
        if (!job || path !== job.path) return;
        const win = refs[frontRef.current].current?.contentWindow;
        if (!win) return;
        const version = frameVersion.current[frontRef.current];
        if (version !== latestFor) {
          latest.clear();
          latestFor = version ?? "";
        }
        // A preview for another version of the file would name the wrong elements: the bridge ignores it too.
        if (!version || hash !== version) return;
        // Previews are separate requests and can arrive out of order: never step back to an older one.
        const kind = editKind(edit);
        const key = `${order.session}:${edit.id}:${kind === "text" ? "t" : kind === "src" ? "s" : "p"}`;
        if (order.seq <= (latest.get(key) ?? -1)) return;
        latest.set(key, order.seq);
        win.postMessage({ viewswitcher: "frame:preview", id: ++sent, hash, edit }, "*");
        clearTimeout(backstop.current);
        backstop.current = setTimeout(() => {
          // Not if a saved version replaced it, or the operator asked for another scene meanwhile.
          if (!shouldBackstop(shown.current, desired.current, job)) return;
          desired.current = { url: freshUrl(job.url, ++seq.current), path: job.path };
          run();
        }, PREVIEW_BACKSTOP_MS);
      });
      // The bridge answers each preview; when it moved a device slot, report the slots again (at most
      // ~30 times a second) so OBS follows it.
      const onApplied = (e: MessageEvent) => {
        const d = e.data as { viewswitcher?: string; slotMoved?: boolean; slots?: unknown } | null;
        if (d?.viewswitcher !== "frame:applied" || !d.slotMoved) return;
        const front = refs[frontRef.current].current;
        const path = shown.current?.path;
        if (!front || e.source !== front.contentWindow || !path) return;
        slotsToReport = { path, slots: cleanSlots(d.slots) };
        if (timer) return;
        timer = setTimeout(() => {
          timer = undefined;
          const r = slotsToReport;
          slotsToReport = null;
          // Still the scene on screen: a saved version may have swapped in during these 33 ms.
          if (r && shown.current?.path === r.path) api.reportSlots({ path: r.path, slots: r.slots, ...slotOrder() }).catch(() => {});
        }, 33);
      };
      addEventListener("message", onApplied);
      return () => {
        off();
        removeEventListener("message", onApplied);
        clearTimeout(backstop.current);
      };
    }, []);

    useEffect(() => {
      if (!target || !onAir) return;
      if (desired.current?.url === target) return;
      desired.current = { url: target, path: onAir.path, from: onAir.renamedFrom };
      run();
    }, [target]);

    return (
      <div className="program">
        <div className="program-stage" style={{ transform: `scale(${scale})` }}>
          {frames.map((src, i) =>
            src ? (
              <iframe key={i} ref={refs[i]} title={`Program ${i}`} src={src} sandbox={SCENE_SANDBOX} onLoad={() => onLoad(refs[i].current)}
                style={{ visibility: i === front ? "visible" : "hidden" }} />
            ) : null,
          )}
          {/* Transition: the scene's transition page (project's, else the org's), over the org's ground color. */}
          <div className={`wipe${wipe ? " on" : ""}`} aria-hidden="true" style={{ "--ground": onAir?.ground } as CSSProperties}>
            {transitionSrc && <iframe ref={transitionRef} title="Transition" src={transitionSrc} sandbox={SCENE_SANDBOX} tabIndex={-1} onLoad={() => onLoad(transitionRef.current)} />}
          </div>
        </div>
      </div>
    );
  },
});
