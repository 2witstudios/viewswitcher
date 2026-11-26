// Every route the server has, each with the audience it is for (gate.ts) and the body it takes, in one
// table: the area files under routes/ each give theirs, and http/dispatch.ts applies the checks. A
// route that names no audience is for this Mac only, so a new route is closed until someone decides
// who else may use it.
//
// - mac (no audience named): what only this Mac may see or use: absolute paths (/api/info, the
//   Claude Desktop extension), the Mac app's pairing admin, the agents' /mcp.
// - paired: the switcher itself, for this Mac, the USB-C device and paired phones and tablets.
// - public: the pairing page and its POST.
import type { ServerMessage } from "@viewswitcher/shared";
import type { stdioLaunch } from "../agent-connect";
import type { BuiltinPackFiles } from "../builtin-packs";
import type { LibraryScanner } from "../library/scanner";
import type { Placer } from "../live/placement";
import type { LiveStore } from "../live/store";
import type { McpDeps } from "../mcp/server";
import type { OBSClient } from "../obs";
import type { setupObs } from "../obs-setup";
import type { Pairing } from "../pairing";
import type { Route } from "./dispatch";
import { agentRoutes } from "./routes/agent";
import { fileRoutes } from "./routes/files";
import { libraryRoutes } from "./routes/library";
import { liveRoutes } from "./routes/live";
import { packRoutes } from "./routes/packs";
import { pairingRoutes } from "./routes/pairing";
import type { Log } from "../log";

export type RouteDeps = {
  /** The library folder. */
  root: string;
  /** This Mac's state folder for the library: the agents' setting lives there (machine-state.ts). */
  machineState: string;
  /** Reads an org's content (its cache is the server's, shared with the MCP server). */
  scanner: LibraryScanner;
  /** The starter kit new orgs are made from. */
  starter: string;
  /** The built switcher. */
  webDist: string;
  /** OBS's scene and source names, and the port its program source loads. */
  obsNames: Parameters<typeof setupObs>[1];
  obsPort: number;
  store: LiveStore;
  obs: OBSClient;
  placer: Placer;
  /** Whether a program page's slot report is the newest from that page (slot-order.ts). */
  acceptSlots: (page: unknown, seq: unknown) => boolean;
  publish: (msg: ServerMessage) => void;
  builtins: () => Promise<BuiltinPackFiles[]>;
  starterScript: string | null;
  pairing: Pairing;
  /** Phones and tablets: what the Mac app's window shows, and the Wi-Fi setting (null, or why it couldn't listen). */
  remote: { status: () => object & { urls: string[]; localName: string | null }; setLan: (on: boolean) => string | null };
  /** Whether a request carries the Mac app's secret (the pairing admin). */
  isAdmin: (req: Request) => boolean;
  /** The port this server listens on. */
  port: () => number;
  /** What an agent runs to connect over stdio. */
  ownStdio: (port: number) => ReturnType<typeof stdioLaunch>;
  extensionVersion: string;
  mcp: { deps: McpDeps; allowedOrigins: string[]; onSeen: (client: string | null) => void };
  log?: Log;
};

export { secure } from "./routes/kit";
export { pairPageResponse } from "./routes/pairing";

/** The one table, in order: the public pairing routes, this Mac's, the switcher's, then files (the SPA catches the rest). */
export function routes(d: RouteDeps): Route[] {
  return [...pairingRoutes(d), ...agentRoutes(d), ...liveRoutes(d), ...libraryRoutes(d), ...packRoutes(d), ...fileRoutes(d)].map((r) => (r.method === "POST" ? changes(r, d.scanner) : r));
}

/**
 * A POST may change the library: once it's done, the next listing is scanned afresh, so a page that
 * lists the library after its own change (api.ts refreshed()) never gets a scan from before it.
 */
function changes(route: Route, scanner: LibraryScanner): Route {
  return {
    ...route,
    handler: async (c) => {
      try {
        return await route.handler(c);
      } finally {
        scanner.changed();
      }
    },
  };
}
