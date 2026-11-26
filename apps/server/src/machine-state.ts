// This Mac's own state for a library: the paired phones and tablets (devices.json) and what agents
// may put on air (settings.json). It lives outside the library, under Application Support, so nothing
// that travels with the library (a git clone or pull, a synced or copied folder) can bring someone
// else's pairings or a looser agent setting, and no token hash is ever committed or synced with it.
// The on-air record and the kit's bookkeeping stay in <library>/.viewswitcher: they describe the
// library, not who may reach it.
import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { writeAtomic } from "./atomic";

/** Where this Mac keeps its state for the library at `library`: one folder per library path. */
export function machineStateDir(stateRoot: string, library: string): string {
  const key = createHash("sha256").update(resolve(library)).digest("hex").slice(0, 16);
  return join(resolve(stateRoot), "libraries", key);
}

/**
 * Before this lived outside the library, it was in <library>/.viewswitcher. Once, at startup:
 * - settings.json is carried over only when it says "never" (the strictest choice), so a file that
 *   came with the library can't widen what agents may do; anything else starts from the default;
 * - devices.json is never carried over, since its token hashes may be someone else's: phones and
 *   tablets pair again;
 * and both old files are removed from the library. Returns what it did, for the log.
 */
export async function migrateMachineState(library: string, dir: string): Promise<{ settings: "kept-never" | "dropped" | null; devices: "dropped" | null }> {
  const old = (name: string) => join(library, ".viewswitcher", name);
  const done: { settings: "kept-never" | "dropped" | null; devices: "dropped" | null } = { settings: null, devices: null };

  const oldSettings = await readFile(old("settings.json"), "utf8").catch(() => null);
  if (oldSettings !== null) {
    let never = false;
    try {
      never = JSON.parse(oldSettings)?.agentOnAir === "never";
    } catch {}
    const there = await readFile(join(dir, "settings.json"), "utf8").then(() => true, () => false);
    if (never && !there) await writeAtomic(join(dir, "settings.json"), JSON.stringify({ agentOnAir: "never" }, null, 2) + "\n", { plainParent: true });
    await rm(old("settings.json"), { force: true });
    done.settings = never ? "kept-never" : "dropped";
  }
  if (await readFile(old("devices.json")).then(() => true, () => false)) {
    await rm(old("devices.json"), { force: true });
    done.devices = "dropped";
  }
  return done;
}
