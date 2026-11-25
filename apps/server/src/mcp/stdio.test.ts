// The stdio relay against a stub /mcp, and `index.ts --mcp-stdio` as a process: it only relays,
// never sets up a library or starts a server of its own.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bypassProxies, DROPPED, NOT_RUNNING, relayPort, relayStdio } from "./stdio";

type Stub = { port: number; posts: unknown[]; stop: () => void };
/** A stand-in for the switcher: /api/state, and /mcp that answers requests in JSON (or `answer`). */
function stub(port = 0, answer?: (body: unknown) => Response | Promise<Response>): Stub {
  const posts: unknown[] = [];
  const s = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/api/state") return Response.json({ onAir: null });
      if (path !== "/mcp" || req.method !== "POST") return new Response("no", { status: 404 });
      const body = (await req.json()) as { id?: unknown; method?: string } | { id?: unknown; method?: string }[];
      posts.push(body);
      if (answer) return answer(body);
      const reply = (m: { id?: unknown; method?: string }) => ({ jsonrpc: "2.0", id: m.id, result: { echo: m.method } });
      if (Array.isArray(body)) return Response.json(body.filter((m) => m.id !== undefined).map(reply));
      if (body.id === undefined) return new Response(null, { status: 202 });
      return Response.json(reply(body));
    },
  });
  return { port: s.port!, posts, stop: () => s.stop(true) };
}

const freePort = () =>
  new Promise<number>((r) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => r(p));
    });
  });

async function* lines(...ls: string[]) {
  for (const l of ls) yield l + "\n";
}

async function relay(port: number, input: AsyncIterable<string | Uint8Array>, extra: Partial<Parameters<typeof relayStdio>[0]> = {}) {
  const out: string[] = [];
  await relayStdio({ port, input, write: (l) => out.push(l), ...extra });
  return out.map((l) => JSON.parse(l));
}

