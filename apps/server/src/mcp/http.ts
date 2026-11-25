// POST /mcp: MCP over Streamable HTTP, stateless with JSON responses. Every request gets a fresh
// server and transport, so there are no sessions to keep or lose when the switcher restarts.
// Only this Mac's own agents may use it: never through tailscale serve or from another machine,
// and never from a web page at another site.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AgentStatus } from "@viewswitcher/shared";
import { isLocalRequest, type Peer } from "../local";
import { originAllowed } from "../origin";
import { createMcpServer, type McpDeps } from "./server";

export type McpHttpOptions = {
  deps: McpDeps;
  /** VIEWSWITCHER_ORIGINS (see origin.ts). */
  allowedOrigins: string[];
  /** Every MCP request, with the client's name when it's an initialize. */
  onSeen: (client: string | null) => void;
};

/** A base64 asset of 15 MB plus the JSON around it. */
const MAX_BODY = 24 * 1024 * 1024;

const refuse = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
const rpcError = (status: number, code: number, message: string) =>
  Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status, headers: { "cache-control": "no-store" } });

/** The client's name from an initialize request (alone or in a batch). */
export function clientName(body: unknown): string | null {
  for (const m of Array.isArray(body) ? body : [body]) {
    const name = m?.method === "initialize" ? m?.params?.clientInfo?.name : undefined;
    if (typeof name === "string" && name.trim()) return name.trim().slice(0, 80);
  }
  return null;
}

/**
 * The agent status after an MCP request at `now`, and whether it's worth telling the switchers:
 * when the client changes, or when the last one was over a minute ago (so it doesn't spam).
 */
export function noteSeen(prev: AgentStatus, client: string | null, now: number): { agent: AgentStatus; publish: boolean } {
  const changed = client !== null && client !== prev.client;
  const stale = prev.lastSeen === null || now - prev.lastSeen > 60_000;
  return { agent: { ...prev, lastSeen: now, client: client ?? prev.client }, publish: changed || stale };
}

export async function handleMcp(req: Request, peer: Peer, opts: McpHttpOptions): Promise<Response> {
  if (!isLocalRequest(req, peer)) return refuse(404, "Not found");
  const origin = req.headers.get("origin");
  if (origin !== null && !originAllowed(origin, { host: req.headers.get("host"), forwardedHost: req.headers.get("x-forwarded-host"), extra: opts.allowedOrigins })) {
    return refuse(403, "Not allowed from this page");
  }
  // Stateless: no server-sent event stream to open and no session to end.
  if (req.method !== "POST") return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }), { status: 405, headers: { allow: "POST", "content-type": "application/json" } });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return rpcError(413, -32000, "Request too large");
  const raw = await req.text();
  if (raw.length > MAX_BODY) return rpcError(413, -32000, "Request too large");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return rpcError(400, -32700, "Parse error");
  }
  opts.onSeen(clientName(body));

  const server = createMcpServer(opts.deps);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    return await transport.handleRequest(req, { parsedBody: body });
  } finally {
    // The JSON response is complete once handleRequest resolves.
    await server.close().catch(() => {});
  }
}
