// Pictures of scenes for agents (MCP-1). The compiled server has no browser, but OBS has one (CEF):
// a scene of its own (config.obs.previewScene), never the program, holds one 1920×1080 browser
// source. A preview points that source at the scene with ?preview and screenshots it until the
// picture settles. program() screenshots the ViewSwitcher scene as it is, camera included.
// Neither ever switches OBS's program or touches the ViewSwitcher scene, so both are safe while live.
import { existsSync } from "node:fs";
import { relative, sep } from "node:path";
import { config } from "./config";
import type { OBSClient } from "./obs";
import { ensurePreview } from "./obs-setup";
import { inside, PathError } from "./paths";
import { isBlankPng } from "./png";
import type { Previewer, PreviewResult } from "./preview-types";

export type PreviewOptions = {
  obs: typeof config.obs;
  port: number;
  /** The library that scene paths are inside; config.library unless a test passes its own. */
  library?: string;
  /** How long a preview waits for the picture to settle. */
  timeoutMs?: number;
  /** The gap between screenshots while it waits. */
  intervalMs?: number;
  /** The longest one OBS request may take before the preview gives up on it. */
  requestTimeoutMs?: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const BROWSER = "Open the URL in a browser at 1920×1080 if you can.";
export const BLANK = "about:blank";

export function createPreviewer(live: Pick<OBSClient, "request" | "status">, opts: PreviewOptions): Previewer {
  const { port, timeoutMs = 1500, intervalMs = 100, requestTimeoutMs = 10_000 } = opts;
  // Every OBS request a preview makes has a deadline: an OBS that keeps its socket open but never
  // answers would otherwise hold this preview, and every one queued behind it, for good.
  const obs = {
    get status() {
      return live.status;
    },
    request: <T>(type: string, data?: object): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`OBS didn't answer ${type} within ${requestTimeoutMs / 1000} s`)), requestTimeoutMs);
      });
      return Promise.race([live.request<T>(type, data), late]).finally(() => clearTimeout(timer));
    },
  };
  const library = opts.library ?? config.library;
  const base = `http://127.0.0.1:${port}`;
  let loads = 0;

  // One preview at a time: they share the one browser source, so two agents previewing at once
  // would otherwise point it at each other's scenes mid-screenshot. Unlike applyLatest in index.ts,
  // every preview runs (each caller is waiting for its own picture).
  let queue: Promise<unknown> = Promise.resolve();
  const oneAtATime = <T>(job: () => Promise<T>): Promise<T> => {
    const run = queue.then(job, job);
    queue = run.catch(() => {});
    return run;
  };

  const size = (full?: boolean) => (full ? { width: 1920, height: 1080 } : { width: 960, height: 540 });

  async function screenshot(sourceName: string, { width, height }: { width: number; height: number }) {
    const { imageData } = await obs.request<{ imageData: string }>("GetSourceScreenshot", { sourceName, imageFormat: "png", imageWidth: width, imageHeight: height });
    const bytes = Buffer.from(imageData.slice(imageData.indexOf(",") + 1), "base64"); // a data: URI
    return { key: imageData, png: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
  }

  /**
   * Screenshots until two frames in a row match, or the time runs out (then the latest frame, since
   * a scene with a running countdown never settles). Empty frames, which OBS returns until the page
   * has painted, never count. Null if it never drew anything.
   */
  async function settle(sourceName: string, dims: { width: number; height: number }) {
    const deadline = Date.now() + timeoutMs;
    let last: { key: string; png: Uint8Array } | null = null;
    for (;;) {
      // Wait first: OBS applies new settings on its next video frame, and until then the source
      // still shows the previous page.
      await sleep(intervalMs);
      const shot = await screenshot(sourceName, dims);
      const blank = isBlankPng(shot.png);
      if (!blank && last && shot.key === last.key) return shot.png;
      if (!blank) last = shot;
      if (Date.now() >= deadline) return last?.png ?? null;
    }
  }

  return {
    async scene(path, { full } = {}) {
      const abs = inside(library, path);
      const rel = relative(library, abs).split(sep).join("/");
      if (!rel.endsWith(".html")) throw new PathError(`Only scenes (.html files) can be previewed: ${path}`);
      if (!existsSync(abs)) throw new PathError(`No scene at ${path}`);
      const url = `${base}/library/${rel.split("/").map(encodeURIComponent).join("/")}?preview`;
      const dims = size(full);
      return oneAtATime(async (): Promise<PreviewResult> => {
        if (!obs.status.connected) return { ok: false, reason: `OBS isn't connected, so there's no picture. ${BROWSER}`, url };
        try {
          // A new query string each time, so OBS reloads the page even when the URL is the same scene.
          await ensurePreview(obs, opts.obs, `${url}&load=${Date.now()}-${++loads}`);
          const png = await settle(opts.obs.previewSource, dims);
          if (!png) return { ok: false, reason: `OBS didn't draw the scene within ${timeoutMs / 1000} s, so there's no picture. ${BROWSER}`, url };
          return { ok: true, png, ...dims };
        } catch (e) {
          return { ok: false, reason: `OBS couldn't render the scene (${(e as Error).message}), so there's no picture. ${BROWSER}`, url };
        } finally {
          // Done with the page: a blank one, so the scene (a looping video, a countdown) doesn't keep
          // running in OBS for the rest of the show. The browser itself stays warm (shutdown: false).
          await obs.request("SetInputSettings", { inputName: opts.obs.previewSource, inputSettings: { url: BLANK } }).catch(() => {});
        }
      });
    },

    // Not queued behind previews: it only reads, and changes nothing. One screenshot, not a wait
    // for two matching frames, because the live camera means the program never holds still.
    async program({ full } = {}) {
      const url = `${base}/program`;
      const without = "The URL shows the scene on air, without the camera or screen.";
      if (!obs.status.connected) return { ok: false, reason: `OBS isn't connected, so there's no picture of the program. ${without}`, url };
      const dims = size(full);
      try {
        const { png } = await screenshot(opts.obs.scene, dims);
        if (isBlankPng(png)) return { ok: false, reason: `OBS returned an empty picture of "${opts.obs.scene}". ${without}`, url };
        return { ok: true, png, ...dims };
      } catch (e) {
        return { ok: false, reason: `OBS couldn't take a picture of "${opts.obs.scene}" (${(e as Error).message}). ${without}`, url };
      }
    },
  };
}
