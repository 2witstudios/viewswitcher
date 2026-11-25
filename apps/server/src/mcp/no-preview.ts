// The previewer used until OBS rendering (preview.ts) is wired in: no pictures, just where to look.
import type { Previewer } from "../preview-types";

export function noPreview(port: number): Previewer {
  const base = `http://127.0.0.1:${port}`;
  return {
    scene: async (path) => ({ ok: false, reason: "Previews need OBS", url: `${base}/library/${encodeURI(path)}?preview` }),
    program: async () => ({ ok: false, reason: "Previews need OBS", url: `${base}/program` }),
  };
}
