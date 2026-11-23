// The OBS browser source (1920×1080). Shows the on-air scene and tells the server where its device slots are.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { sceneUrl, useLive } from "../lib/live";

// Report errors to the server log: the OBS browser has no devtools by default.
const report = (data: object) => fetch("/api/log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ where: "program", ...data }) }).catch(() => {});
if (typeof window !== "undefined") {
  addEventListener("error", (e) => report({ error: e.message, at: `${e.filename}:${e.lineno}` }));
  addEventListener("unhandledrejection", (e) => report({ error: String(e.reason) }));
  report({ loaded: navigator.userAgent });
}

const WIPE_IN = 170;
const WIPE_HOLD = 90;

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
    const refs = [useRef<HTMLIFrameElement>(null), useRef<HTMLIFrameElement>(null)];
    const first = useRef(true);
    const [scale, setScale] = useState(1);

    // Fit to the window when opened in a normal browser; OBS is exactly 1920×1080.
    useEffect(() => {
      const fit = () => setScale(Math.min(innerWidth / 1920, innerHeight / 1080));
      fit();
      addEventListener("resize", fit);
      return () => removeEventListener("resize", fit);
    }, []);

    // Load the new scene into the hidden frame.
    useEffect(() => {
      if (!target || frames[front] === target) return;
      const back = 1 - front;
      setFrames((f) => (back === 0 ? [target, f[1]] : [f[0], target]));
    }, [target]);

    const onLoad = async (i: number) => {
      const src = frames[i];
      if (i === front && !first.current) return;
      if (!src || !onAir || !target || src !== target) return;
      const slots = readSlots(refs[i].current!);
      if (first.current) {
        first.current = false;
        setFront(i);
        await api.reportSlots({ path: onAir.path, slots }).catch(() => {});
        return;
      }
      // Wipe to ground, move devices and swap behind it, then reveal.
      setWipe(true);
      await new Promise((r) => setTimeout(r, WIPE_IN));
      await api.reportSlots({ path: onAir.path, slots }).catch(() => {});
      setFront(i);
      await new Promise((r) => setTimeout(r, WIPE_HOLD));
      setWipe(false);
    };

    return (
      <div className="program">
        <div className="program-stage" style={{ transform: `scale(${scale})` }}>
          {frames.map((src, i) =>
            src ? (
              <iframe key={i} ref={refs[i]} title={`Program ${i}`} src={src} onLoad={() => onLoad(i)}
                style={{ visibility: i === front ? "visible" : "hidden" }} />
            ) : null,
          )}
          <div className={`wipe${wipe ? " on" : ""}`} aria-hidden="true"><img src="/icon.svg" alt="" /></div>
        </div>
      </div>
    );
  },
});
