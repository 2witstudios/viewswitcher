import type { SceneEdit } from "./html-scan";

/** Where a scene file lives in the library. */
export type SceneOrigin = "template" | "project" | "stream";

export type Scene = {
  /** File name without .html; the override key between a project and its streams. */
  name: string;
  /** From the file's <title>, else the name. */
  label: string;
  /** Library-relative path, starting with the org, e.g. "daisy/projects/ld-2026/scenes/teaching.html". */
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
  /** This project's own transition (projects/<id>/transition.html), overriding the org's; null when it uses the org's. */
  transition: string | null;
};

export type AssetKind = "image" | "video" | "audio" | "other";

export type Asset = {
  name: string;
  path: string;
  kind: AssetKind;
  size: number;
};

/** A brand or channel with its own templates, assets and projects: a top-level library folder. */
export type Org = {
  /** Folder name, e.g. "daisy". */
  id: string;
  name: string;
  /** Highlight color for this org in the switcher. */
  accent: string;
  /** Painted behind every scene in OBS and used for slot corner masks. */
  ground: string;
};

/** One org's content. */
export type Library = {
  org: Org;
  templates: Scene[];
  assets: Asset[];
  projects: Project[];
  /** The org's default transition (templates/_shared/transition.html), or null for a plain cut through the ground color. */
  transition: string | null;
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
  org: string;
  /** The org's ground color, for the program page's transitions. */
  ground?: string;
  /** The transition page played when switching to this scene (see transitionCandidates); null for a plain ground-color wipe. */
  transition?: string | null;
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
  | { t: "library:changed"; paths: string[] }
  /** The scene editor showing a change live (never written): the program page applies it to the on-air scene if `path` matches. */
  | { t: "scene:preview"; path: string; hash: string; edit: SceneEdit; /** Which editor page sent it, and its order there: an older one from the same editor is ignored. */ session: string; seq: number }
  /** The entry script of the switcher build being served; a page running a different one reloads. "" when nothing is built. */
  | { t: "build"; build: string };
