// The OBS browser source (1920×1080). Shows the on-air scene and tells the server where its device slots are.
//
// Switching is a single serialized loop, so it's deterministic however fast scenes are tapped:
// only one transition runs at a time, and when it finishes it checks for a newer request and runs again.
// Requests that are superseded while loading are dropped; the screen always ends on the latest one.
import { createFileRoute } from "@tanstack/react-router";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { sceneUrl, useLive } from "../lib/live";

// Report errors to the server log: the OBS browser has no devtools by default.
const report = (data: object) => fetch("/api/log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ where: "program", ...data }) }).catch(() => {});
if (typeof window !== "undefined") {
  addEventListener("error", (e) => report({ error: e.message, at: `${e.filename}:${e.lineno}` }));
  addEventListener("unhandledrejection", (e) => report({ error: String(e.reason) }));
}

const WIPE_IN = 170;
const WIPE_HOLD = 90; // a transition page can ask for longer: <meta name="viewswitcher:hold" content="600">
const LOAD_TIMEOUT = 6000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Job = { url: string; path: string };

function readSlots(frame: HTMLIFrameElement) {
  const doc = frame.contentDocument;
  if (!doc) return [];
  return [...doc.querySelectorAll<HTMLElement>("[data-slot]")].map((el) => {
    const r = el.getBoundingClientRect();
    return { source: el.dataset.slot!, x: r.left, y: r.top, w: r.width, h: r.height };
  });
}

export const Route = createFileRoute("/program")({
  component: function Program() {
    const { state, versions } = useLive();
    const onAir = state?.onAir ?? null;
    const target = onAir ? sceneUrl(onAir.path, versions) : null;

    const [frames, setFrames] = useState<[string | null, string | null]>([null, null]);
    const [front, setFront] = useState(0);
    const [wipe, setWipe] = useState(false);
    const [transitionSrc, setTransitionSrc] = useState<string | null>(null);
    const transitionRef = useRef<HTMLIFrameElement>(null);
    const transitionLoaded = useRef<string | null>(null); // transition URL in the frame (without &load)
    // The transition of the scene going on air (read by the loop, so an edit applies from the next switch).
    const wantedTransition = useRef<string | null>(null);
    wantedTransition.current = onAir?.transition ? sceneUrl(onAir.transition, versions) : null;
    const [scale, setScale] = useState(1);
    const refs = [useRef<HTMLIFrameElement>(null), useRef<HTMLIFrameElement>(null)];

    const desired = useRef<Job | null>(null); // latest request
    const shown = useRef<Job | null>(null); // what's on screen
    const frontRef = useRef(0);
    const running = useRef(false);
    const seq = useRef(0);
    const waiters = useRef<Map<string, () => void>>(new Map()); // frame src → resolve on load

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
      if (url) await load(url, setTransitionSrc);
      else setTransitionSrc(null);
    };

    const onLoad = (frame: HTMLIFrameElement | null) => {
      const src = frame?.getAttribute("src");
      if (src) waiters.current.get(src)?.();
    };

    /** How long the transition page wants to stay fully on screen. */
    const holdFor = () => {
      const meta = transitionRef.current?.contentDocument?.querySelector<HTMLMetaElement>('meta[name="viewswitcher:hold"]');
      const ms = Number(meta?.content);
      return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, 5000) : WIPE_HOLD;
    };

    const run = async () => {
      if (running.current) return;
      running.current = true;
      try {
        while (desired.current && desired.current.url !== shown.current?.url) {
          const job = desired.current;
          const back = 1 - frontRef.current;
          await Promise.all([loadInto(back, job.url), loadTransition(wantedTransition.current)]);
          if (desired.current !== job) continue; // superseded while loading: go straight to the newer one
          const slots = refs[back].current ? readSlots(refs[back].current!) : [];
          const firstShow = shown.current === null;
          if (!firstShow) {
            // Tell the transition page to play (it can animate on the "play" class; see scene.js).
            transitionRef.current?.contentWindow?.postMessage({ viewswitcher: "transition" }, "*");
            setWipe(true);
            await sleep(WIPE_IN);
          }
          await api.reportSlots({ path: job.path, slots }).catch(() => {});
          frontRef.current = back;
          setFront(back);
          shown.current = job;
          if (!firstShow) {
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

    useEffect(() => {
      if (!target || !onAir) return;
      if (desired.current?.url === target) return;
      desired.current = { url: target, path: onAir.path };
      run();
    }, [target]);

    return (
      <div className="program">
        <div className="program-stage" style={{ transform: `scale(${scale})` }}>
          {frames.map((src, i) =>
            src ? (
              <iframe key={i} ref={refs[i]} title={`Program ${i}`} src={src} onLoad={() => onLoad(refs[i].current)}
                style={{ visibility: i === front ? "visible" : "hidden" }} />
            ) : null,
          )}
          {/* Transition: the scene's transition page (project's, else the org's), over the org's ground color. */}
          <div className={`wipe${wipe ? " on" : ""}`} aria-hidden="true" style={{ "--ground": onAir?.ground } as CSSProperties}>
            {transitionSrc && <iframe ref={transitionRef} title="Transition" src={transitionSrc} tabIndex={-1} onLoad={() => onLoad(transitionRef.current)} />}
          </div>
        </div>
      </div>
    );
  },
});
