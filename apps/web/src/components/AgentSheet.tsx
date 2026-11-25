// Edit with AI (MCP-10, MCP-11): connect the agent people already use, see whether one is connected,
// and choose what agents may put on air. Opened from the header, "ask your agent" hints, and the Mac
// app's Edit with AI… menu item (/?ai or #ai).
import type { AgentClients, AgentOnAir } from "@viewswitcher/shared";
import { type ReactNode, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { type AgentInfo, api, copy, MCPB_URL } from "../lib/api";
import {
  agentStatusText, codexToml, CONNECTED_FOR_MS, cursorDeeplink, DEFAULT_CLAUDE_CODE, defaultStdio, mcpUrl, inOrder, ON_AIR_CHOICES, ON_AIR_SCOPE, otherPortNote, pendingChoice, shownChoice, SETUP_GUIDE_URL, sheetParts, type Way, waysIn,
  wantsAgentSheet, withoutAgentSheet,
} from "../lib/agent";
import { clientKind } from "../lib/client-kind";
import { useLive } from "../lib/live";
import { toast } from "./ui";
import { trapTab } from "../lib/modal";

// ---------------------------------------------------------------- open / close, from anywhere

let open = false;
const listeners = new Set<() => void>();
const setOpen = (v: boolean) => {
  open = v;
  listeners.forEach((l) => l());
};
export const openAgentSheet = () => setOpen(true);

/** Take ?ai / #ai off the URL and open the sheet. Runs before the router reads the URL, and on #ai later. */
function fromUrl() {
  if (!wantsAgentSheet(location.search, location.hash)) return;
  const { search, hash } = withoutAgentSheet(location.search, location.hash);
  history.replaceState(history.state, "", `${location.pathname}${search}${hash}`);
  setOpen(true);
}
if (typeof window !== "undefined") {
  fromUrl();
  addEventListener("hashchange", fromUrl);
}

/** "ask your agent" in a hint: opens Edit with AI, and reads as the plain words it is. */
export function AskAgent({ children = "ask your agent" }: { children?: ReactNode }) {
  return <button type="button" className="text-link" onClick={openAgentSheet}>{children}</button>;
}

export const SparkleIcon = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" /></svg>
);

// ---------------------------------------------------------------- the sheet

/** One settings request at a time, in the order they're made (lib/agent.ts inOrder). */
const settingsInOrder = inOrder();
const kind = typeof navigator !== "undefined" ? clientKind(navigator.userAgent) : "browser";
const inMacApp = kind === "mac";

export function AgentSheet() {
  const isOpen = useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => open);
  return isOpen ? <Sheet onClose={() => setOpen(false)} /> : null;
}

function Sheet({ onClose }: { onClose: () => void }) {
  const { state } = useLive();
  const parts = sheetParts(kind);
  const [now, setNow] = useState(Date.now);
  // undefined while asking; null when this isn't the Mac running ViewSwitcher (another machine).
  const [info, setInfo] = useState<AgentInfo | null | undefined>(undefined);
  const [clients, setClients] = useState<AgentClients | null>(null);

  const dialog = useRef<HTMLElement>(null);
  // Focus moves into the sheet and back to where it was on close; Tab stays inside it. (The editor
  // behind ignores keys while it's open: lib/modal.ts.)
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => before?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab" || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll<HTMLElement>("a[href], button, input:not([disabled]), [tabindex]:not([tabindex='-1'])")];
      const next = trapTab(items, document.activeElement as HTMLElement | null, e.shiftKey);
      if (next) {
        e.preventDefault();
        next.focus();
      }
    };
    addEventListener("keydown", onKey);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => (removeEventListener("keydown", onKey), clearInterval(tick));
  }, [onClose]);
  useEffect(() => {
    if (!parts.waysIn) return;
    api.info().then(setInfo);
    api.agentClients().then(setClients);
  }, [parts.waysIn]);

  const agent = state?.agent;
  const connected = !!agent?.lastSeen && now - agent.lastSeen <= CONNECTED_FOR_MS;
  // What was clicked, until its request is answered (lib/agent.ts pendingChoice).
  const [pending, dispatch] = useReducer(pendingChoice, null);
  const picks = useRef(0);
  const shown = shownChoice(pending, agent?.onAir);
  useEffect(() => dispatch({ t: "published", value: agent?.onAir }), [agent?.onAir]);
  const setOnAir = async (v: AgentOnAir) => {
    const id = ++picks.current;
    dispatch({ t: "pick", value: v, id });
    let ok = true;
    try {
      await settingsInOrder(() => api.agentSettings(v));
    } catch (e) {
      ok = false;
      toast((e as Error).message);
    }
    dispatch({ t: "answered", id, ok });
    setTimeout(() => dispatch({ t: "expire", id }), 3000);
  };

  return (
    <div className="modal-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={dialog} tabIndex={-1} className="modal agent-sheet" role="dialog" aria-modal="true" aria-labelledby="agent-sheet-title">
        <div className="agent-head">
          <h2 id="agent-sheet-title">Edit with AI</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a3a8b5" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <p className={`agent-status${connected ? " on" : ""}`} role="status"><span className="dot" />{agentStatusText(agent, now)}</p>
        <p className="agent-lede">Connect the AI agent you already use. It reads your library, adds template sets, makes scenes from your templates and edits them, looks at each one rendered in OBS and fixes what it sees.</p>

        {parts.connectOnMac && <p className="agent-note">Connect an agent on your Mac: open Edit with AI there.</p>}
        {parts.waysIn && <WaysIn info={info} clients={clients} />}

        {parts.onAirSetting && (
          <fieldset className="agent-onair">
            <legend>Agents put scenes on air</legend>
            {ON_AIR_CHOICES.map((c) => (
              <label key={c.value} className="agent-choice">
                <input type="radio" name="agent-onair" value={c.value} checked={shown === c.value} disabled={!agent} onChange={() => setOnAir(c.value)} />
                <span><b>{c.label}</b><small>{c.hint}</small></span>
              </label>
            ))}
            <small className="agent-scope">{ON_AIR_SCOPE}</small>
          </fieldset>
        )}

        {parts.setupGuide && (
          // A plain link out: the Mac app opens it in the browser (NavigationPolicy), like any web link.
          <a className="agent-guide" href={SETUP_GUIDE_URL} target="_blank" rel="noopener noreferrer">Setup guide</a>
        )}
      </section>
    </div>
  );
}