describe("relayStdio", () => {
  test("relays requests and answers, line by line; notifications get no answer", async () => {
    const s = stub();
    const out = await relay(s.port, lines(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      "",
      JSON.stringify({ jsonrpc: "2.0", id: "b", method: "tools/list" }),
    ));
    s.stop();
    expect(out.sort((a, b) => String(a.id).localeCompare(String(b.id)))).toEqual([
      { jsonrpc: "2.0", id: 1, result: { echo: "initialize" } },
      { jsonrpc: "2.0", id: "b", result: { echo: "tools/list" } },
    ]);
    expect(s.posts).toHaveLength(3);
  });
  test("lines split across chunks, and batches", async () => {
    const s = stub();
    const msg = JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "a" }, { jsonrpc: "2.0", id: 2, method: "b" }]);
    async function* chunks() {
      yield new TextEncoder().encode(msg.slice(0, 10));
      yield msg.slice(10) + "\n";
    }
    const out = await relay(s.port, chunks());
    s.stop();
    expect(out.map((m) => m.id).sort()).toEqual([1, 2]);
  });
  test("bad JSON on stdin gets a parse error, not silence", async () => {
    const out = await relay(1, lines("{nope"));
    expect(out).toEqual([{ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }]);
  });
  test("a refusal from the switcher (no JSON-RPC body) still answers the request", async () => {
    const s = stub(0, () => Response.json({ error: "Not found" }, { status: 404 }));
    const out = await relay(s.port, lines(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" })));
    s.stop();
    expect(out).toEqual([{ jsonrpc: "2.0", id: 4, error: { code: -32000, message: "Not found" } }]);
  });
  test("an SSE answer is relayed as plain lines", async () => {
    const s = stub(0, (b) => new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: (b as { id: number }).id, result: {} })}\n\n`, { headers: { "content-type": "text/event-stream" } }));
    const out = await relay(s.port, lines(JSON.stringify({ jsonrpc: "2.0", id: 8, method: "ping" })));
    s.stop();
    expect(out).toEqual([{ jsonrpc: "2.0", id: 8, result: {} }]);
  });
  test("nothing answering: opens ViewSwitcher once, waits for it, then relays", async () => {
    const port = await freePort();
    let opened = 0;
    let s: Stub | null = null;
    const out = await relay(port, lines(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }), JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })), {
      openApp: async () => {
        opened++;
        setTimeout(() => (s = stub(port)), 150); // the app takes a moment to start its server
      },
      waitMs: 5000,
      pollMs: 25,
    });
    (s as Stub | null)?.stop();
    expect(opened).toBe(1);
    expect(out.map((m) => m.id).sort()).toEqual([1, 2]);
    expect(out.every((m) => m.result)).toBe(true);
  });
  test("still nothing after the wait: each request says to open ViewSwitcher, and the app is opened only once", async () => {
    const port = await freePort();
    let opened = 0;
    const input = (async function* () {
      yield JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }) + "\n";
      yield JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n";
      await Bun.sleep(300); // after the first wait gave up
      yield JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n";
    })();
    const out = await relay(port, input, { openApp: async () => void opened++, waitMs: 150, pollMs: 25 });
    expect(opened).toBe(1);
    expect(out).toEqual([
      { jsonrpc: "2.0", id: 1, error: { code: -32000, message: NOT_RUNNING } },
      { jsonrpc: "2.0", id: 2, error: { code: -32000, message: NOT_RUNNING } },
    ]);
    expect(NOT_RUNNING).toContain("Open ViewSwitcher on this Mac");
  });
  test("a call that reached the server is never sent twice: a dropped connection is answered, not retried", async () => {
    // A switcher that reads the request, then drops the connection before answering (Restart Server mid-call).
    let received = 0;
    const s = createServer((sock) => {
      sock.on("data", () => {
        received++;
        sock.destroy();
      });
    });
    const port = await new Promise<number>((r) => s.listen(0, "127.0.0.1", () => r((s.address() as { port: number }).port)));
    let opened = 0;
    const out = await relay(port, lines(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "duplicate_scene" } })), { openApp: async () => void opened++, waitMs: 100, pollMs: 25 });
    s.close();
    expect(received).toBe(1);
    expect(opened).toBe(0);
    expect(out).toEqual([{ jsonrpc: "2.0", id: 7, error: { code: -32000, message: DROPPED } }]);
  });
});

describe("bypassProxies", () => {
  test("loopback is added to NO_PROXY and no_proxy, keeping what's there", () => {
    const env: Record<string, string | undefined> = { NO_PROXY: "example.com" };
    bypassProxies(env);
    expect(env.NO_PROXY).toBe("example.com,127.0.0.1,localhost,::1");
    expect(env.no_proxy).toBe("127.0.0.1,localhost,::1");
    bypassProxies(env);
    expect(env.NO_PROXY).toBe("example.com,127.0.0.1,localhost,::1");
  });
});

describe("relayPort", () => {
  test("--port, then VIEWSWITCHER_PORT, then 7420; never PORT", () => {
    expect(relayPort(["bun", "index.ts", "--mcp-stdio", "--port", "7433"], { PORT: "3000", VIEWSWITCHER_PORT: "7440" })).toBe(7433);
    expect(relayPort(["x", "--mcp-stdio", "--port=7434"], {})).toBe(7434);
    expect(relayPort(["x", "--mcp-stdio"], { PORT: "3000", VIEWSWITCHER_PORT: "7440" })).toBe(7440);
    expect(relayPort(["x", "--mcp-stdio"], { PORT: "3000" })).toBe(7420);
    for (const bad of ["", "abc", "0", "70000", "-1"]) expect(relayPort(["x", "--port", bad], {})).toBe(7420);
  });
});

describe("index.ts --mcp-stdio", () => {
  const library = mkdtempSync(join(tmpdir(), "vs-stdio-"));
  afterAll(() => rmSync(library, { recursive: true, force: true }));

  test("relays to the switcher on --port (not the agent's PORT), prints only JSON-RPC, and never starts a server or touches the library", async () => {
    const s = stub();
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, "..", "index.ts"), "--mcp-stdio", "--port", String(s.port)], {
      env: { ...process.env, PORT: "1", VIEWSWITCHER_LIBRARY: library, VIEWSWITCHER_USB: "0", OBS_URL: "ws://127.0.0.1:1", VIEWSWITCHER_LOG: "1" },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
    proc.stdin.end();
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    s.stop();
    expect(code).toBe(0);
    const out = stdout.split("\n").filter(Boolean);
    expect(out).toHaveLength(2);
    for (const l of out) expect(JSON.parse(l).jsonrpc).toBe("2.0");
    expect(s.posts).toHaveLength(3);
    // The real server would have set up the library (kit, first org) before anything else.
    expect(readdirSync(library)).toEqual([]);
  });

  test("an agent's HTTP_PROXY is never used: the calls go straight to this Mac's switcher", async () => {
    const s = stub();
    let proxied = 0;
    const proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => (proxied++, new Response("proxy", { status: 502 })) });
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, "..", "index.ts"), "--mcp-stdio", "--port", String(s.port)], {
      env: { ...process.env, HTTP_PROXY: `http://127.0.0.1:${proxy.port}`, http_proxy: `http://127.0.0.1:${proxy.port}`, ALL_PROXY: `http://127.0.0.1:${proxy.port}`, VIEWSWITCHER_LIBRARY: library },
      stdin: new Blob([JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n"]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    s.stop();
    proxy.stop(true);
    expect(proxied).toBe(0);
    expect(JSON.parse(stdout.trim()).result).toEqual({ echo: "tools/list" });
  });

  test("stdin closing while answers are still on their way: every answer is written before it exits", async () => {
    // Slow answers, one of them big, and stdin at EOF straight away (like `printf ... | viewswitcher-server --mcp-stdio`).
    const big = "x".repeat(512 * 1024);
    const s = stub(0, async (b) => {
      await Bun.sleep(400);
      const m = b as { id?: number };
      return m.id === undefined ? new Response(null, { status: 202 }) : Response.json({ jsonrpc: "2.0", id: m.id, result: { big: m.id === 2 ? big : "" } });
    });
    const input = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ].map((m) => JSON.stringify(m) + "\n").join("");
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, "..", "index.ts"), "--mcp-stdio"], {
      env: { ...process.env, VIEWSWITCHER_PORT: String(s.port), VIEWSWITCHER_LIBRARY: library },
      stdin: new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    s.stop();
    expect(code).toBe(0);
    const out = stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(out.map((m) => m.id).sort()).toEqual([1, 2]);
    expect(out.find((m) => m.id === 2).result.big).toBe(big);
  });
});
