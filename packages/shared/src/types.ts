/** Where a scene file lives in the library. */
export type SceneOrigin = "template" | "project" | "stream";

export type Scene = {
  /** File name without .html; the override key between a project and its streams. */
  name: string;
  /** From the file's <title>, else the name. */
  label: string;
  /** Library-relative path, e.g. "projects/ld-2026/scenes/teaching.html". */
  path: string;
  origin: SceneOrigin;
};

export type Stream = {
  /** Folder name, e.g. "12-04-burdens". */
  id: string;
  name: string;
  /** ISO date, e.g. "2026-12-04". */
  date: string;
  scenes: Scene[];
};

export type Project = {
  /** Folder name, e.g. "ld-2026". */
  id: string;
  name: string;
  scenes: Scene[];
  streams: Stream[];
};

export type AssetKind = "image" | "video" | "audio" | "other";

export type Asset = {
  name: string;
  path: string;
  kind: AssetKind;
  size: number;
};

export type Library = {
  templates: Scene[];
  assets: Asset[];
  projects: Project[];
};

/** A device hole in a scene, in 1920×1080 scene pixels. */
export type Slot = {
  source: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type OnAir = {
  path: string;
  label: string;
  projectId?: string;
  streamId?: string;
};

export type ObsStatus = {
  connected: boolean;
  recording: boolean;
  streaming: boolean;
};

export type LiveState = {
  onAir: OnAir | null;
  obs: ObsStatus;
  warnings: string[];
};

/** Server → client WebSocket messages. */
export type ServerMessage =
  | { t: "state"; state: LiveState }
  | { t: "library:changed"; paths: string[] };
