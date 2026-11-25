// Starts the real server in a subprocess for the end-to-end tests (http-guard, remote, agent-endpoints, mcp/http).
import { createServer } from "node:net";
import { join } from "node:path";
import type { Subprocess } from "bun";

/**
 * How long a test file's beforeAll may take to start its server. A cold start on a busy machine
 * (a CI runner, a Mac building Xcode) can take well over the 5 s hook default.
 */
export const SERVER_START_MS = 30_000;

/** A port nothing is listening on right now. */
export function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

/**
 * Runs apps/server/src/index.ts with `env` on top of this process's environment and resolves once
 * `ready()` is true. Throws if the server exits first, or isn't ready a little before SERVER_START_MS
 * (so the error names the cause instead of the hook timing out).
 */
export async function startServer(env: Record<string, string>, ready: () => Promise<boolean>): Promise<Subprocess> {
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, "index.ts")], {
    env: { ...process.env, ...env },
    stdout: "ignore",
    stderr: "ignore",
  });
  let exited: number | null = null;
  void proc.exited.then((code) => (exited = code));
  const deadline = Date.now() + SERVER_START_MS - 2_000;
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`server exited with code ${exited} before it was ready`);
    if (await ready().catch(() => false)) return proc;
    await Bun.sleep(50);
  }
  proc.kill();
  throw new Error(`server wasn't ready within ${(SERVER_START_MS - 2_000) / 1000} s`);
}
