// The Mac app's server lifecycle, with stand-in servers on free ports (never 7420).
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectOrStart, PortTakenError, probe, ServerStartError } from "./server";

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
const dir = mkdtempSync(join(tmpdir(), "vs-mac-"));
const logFile = join(dir, "server.log");
/** A stand-in ViewSwitcher server: answers /api/state like the real one. */
const fakeServerScript = `Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.PORT), fetch: (r) => new URL(r.url).pathname === "/api/state" ? Response.json({ onAir: null, obs: {} }) : new Response("x") }); console.log("up");`;
const launch = (port: number, script = fakeServerScript) => ({ command: process.execPath, args: ["-e", script], env: { ...process.env, PORT: String(port) }, logFile });
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanup.splice(0)) await c();
});

describe("connectOrStart (MAC-6)", () => {
  test("nothing on the port: starts the server, owns it, and stop() frees the port", async () => {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    expect(await probe(base)).toBe("none");
    const s = await connectOrStart(base, launch(port));
    cleanup.push(() => s.stop());
    expect(s.owned).toBe(true);
    expect(await probe(base)).toBe("viewswitcher");
    expect(readFileSync(logFile, "utf8")).toContain("up");
    await s.stop();
    expect(await probe(base)).toBe("none");
  });

  test("a ViewSwitcher server already answers: attaches, and stop() leaves it running", async () => {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const theirs = Bun.spawn([process.execPath, "-e", fakeServerScript], { env: { ...process.env, PORT: String(port) }, stdout: "ignore" });
    cleanup.push(() => theirs.kill());
    for (let i = 0; i < 50 && (await probe(base)) !== "viewswitcher"; i++) await Bun.sleep(50);
    const s = await connectOrStart(base, launch(port));
    expect(s.owned).toBe(false);
    await s.stop();
    expect(alive(theirs.pid)).toBe(true);
    expect(await probe(base)).toBe("viewswitcher");
  });

  test("something else holds the port: says so instead of starting", async () => {
    const port = await freePort();
    const other = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("<html>not us</html>") });
    cleanup.push(() => other.stop(true));
    await expect(connectOrStart(`http://127.0.0.1:${port}`, launch(port))).rejects.toBeInstanceOf(PortTakenError);
  });

  test("a server that dies while starting reports its output", async () => {
    const port = await freePort();
    const err = await connectOrStart(`http://127.0.0.1:${port}`, launch(port, `console.error("library folder is not writable"); process.exit(3)`)).catch((e) => e);
    expect(err).toBeInstanceOf(ServerStartError);
    expect(err.message).toContain("library folder is not writable");
  });

  test("a crash after starting is reported through onExit", async () => {
    const port = await freePort();
    const s = await connectOrStart(`http://127.0.0.1:${port}`, launch(port, fakeServerScript + "setTimeout(() => process.exit(9), 300);"));
    const code = await new Promise((r) => (s.onExit = r));
    expect(code).toBe(9);
  });
});

process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
