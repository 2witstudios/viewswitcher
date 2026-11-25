import type { ReactNode } from "react";
import { api } from "../lib/api";
import { setLibraryOpen, useLibraryOpen } from "../lib/library-sheet";
import { appLink, useLive } from "../lib/live";
import { openAgentSheet, SparkleIcon } from "./AgentSheet";
import { PencilIcon } from "./icons";
import { useOpenEditor } from "./SceneTile";
import { SetupCard } from "./SetupCard";
import { attempt } from "./ui";

export function PageHead({ crumb, title }: { crumb: ReactNode; title: string }) {
  const { state, connected } = useLive();
  const obs = state?.obs;
  const onAir = state?.onAir;
  const openEditor = useOpenEditor();
  const libraryOpen = useLibraryOpen();
  return (
    <>
      <header className="page-head">
        <div className="titles">
          <span className="crumb">{crumb}</span>
          <h1 className="title">{title}</h1>
          {/* On a phone the title is the stream picker: it opens the library (PHONE-3, PHONE-12). */}
          <button type="button" className="stream-pick" aria-expanded={libraryOpen} aria-controls="side-body" onClick={() => setLibraryOpen(!libraryOpen)}>
            <span className="crumb">{crumb}</span>
            <span className="title">{title}<ChevronIcon /></span>
          </button>
        </div>
        <div className="livebar">
          <span className={`pill${onAir ? "" : " off"}`}>
            <span className="dot" />
            {connected ? (onAir ? `On air: ${onAir.label}` : "Nothing on air") : "Reconnecting…"}
          </span>
          <button type="button" className="out-btn ai-btn" onClick={openAgentSheet}>
            <SparkleIcon />EDIT WITH AI
          </button>
          {onAir && connected && (
            <button type="button" className="out-btn edit-onair" aria-label={`Edit ${onAir.label}, on air`} onClick={() => openEditor(onAir.path)}>
              <PencilIcon />EDIT
            </button>
          )}
          <button type="button" className={`out-btn${obs?.recording ? " on" : ""}`} disabled={!obs?.connected} aria-pressed={!!obs?.recording}
            onClick={() => attempt(api.toggleRecord)}>
            <span className="dot" />REC
          </button>
          <button type="button" className={`out-btn${obs?.streaming ? " on" : ""}`} disabled={!obs?.connected} aria-pressed={!!obs?.streaming}
            onClick={() => (obs?.streaming || confirm("Start streaming?")) && attempt(api.toggleStream)}>
            <span className="dot" />{obs?.streaming ? "LIVE" : "GO LIVE"}
          </button>
          {appLink && <span className="pill link" title={appLink === "USB" ? "USB-C" : "Network"}>{appLink}</span>}
          {!obs?.connected && <span className="pill off" title="Enable OBS's WebSocket server"><span className="dot" />OBS offline</span>}
          {!appLink && state?.usb.attached && (
            // PHONE-8: named for the device plugged in (iPhone or iPad); an unknown one reads as before.
            <span className={`pill link${state.usb.connected ? "" : " off"}`} title={state.usb.connected ? "USB-C" : `Open ViewSwitcher on the ${state.usb.device ?? "iPad"}`}>
              {(state.usb.device ?? "iPad").toUpperCase()} · {state.usb.connected ? "USB" : "OPEN APP"}
            </span>
          )}
        </div>
      </header>
      {!!state?.warnings.length && (
        <div className="warnings" role="alert">
          {state.warnings.map((w) => <span key={w}>{w}</span>)}
        </div>
      )}
      <SetupCard />
    </>
  );
}

const ChevronIcon = () => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
);
