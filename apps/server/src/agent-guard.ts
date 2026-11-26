// What an AI agent connected over MCP may do to the show, by the agent on-air setting
// (.viewswitcher/settings.json). "Live" means OBS is streaming or recording. Only MCP tools ask;
// people in the switcher are never blocked.
import { parseLibraryPath, transitionCandidates } from "@viewswitcher/shared";
import type { AgentOnAir } from "@viewswitcher/shared";

export type GuardAction = { kind: "go_on_air" } | { kind: "write"; paths: string[] };

export type GuardInput = {
  setting: AgentOnAir;
  live: boolean;
  /**
   * The scene on air, the transition that plays for it, and the library files those load (their
   * stylesheets, scripts, pictures, video, fonts: scene-refs.ts loadedFiles).
   */
  onAir: { path: string; transition?: string | null; loads?: string[]; loadsComplete?: boolean; loadsUnreadable?: string[] } | null;
  action: GuardAction;
};

export type GuardResult = { ok: true } | { ok: false; reason: string };

/**
 * Library files whose change would show on stream right now: the on-air scene, its transitions, its
 * org's shared files, and anything else those load. Compared without case, as the Mac's disk does
 * ("Templates/_Shared" is the same folder).
 */
function onStream(onAir: NonNullable<GuardInput["onAir"]>, path: string): "scene" | "transition" | "shared" | "loaded" | "tooMany" | "unreadable" | null {
  const p = path.toLowerCase();
  const scene = onAir.path.toLowerCase();
  if (p === scene) return "scene";
  // The resolved transition, and the project's own one that would take over from the org's if it were created.
  if (p === onAir.transition?.toLowerCase() || transitionCandidates(scene).includes(p)) return "transition";
  // The org's _shared/ styles every scene; a set's styles its own views.
  const file = parseLibraryPath(p), view = parseLibraryPath(scene);
  if (file.org === view.org && file.kind === "shared" && (!file.set || file.set === view.set)) return "shared";
  if (onAir.loads?.some((l) => l.toLowerCase() === p)) return "loaded";
  // The scan of what the scene loads stopped at its limit: anything might be on stream.
  if (onAir.loadsComplete === false) return "tooMany";
  // It loads a file the scan couldn't read: what that loads is unknown, so anything might be.
  if (onAir.loadsUnreadable?.length) return "unreadable";
  return null;
}

const REASONS: Record<Exclude<ReturnType<typeof onStream>, null>, string | ((onAir: NonNullable<GuardInput["onAir"]>) => string)> = {
  unreadable: (onAir) =>
    `The view on air loads ${onAir.loadsUnreadable!.slice(0, 3).join(", ")}, which ViewSwitcher couldn't read just now (a disk or permission error), so it can't tell what that file loads, and while you're live agents can't change library files. Check that file, or wait until you're off air.`,
  scene: "That view is on air and you're live. Make a stream copy with customize_scene (or duplicate_scene) and change that, or wait until you're off air (OBS stops streaming and recording).",
  transition: "That is the transition for the view on air, and you're live. Wait until you're off air to change it.",
  shared: "Files in templates/_shared/ (and a template set's own _shared/) shape the view on air, and you're live. Wait until you're off air, or put the change in a stream copy of the view (customize_scene).",
  tooMany: "The view on air loads more files than ViewSwitcher checks, so while you're live agents can't change library files. Wait until you're off air.",
  loaded: "The view on air uses that file, and you're live. Save your version under a new name and use it in a stream copy of the view (customize_scene), or wait until you're off air (OBS stops streaming and recording).",
};

export function agentGuard({ setting, live, onAir, action }: GuardInput): GuardResult {
  if (setting === "always") return { ok: true };
  if (action.kind === "go_on_air") {
    if (setting === "never") return { ok: false, reason: "ViewSwitcher is set so agents never put views on air. Tell the user the view is ready to put on air in the switcher (or they can change the agent setting in Edit with AI)." };
    if (live) return { ok: false, reason: "OBS is streaming or recording, so agents can't put views on air. Tell the user the view is ready and let them put it on air in the switcher, or wait until you're off air (OBS stops streaming and recording)." };
    return { ok: true };
  }
  if (!live || !onAir) return { ok: true };
  for (const p of action.paths) {
    const hit = onStream(onAir, p);
    if (hit) {
      const reason = REASONS[hit];
      return { ok: false, reason: typeof reason === "string" ? reason : reason(onAir) };
    }
  }
  return { ok: true };
}
