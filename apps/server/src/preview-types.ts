// The contract between the MCP tools and the OBS preview renderer (preview.ts).
export type PreviewResult =
  | { ok: true; png: Uint8Array; width: number; height: number }
  | { ok: false; reason: string; url: string };

export interface Previewer {
  /** A library scene (org-prefixed path) rendered at 1920×1080 with ?preview; 960×540 unless full. */
  scene(path: string, opts?: { full?: boolean }): Promise<PreviewResult>;
  /** What OBS is putting out right now (the ViewSwitcher scene, camera included). */
  program(opts?: { full?: boolean }): Promise<PreviewResult>;
}
