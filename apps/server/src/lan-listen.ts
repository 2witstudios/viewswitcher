// The Wi-Fi listener(s): how phones and tablets reach the server while Wi-Fi access is on.
//
// On macOS one listener on every address (0.0.0.0) sits beside the loopback one on the same port. Windows
// refuses that bind (the port is taken by 127.0.0.1's), but lets a listener on each of this PC's own
// addresses share it. So there, it listens on each address, and follows them: a new Wi-Fi network (a new
// address) is listened on within a few seconds, and one that went away is closed.
import type { Server } from "bun";

export type LanListeners<S extends Server<any>> = {
  /** Listening, or an error saying why not (nothing could be bound). */
  start(): string | null;
  stop(): void;
  readonly on: boolean;
  /** Whether a request came in through one of these listeners. */
  has(server: unknown): boolean;
  publish(topic: string, text: string): void;
  /** The listeners, for the sockets' sake (one per address on Windows). */
  readonly servers: S[];
};

export function lanListeners<S extends Server<any>>(o: {
  host: string;
  /** This computer's addresses (lan.ts thisMac), for a listener on each where 0.0.0.0 can't be shared. */
  addresses: () => string[];
  serve: (hostname: string) => S;
  /** Windows' rule: one listener per address (default: process.platform). */
  perAddress?: boolean;
  everyMs?: number;
  log?: (message: string) => void;
}): LanListeners<S> {
  const perAddress = (o.perAddress ?? process.platform === "win32") && o.host === "0.0.0.0";
  const servers = new Map<string, S>();
  let on = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const log = o.log ?? ((m: string) => console.log(m));

  /** Listen on what should be listened on now; the first error when nothing could be. */
  function sync(): string | null {
    const want = new Set(perAddress ? o.addresses() : [o.host]);
    let error: string | null = null;
    for (const [host, s] of servers) {
      if (want.has(host)) continue;
      s.stop(true);
      servers.delete(host);
      log(`[wifi] ${host} went away; stopped listening there`);
    }
    for (const host of want) {
      if (servers.has(host)) continue;
      try {
        servers.set(host, o.serve(host));
        if (perAddress) log(`[wifi] listening on ${host}`);
      } catch (e) {
        error ??= (e as Error).message;
        log(`[wifi] couldn't listen on ${host}: ${(e as Error).message}`);
      }
    }
    return servers.size === 0 ? (error ?? "no network address to listen on (is the Wi-Fi connected?)") : null;
  }

  return {
    start() {
      if (on) return null;
      const error = sync();
      if (error && servers.size === 0) return error;
      on = true;
      if (perAddress) {
        timer = setInterval(sync, o.everyMs ?? 5000);
        timer.unref?.();
      }
      return null;
    },
    stop() {
      on = false;
      clearInterval(timer);
      for (const s of servers.values()) s.stop(true);
      servers.clear();
    },
    get on() {
      return on;
    },
    has: (server) => [...servers.values()].some((s) => s === server),
    publish(topic, text) {
      for (const s of servers.values()) s.publish(topic, text);
    },
    get servers() {
      return [...servers.values()];
    },
  };
}
