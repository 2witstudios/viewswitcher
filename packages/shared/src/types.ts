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
  /** Templates only: the template set it's in (templates/<set>/), absent for the org's own. */
  set?: string;
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

/**
 * A set of templates installed from a template pack: templates/<id>/ with the pack's pack.json,
 * its views, _shared/ and assets/. Its templates are named "<set>/<view>" where a template is asked for.
 */
export type TemplateSet = {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  templates: Scene[];
  /** The set's own transition (templates/<id>/_shared/transition.html), if it has one. */
  transition: string | null;
};

/** One org's content. */
export type Library = {
  org: Org;
  /** The org's own templates (templates/*.html). */
  templates: Scene[];
  /** Installed template packs, by name. */
  sets: TemplateSet[];
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
  /** The path this scene had on air before it was renamed, or the stream copy it replaced on Revert: the program page swaps without a transition. */
  renamedFrom?: string;
  projectId?: string;
  streamId?: string;
  /**
   * The file was deleted while on air and nothing took its place: the program keeps showing the
   * version it has (reloading would put a 404 on stream) until another scene goes on air or the file is back.
   */
  missing?: boolean;
};

export type ObsStatus = {
  connected: boolean;
  recording: boolean;
  streaming: boolean;
  /**
   * Why OBS won't let the switcher in, while it won't: it asks for a password and none is set
   * ("missing"), or it refused the one given ("wrong"). Absent once connected, or when OBS isn't there at all.
   */
  auth?: "missing" | "wrong";
};

/** What OBS has of what the switcher needs (see "Set up OBS"). */
export type ObsSetup = {
  /** The "ViewSwitcher" scene exists. */
  scene: boolean;
  /** Its program browser source exists and shows this server's /program. */
  program: boolean;
  /** Its ground color source exists. */
  ground: boolean;
  /**
   * The program source is the top item and the ground the bottom one. A source added in OBS above the
   * program covers every scene, so setup is needed again (it puts them back in order).
   */
  ordered: boolean;
  /** Device sources (Camera, Screen, iPad) not in the scene yet; the user adds them in OBS. */
  missingDevices: string[];
};

/** The USB-C link to the iPhone or iPad app (see the server's usb-bridge.ts). */
export type UsbStatus = {
  /** The bridge is running (macOS, usbmuxd present, VIEWSWITCHER_USB isn't 0). */
  enabled: boolean;
  /** An iPhone or iPad is plugged in over USB. */
  attached: boolean;
  /** The ViewSwitcher app on it is open and its tunnels are ready. */
  connected: boolean;
  /** Which kind it is, from usbmuxd's product id; absent when unknown. */
  device?: UsbDevice;
};
export type UsbDevice = "iPhone" | "iPad";

/** What an AI agent connected over MCP may put on air: never, only while OBS isn't streaming or recording, or always. */
export type AgentOnAir = "never" | "not-live" | "always";

/** The agent connection (MCP). */
export type AgentStatus = {
  /** The setting, from .viewswitcher/settings.json (default "not-live"). */
  onAir: AgentOnAir;
  /** When an agent last called /mcp (ms since epoch), or null. */
  lastSeen: number | null;
  /** The agent's name, from its MCP initialize (e.g. "claude-code"), or null. */
  client: string | null;
};

/** Which agent apps this Mac has (GET /api/agent/clients, this Mac only), for Edit with AI. */
export type AgentClients = { claudeCode: boolean; claudeDesktop: boolean; cursor: boolean; codex: boolean; vscode: boolean };

export type LiveState = {
  onAir: OnAir | null;
  obs: ObsStatus;
  /** null until OBS is connected and checked. */
  obsSetup: ObsSetup | null;
  usb: UsbStatus;
  warnings: string[];
  agent: AgentStatus;
};

/** Server → client WebSocket messages. */
export type ServerMessage =
  | { t: "state"; state: LiveState }
  | { t: "library:changed"; paths: string[] }
  /** The scene editor showing a change live (never written): the program page applies it to the on-air scene if `path` matches. */
  | { t: "scene:preview"; path: string; hash: string; edit: SceneEdit; /** Which editor page sent it, and its order there: an older one from the same editor is ignored. */ session: string; seq: number }
  /** The entry script of the switcher build being served; a page running a different one reloads. "" when nothing is built. */
  | { t: "build"; build: string };
