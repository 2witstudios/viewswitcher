// startServer's failures name their cause, so a slow or broken start on a CI runner explains itself.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, READY_MS, SERVER_START_MS, startServer } from "./test-server";

const library = mkdtempSync(join(tmpdir(), "vs-start-"));
const env = (port: number) => ({ PORT: String(port), OBS_URL: "ws://127.0.0.1:1", VIEWSWITCHER_USB: "0", VIEWSWITCHER_LIBRARY: library, VIEWSWITCHER_LAN: "" });
const listening = (port: number) =>
  new Promise<Server>((resolve, reject) => { const s = createServer().once("error", reject).listen(port, "127.0.0.1", () => resolve(s)); });
afterAll(() => rmSync(library, { recursive: true, force: true }));

describe("startServer", () => {
  test("a server that exits first is named, with the end of its stderr", async () => {
    const port = await freePort();
    const taken = await listening(port);
    try {
      const err = await startServer(env(port), async () => false).then(() => null, (e: Error) => e);
      expect(err?.message).toMatch(/^server exited with code \d+ before it was ready; its stderr ended:\n/);
      expect(err?.message).toMatch(/EADDRINUSE|in use/i);
    } finally {
      taken.close();
    }
  }, SERVER_START_MS);

  test("a server that exits while the last check hangs is named as exited, not slow", async () => {
    const port = await freePort();
    const taken = await listening(port);
    try {
      // Roomy: the server only has to fail its listen before the deadline, even on a slow runner.
      const err = await startServer(env(port), () => new Promise<boolean>(() => {}), { readyMs: 5_000 }).then(() => null, (e: Error) => e);
      expect(err?.message).toStartWith("server exited with code");
    } finally {
      taken.close();
    }
  }, SERVER_START_MS);

  test("a check that never answers still ends at the deadline", async () => {
    const t0 = Date.now();
    const err = await startServer(env(await freePort()), () => new Promise<boolean>(() => {}), { readyMs: 1_500 }).then(() => null, (e: Error) => e);
    expect(err?.message).toStartWith("server wasn't ready within 1.5 s");
    expect(Date.now() - t0).toBeLessThan(5_000);
  }, SERVER_START_MS);

  test("a server that ignores SIGTERM is killed, not left running, and the error still wins the hook", async () => {
    // A stand-in server: it writes its pid, never gets ready and shrugs off SIGTERM.
    const entry = join(library, "stubborn.ts");
    const pidFile = join(library, "stubborn.pid");
    writeFileSync(entry, `process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`);
    const t0 = Date.now();
    // Roomy: on a cold, busy runner Bun can take seconds to start the stub, and SIGTERM must reach it
    // only after it has set its handler, or this tests nothing.
    const err = await startServer({}, async () => existsSync(pidFile) && false, { readyMs: 5_000, entry }).then(() => null, (e: Error) => e);
    expect(err?.message).toStartWith("server wasn't ready within 5 s");
    expect(existsSync(pidFile)).toBe(true); // the stub was up, so SIGTERM met its handler and SIGKILL did the rest
    // SIGTERM grace, SIGKILL and the stderr drain fit inside the margin READY_MS leaves before the hook.
    expect(Date.now() - t0).toBeLessThan(5_000 + (SERVER_START_MS - READY_MS));
    const pid = Number(readFileSync(pidFile, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow(); // ESRCH: it's gone
  }, SERVER_START_MS);
});
