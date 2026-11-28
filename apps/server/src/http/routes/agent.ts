// This Mac's own routes (no audience: only this Mac): /api/info (absolute paths, for the Mac app),
// what agent apps this Mac has, the Claude Desktop extension, and the agents' /mcp. Plus the agent
// on-air setting, which the switcher sets.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { claudeCodeCommand, commandLine, detectClients, mcpbFile, mcpbManifest } from "../../agent-connect";
import { handleMcp } from "../../mcp/http";
import { appParent } from "../../parent-watch";
import { writeSettings } from "../../settings";
import type { Route } from "../dispatch";
import type { RouteDeps } from "../routes";
import { json, post } from "./kit";

export function agentRoutes(d: RouteDeps): Route[] {
  const { root, store } = d;
  return [
    {
      // For the Mac app's menu (Open Library Folder) and Edit with AI's commands: with the Claude Desktop
      // extension below, the only responses with absolute paths in them.
      method: "GET",
      path: "/api/info",
      // sidecar, parentPid and pid let a relaunched app find and replace an orphan it started before.
      handler: () =>
        json({ library: root, port: d.port(), sidecar: appParent() !== null, parentPid: appParent(), pid: process.pid, claudeCode: claudeCodeCommand(root, homedir()), stdio: commandLine(d.ownStdio(d.port())) }),
    },
    {
      // Which agent apps this Mac has, so Edit with AI lists them first. Booleans only.
      method: "GET",
      path: "/api/agent/clients",
      handler: () => json(detectClients({ home: homedir(), path: process.env.PATH ?? "", exists: existsSync, localAppData: process.env.LOCALAPPDATA, programFiles: process.env.ProgramFiles, appData: process.env.APPDATA })),
    },
    {
      // Add to Claude Desktop: an extension made for this install, whose command is this server's own executable.
      method: "GET",
      path: "/api/agent/viewswitcher.mcpb",
      handler: () => {
        const file = mcpbFile(mcpbManifest({ launch: d.ownStdio(d.port()), version: d.extensionVersion }));
        return new Response(file, { headers: { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="ViewSwitcher.mcpb"', "cache-control": "no-store" } });
      },
    },
    {
      // The agents' MCP server. Its handler checks once more that this is this Mac (mcp/http.ts).
      method: "ANY",
      path: "/mcp",
      handler: (c) => {
        // No idle timeout for agents' calls: Bun drops a connection that's quiet for 10 s, and a tool
        // call can be quiet longer than that (previews run one at a time, ~1.5 s each, so a few in
        // parallel queue up), which the agent would see as a transport error, not an answer.
        c.srv.timeout(c.req, 0);
        return handleMcp(c.req, c.peer, d.mcp);
      },
    },

    // What agents connected over MCP may put on air (agent-guard.ts); people in the switcher are never limited.
    post("/api/agent/settings", async (b) => {
      const s = await writeSettings(d.machineState, { agentOnAir: b.onAir });
      store.update({ agent: { ...store.state.agent, onAir: s.agentOnAir } });
      return store.state.agent;
    }),
  ];
}
