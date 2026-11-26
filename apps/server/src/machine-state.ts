// This Mac's own state for a library: the paired phones and tablets (devices.json) and what agents
// may put on air (settings.json). It lives outside the library, under Application Support, so nothing
// that travels with the library (a git clone or pull, a synced or copied folder) can bring someone
// else's pairings or a looser agent setting, and no token hash is ever committed or synced with it.
// The on-air record and the kit's bookkeeping stay in <library>/.viewswitcher: they describe the
// library, not who may reach it.
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { writeAtomic } from "./atomic";

/** Where this Mac keeps its state for the library at `library`: one folder per library path. */
export function machineStateDir(stateRoot: string, library: string): string {
  // The library's real path once it exists, so another spelling of it (a link, another case on APFS)
  // is the same library; its resolved path before the first run creates it.
  let at = resolve(library);
  try {
    at = realpathSync(at);
  } catch {}
  const key = createHash("sha256").update(at).digest("hex").slice(0, 16);
  return join(resolve(stateRoot), "libraries", key);
}

/**
 * Before this lived outside the library, it was in <library>/.viewswitcher. Once, at startup:
 * - settings.json is carried over only as "never" (the strictest choice: what it says, or what an
 *   unreadable file already meant), so a file that came with the library can't widen what agents may
 *   do; "not-live" or "always" start from the default, and this Mac's own setting is never replaced;
 * - devices.json is never carried over, since its token hashes may be someone else's: phones and
 *   tablets pair again;
 * and both old files are removed from the library. Returns what it did, for the log.
 */
export async function migrateMachineState(library: string, dir: string): Promise<{ settings: "kept-never" | "kept-own" | "dropped" | null; devices: "dropped" | null }> {
  const old = (name: string) => join(library, ".viewswitcher", name);
  const done: { settings: "kept-never" | "kept-own" | "dropped" | null; devices: "dropped" | null } = { settings: null, devices: null };

  const drop = (name: string) => rm(old(name), { force: true }).catch((e) => console.error(`[library] couldn't remove the old ${name} from the library:`, (e as Error).message));
  const oldSettings = await readFile(old("settings.json"), "utf8").catch(() => null);
  if (oldSettings !== null) {
    // Read as settings.ts reads it: no setting yet is the default; a file that isn't a JSON object, or
    // a value that isn't a choice, already meant "never" (it fails closed), so it carries over as that.
    let never = true;
    try {
      const v = JSON.parse(oldSettings);
      if (v && typeof v === "object" && !Array.isArray(v)) never = v.agentOnAir !== undefined && v.agentOnAir !== "not-live" && v.agentOnAir !== "always";
    } catch {}
    const there = await readFile(join(dir, "settings.json"), "utf8").then(() => true, () => false);
    if (never && !there) await writeAtomic(join(dir, "settings.json"), JSON.stringify({ agentOnAir: "never" }, null, 2) + "\n", { plainParent: true });
    await drop("settings.json");
    done.settings = there ? "kept-own" : never ? "kept-never" : "dropped";
  }
  if (await readFile(old("devices.json")).then(() => true, () => false)) {
    await drop("devices.json");
    done.devices = "dropped";
  }
  return done;
}
