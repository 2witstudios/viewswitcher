// Starts the real server in a subprocess for the end-to-end tests (http-guard, remote, agent-endpoints, mcp/http).
import { createServer } from "node:net";
import { join } from "node:path";
import type { Subprocess } from "bun";

/**
 * How long a test file's beforeAll may take to start its server. A cold start on a busy machine
 * (a CI runner, a Mac building Xcode) can take well over the 5 s hook default.
 */
export const SERVER_START_MS = 30_000;

/** startServer gives up this long before SERVER_START_MS, so its own error wins over the hook timeout. */
export const READY_MS = SERVER_START_MS - 2_000;

/** How much of the server's stderr a startup error quotes. */
const STDERR_TAIL = 2_000;

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
 * `ready()` is true. Throws if the server exits first, or isn't ready within `readyMs` (even when a
 * check hangs), with the tail of its stderr, so the error names the cause instead of the hook timing out.
 */
export async function startServer(env: Record<string, string>, ready: () => Promise<boolean>, readyMs = READY_MS): Promise<Subprocess> {
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, "index.ts")], {
    env: { ...process.env, ...env },
    stdout: "ignore",
    stderr: "pipe",
  });
  // Read stderr as it comes, so a chatty server never blocks on a full pipe; keep only the tail.
  let stderr = "";
  const drained = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stderr) stderr = (stderr + decoder.decode(chunk, { stream: true })).slice(-STDERR_TAIL);
  })().catch(() => {});
  const fail = async (why: string) => {
    proc.kill();
    await Promise.race([drained, Bun.sleep(500)]);
    const tail = stderr.trim();
    return new Error(tail ? `${why}; its stderr ended:\n${tail}` : why);
  };

  let exited: number | null = null;
  void proc.exited.then((code) => (exited = code));
  const deadline = Date.now() + readyMs;
  while (Date.now() < deadline) {
    if (exited !== null) throw await fail(`server exited with code ${exited} before it was ready`);
    // A server that accepts the connection but never answers mustn't hang past the deadline.
    let timer: Timer | undefined;
    const left = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now()))));
    const ok = await Promise.race([ready().catch(() => false), left]);
    clearTimeout(timer);
    if (ok) return proc;
    await Bun.sleep(50);
  }
  throw await fail(`server wasn't ready within ${readyMs / 1000} s`);
}
