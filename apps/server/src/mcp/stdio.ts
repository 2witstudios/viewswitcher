// `viewswitcher-server --mcp-stdio`: for agents that start MCP servers as a command (Claude Desktop,
// Codex). It never runs a server of its own: it relays newline-delimited JSON-RPC between stdin/stdout
// and the running switcher's /mcp, opening the ViewSwitcher app if nothing answers. Only JSON-RPC
// ever goes to stdout; anything else goes to stderr.
//
// index.ts imports this before anything else (no library, no OBS, no Bun.serve), so keep its imports
// to what the relay itself needs.

export const MAC_APP_ID = "com.twowitstudios.viewswitcher.mac";
export const NOT_RUNNING = "ViewSwitcher isn't running. Open ViewSwitcher on this Mac, then try again.";

export type RelayOptions = {
  port: number;
  input: AsyncIterable<string | Uint8Array>;
  /** One JSON-RPC message, already serialized, without the newline. */
  write: (line: string) => void;
  log?: (message: string) => void;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Opens the ViewSwitcher app; tried once per relay. */
  openApp?: () => Promise<unknown>;
  /** How long to wait for the switcher after opening the app. */
  waitMs?: number;
  pollMs?: number;
};

type Message = { jsonrpc?: string; id?: string | number | null; method?: string; [k: string]: unknown };

const openMacApp = () => Bun.spawn(["open", "-b", MAC_APP_ID], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).exited;

/** The ids of the requests in a message or batch (notifications and responses have none to answer). */
const requestIds = (body: unknown): (string | number)[] =>
  (Array.isArray(body) ? body : [body]).flatMap((m: Message) => (m && typeof m.method === "string" && (typeof m.id === "string" || typeof m.id === "number") ? [m.id] : []));

const errorFor = (id: string | number | null, message: string, code = -32000) => JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });

export async function relayStdio(opts: RelayOptions): Promise<void> {
  const f = opts.fetch ?? fetch;
  const log = opts.log ?? (() => {});
  const base = `http://127.0.0.1:${opts.port}`;
  const waitMs = opts.waitMs ?? 15_000;
  const pollMs = opts.pollMs ?? 250;

  const up = () => f(`${base}/api/state`).then((r) => r.ok, () => false);
  let opened = false;
  let waking: Promise<boolean> | null = null;
  /** After a request found nothing listening: open the app (the first time only) and wait for it. */
  const wake = () =>
    (waking ??= (async () => {
      try {
        if (await up()) return true;
        if (opened) return false;
        opened = true;
        log("[mcp] ViewSwitcher isn't answering; opening it");
        await (opts.openApp ?? openMacApp)().catch((e) => log(`[mcp] couldn't open ViewSwitcher: ${(e as Error).message}`));
        for (const end = Date.now() + waitMs; Date.now() < end; await Bun.sleep(pollMs)) if (await up()) return true;
        return false;
      } finally {
        waking = null;
      }
    })());

  const post = (raw: string) =>
    f(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: raw });

  const emit = (m: unknown) => opts.write(JSON.stringify(m));

  async function relay(raw: string) {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return opts.write(errorFor(null, "Parse error", -32700));
    }
    const ids = requestIds(body);
    let res: Response;
    try {
      res = await post(raw).catch(async (e) => {
        if (!(await wake())) throw e;
        return post(raw);
      });
    } catch {
      for (const id of ids) opts.write(errorFor(id, NOT_RUNNING));
      return;
    }
    const text = await res.text().catch(() => "");
    const messages: unknown[] = [];
    if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
      for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        try {
          messages.push(JSON.parse(line.slice(5)));
        } catch {}
      }
    } else if (text.trim()) {
      try {
        const parsed = JSON.parse(text);
        messages.push(...(Array.isArray(parsed) ? parsed : [parsed]));
      } catch {}
    }
    const rpc = messages.filter((m): m is Message => !!m && typeof m === "object" && (m as Message).jsonrpc === "2.0");
    // A refusal before any MCP processing (a JSON { error }, or a JSON-RPC error with no id) still
    // answers each request, so the agent isn't left waiting.
    const answered = new Set(rpc.map((m) => m.id));
    for (const m of rpc) if (m.id !== null && m.id !== undefined) emit(m);
    const unanswered = ids.filter((id) => !answered.has(id));
    if (unanswered.length) {
      const general = rpc.find((m) => m.id === null || m.id === undefined) as { error?: { message?: string } } | undefined;
      const error = (messages[0] as { error?: unknown } | undefined)?.error;
      const why = general?.error?.message ?? (typeof error === "string" ? error : `ViewSwitcher answered ${res.status}`);
      for (const id of unanswered) opts.write(errorFor(id, why));
    } else if (!ids.length && !res.ok) {
      log(`[mcp] ViewSwitcher answered ${res.status}: ${text.slice(0, 200)}`);
    }
  }

  const pending = new Set<Promise<void>>();
  const start = (line: string) => {
    if (!line.trim()) return;
    const p = relay(line.trim()).catch((e) => log(`[mcp] ${(e as Error).message}`));
    pending.add(p);
    p.finally(() => pending.delete(p));
  };
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of opts.input) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      start(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  start(buffer + decoder.decode());
  while (pending.size) await Promise.all(pending);
}

/** The --mcp-stdio entry point. */
export async function main() {
  // Nothing but JSON-RPC on stdout, even from a stray log line.
  console.log = console.info = console.debug = console.warn = console.error;
  const port = Number(process.env.PORT ?? 7420);
  await relayStdio({
    port,
    input: process.stdin,
    write: (line) => process.stdout.write(line + "\n"),
    log: (m) => process.stderr.write(m + "\n"),
  });
}
