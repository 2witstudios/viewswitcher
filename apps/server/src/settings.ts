// The library's own switcher settings, in <library>/.viewswitcher/settings.json. For now that is
// only what an AI agent connected over MCP may put on air (see agent-guard.ts).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentOnAir } from "@viewswitcher/shared";

export type Settings = { agentOnAir: AgentOnAir };

export const AGENT_ON_AIR: readonly AgentOnAir[] = ["never", "not-live", "always"];
export const DEFAULT_SETTINGS: Settings = { agentOnAir: "not-live" };

export const isAgentOnAir = (v: unknown): v is AgentOnAir => AGENT_ON_AIR.includes(v as AgentOnAir);

const file = (root: string) => join(root, ".viewswitcher", "settings.json");
const readRaw = (root: string): Promise<Record<string, unknown>> =>
  readFile(file(root), "utf8")
    .then((t) => JSON.parse(t))
    .then((v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {}))
    .catch(() => ({}));

/** The settings, with defaults for anything missing or unreadable (a hand-edited typo never breaks the switcher). */
export async function readSettings(root: string): Promise<Settings> {
  const saved = await readRaw(root);
  return { agentOnAir: isAgentOnAir(saved.agentOnAir) ? saved.agentOnAir : DEFAULT_SETTINGS.agentOnAir };
}

/** Change some settings; keeps any other keys already in the file. */
export async function writeSettings(root: string, patch: Partial<Settings>): Promise<Settings> {
  if (patch.agentOnAir !== undefined && !isAgentOnAir(patch.agentOnAir)) throw new SettingsError(`onAir is one of ${AGENT_ON_AIR.join(", ")}`);
  const next = { ...(await readRaw(root)), ...patch };
  await mkdir(join(root, ".viewswitcher"), { recursive: true });
  await writeFile(file(root), JSON.stringify(next, null, 2) + "\n");
  return readSettings(root);
}

export class SettingsError extends Error {}
