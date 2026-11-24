// The ViewSwitcher server behind the Mac app: attach to one that already answers on the port
// (e.g. `bun run dev`), otherwise start the bundled one and own it. Only a server this app started
// is ever stopped. No Electron imports, so `bun test` covers it.
import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Probe = "viewswitcher" | "other" | "none";

/** What answers at `base`: a ViewSwitcher server, something else, or nothing. */
export async function probe(base: string, timeoutMs = 1500): Promise<Probe> {
  try {
    const res = await fetch(`${base}/api/state`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = (await res.json().catch(() => null)) as { obs?: unknown; onAir?: unknown } | null;
    return res.ok && body && "obs" in body && "onAir" in body ? "viewswitcher" : "other";
  } catch (e) {
    // Refused: nothing listens. A timeout means something holds the port but doesn't answer like us.
    return (e as Error).name === "TimeoutError" ? "other" : "none";
  }
}

export type Launch = {
  /** Executable and arguments: the bundled sidecar, or `bun …/index.ts` from a checkout. */
  command: string;
  args: string[];
  env: Record<string, string | undefined>;
  /** Server output is appended here. */
  logFile: string;
};

export type Server = {
  base: string;
  /** False when attached to a server someone else started; stop() then does nothing. */
  owned: boolean;
  /** Stops the server if this app started it; resolves once it has exited. */
  stop(): Promise<void>;
  /** Called if an owned server exits without stop() (crash). */
  onExit?: (code: number | null) => void;
};

export class PortTakenError extends Error {
  constructor(readonly port: string) {
    super(`Something else is using port ${port}, so ViewSwitcher can't start its server there. Quit that app, or set PORT to another port.`);
  }
}

export class ServerStartError extends Error {}

export const LOG_MAX_BYTES = 5 * 1024 * 1024;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Attach to a running ViewSwitcher server at `base`, or start one with `launch` and wait until it answers. */
export async function connectOrStart(base: string, launch: Launch, readyTimeoutMs = 20_000): Promise<Server> {
  const found = await probe(base);
  if (found === "viewswitcher") return { base, owned: false, stop: async () => {} };
  if (found === "other") throw new PortTakenError(new URL(base).port);
  return start(base, launch, readyTimeoutMs);
}

async function start(base: string, launch: Launch, readyTimeoutMs: number): Promise<Server> {
  mkdirSync(dirname(launch.logFile), { recursive: true });
  // Start a fresh log once it gets big, so it never grows forever.
  try {
    if (statSync(launch.logFile).size > LOG_MAX_BYTES) writeFileSync(launch.logFile, "");
  } catch {}
  const log = (text: string) => {
    try {
      appendFileSync(launch.logFile, text);
    } catch {}
  };
  log(`\n--- ${new Date().toISOString()} starting ${launch.command} ${launch.args.join(" ")}\n`);
  let tail = "";
  const child: ChildProcess = spawn(launch.command, launch.args, { env: launch.env as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
  const onOutput = (b: Buffer) => {
    const s = b.toString();
    tail = (tail + s).slice(-2000);
    log(s);
  };
  child.stdout?.on("data", onOutput);
  child.stderr?.on("data", onOutput);

  let exited: number | null | undefined;
  let stopping = false;
  const exit = new Promise<void>((resolve) => {
    child.on("exit", (code) => {
      exited = code;
      log(`--- server exited (${code})\n`);
      if (!stopping) server.onExit?.(code);
      resolve();
    });
    child.on("error", (e) => {
      tail += `\n${e.message}`;
      exited = -1;
      resolve();
    });
  });

  const server: Server = {
    base,
    owned: true,
    async stop() {
      if (exited !== undefined) return;
      stopping = true;
      child.kill("SIGTERM");
      const done = await Promise.race([exit.then(() => true), sleep(3000).then(() => false)]);
      if (!done) {
        child.kill("SIGKILL");
        await exit;
      }
    },
  };

  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() < deadline) {
    if (exited !== undefined) throw new ServerStartError(`The ViewSwitcher server stopped while starting.\n\n${tail.trim()}`);
    if ((await probe(base, 500)) === "viewswitcher") return server;
    await sleep(150);
  }
  await server.stop();
  throw new ServerStartError(`The ViewSwitcher server didn't answer within ${readyTimeoutMs / 1000} s.\n\n${tail.trim()}`);
}
