import type { ReactNode } from "react";
import { api } from "../lib/api";
import { appLink, useLive } from "../lib/live";
import { PencilIcon, useOpenEditor } from "./SceneTile";
import { SetupCard } from "./SetupCard";
import { attempt } from "./ui";

export function PageHead({ crumb, title }: { crumb: ReactNode; title: string }) {
  const { state, connected } = useLive();
  const obs = state?.obs;
  const onAir = state?.onAir;
  const openEditor = useOpenEditor();
  return (
    <>
      <header className="page-head">
        <div className="titles">
          <span className="crumb">{crumb}</span>
          <h1 className="title">{title}</h1>
        </div>
        <div className="livebar">
          <span className={`pill${onAir ? "" : " off"}`}>
            <span className="dot" />
            {connected ? (onAir ? `On air: ${onAir.label}` : "Nothing on air") : "Reconnecting…"}
          </span>
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
            <span className={`pill link${state.usb.connected ? "" : " off"}`} title={state.usb.connected ? "USB-C" : "Open ViewSwitcher on the iPad"}>
              {state.usb.connected ? "IPAD · USB" : "IPAD · OPEN APP"}
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