/** `pending`: the text isn't known yet (this Mac's details are still on their way): shown as such, not copyable. */
function Copyable({ label, text, multiline = false, pending = false }: { label: string; text: string; multiline?: boolean; pending?: boolean }) {
  return (
    <div className="agent-copy">
      {multiline ? <pre aria-label={label}>{text}</pre> : <code aria-label={label}>{pending ? "…" : text}</code>}
      <button type="button" className="btn small" disabled={pending} onClick={async () => (await copy(text)) && toast("Copied")}>Copy</button>
    </div>
  );
}

const TITLES: Record<Way, string> = { "claude-code": "Claude Code", "claude-desktop": "Claude Desktop", cursor: "Cursor", others: "Codex, VS Code and other agents" };

function WaysIn({ info, clients }: { info: AgentInfo | null | undefined; clients: AgentClients | null }) {
  const port = info?.port ?? (location.port || 7420);
  const url = mcpUrl(port);
  const elsewhere = info === null;
  const stdio = info?.stdio ?? defaultStdio(port);
  const portNote = otherPortNote(port);

  const body = (way: Way) => {
    switch (way) {
      case "claude-code":
        return (
          <>
            <p>In Terminal, start Claude Code in your library folder. The library's <code>.mcp.json</code> connects it to ViewSwitcher; the first time, Claude Code asks you once to allow the <b>viewswitcher</b> server.</p>
            <Copyable label="Claude Code command" text={info?.claudeCode ?? DEFAULT_CLAUDE_CODE} pending={info === undefined} />
            {portNote && <p className="agent-note">{portNote}</p>}
          </>
        );
      case "claude-desktop":
        return elsewhere ? (
          <p>Open Edit with AI on the Mac that runs ViewSwitcher to add it there.</p>
        ) : (
          <>
            <p>Adds ViewSwitcher to Claude Desktop as an extension made for this Mac. {inMacApp ? "Claude Desktop opens and asks you to install it." : "Open the downloaded file and Claude Desktop asks you to install it."}</p>
            <div className="agent-actions">
              <a className="btn small primary" href={MCPB_URL} download="ViewSwitcher.mcpb">Add to Claude Desktop</a>
            </div>
          </>
        );
      case "cursor":
        return (
          <>
            <p>Opens Cursor and asks you to add the ViewSwitcher server. Opening your library folder in Cursor works too: its <code>.cursor/mcp.json</code> connects it.</p>
            <div className="agent-actions">
              <a className="btn small primary" href={cursorDeeplink(url)}>Add to Cursor</a>
            </div>
          </>
        );
      case "others":
        return (
          <>
            <p>Any MCP client on this Mac: the Streamable HTTP address, or the stdio command.</p>
            <Copyable label="MCP address" text={url} />
            <Copyable label="stdio command" text={stdio} pending={info === undefined} />
            <p>Codex: add this to <code>~/.codex/config.toml</code>.</p>
            <Copyable label="Codex config" text={codexToml(url)} multiline />
          </>
        );
    }
  };

  return (
    <div className="agent-ways">
      {elsewhere && <p className="agent-note">These connect an agent on the Mac that runs ViewSwitcher; the switcher only lets agents in from that Mac.</p>}
      {waysIn(clients).map(({ way, installed }) => (
        <section key={way} className="agent-way" aria-label={TITLES[way]}>
          <h3>{TITLES[way]}{installed && <span className="agent-here">On this Mac</span>}</h3>
          {body(way)}
        </section>
      ))}
    </div>
  );
}
