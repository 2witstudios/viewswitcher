// The library's own switcher settings, in <library>/.viewswitcher/settings.json. For now that is
// only what an AI agent connected over MCP may put on air (see agent-guard.ts).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentOnAir } from "@viewswitcher/shared";
import { writeAtomic } from "./atomic";

export type Settings = { agentOnAir: AgentOnAir };

export const AGENT_ON_AIR: readonly AgentOnAir[] = ["never", "not-live", "always"];
export const DEFAULT_SETTINGS: Settings = { agentOnAir: "not-live" };

export const isAgentOnAir = (v: unknown): v is AgentOnAir => AGENT_ON_AIR.includes(v as AgentOnAir);

const file = (root: string) => join(root, ".viewswitcher", "settings.json");

/** The file's keys; null when it exists but can't be read as a JSON object. A missing file is {}. */
async function readRaw(root: string): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await readFile(file(root), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    console.error("[settings] couldn't read settings.json:", (e as Error).message);
    return null;
  }
  try {
    const v = JSON.parse(text);
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch {}
  return null;
}

/**
 * The settings: the default for a setting that isn't there yet. A file that can't be read, or a value
 * that isn't one of the choices, means the strictest choice ("never"): a corrupt or mistyped file must
 * never let agents do more than the person picked.
 */
export async function readSettings(root: string): Promise<Settings> {
  const saved = await readRaw(root);
  if (saved === null) {
    console.error("[settings] settings.json isn't valid JSON: agents may not put anything on air until it's fixed or set again in Edit with AI");
    return { agentOnAir: "never" };
  }
  if (!("agentOnAir" in saved)) return { ...DEFAULT_SETTINGS };
  if (isAgentOnAir(saved.agentOnAir)) return { agentOnAir: saved.agentOnAir };
  console.error(`[settings] settings.json has agentOnAir ${JSON.stringify(saved.agentOnAir)}, which isn't one of ${AGENT_ON_AIR.join(", ")}: treated as "never"`);
  return { agentOnAir: "never" };
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Change some settings; keeps any other keys already in the file. One write at a time, in the order
 * they came: Always then Never, picked quickly, must end on Never, never on whichever finished last.
 */
export function writeSettings(root: string, patch: Partial<Settings>): Promise<Settings> {
  if ("agentOnAir" in patch && !isAgentOnAir(patch.agentOnAir)) return Promise.reject(new SettingsError(`onAir is one of ${AGENT_ON_AIR.join(", ")}`));
  const run = queue.then(async () => {
    // An unreadable file is replaced: the person just chose what it should say.
    const next = { ...((await readRaw(root)) ?? {}), ...patch };
    await writeAtomic(file(root), JSON.stringify(next, null, 2) + "\n");
    return readSettings(root);
  });
  queue = run.catch(() => {});
  return run;
}

export class SettingsError extends Error {}
