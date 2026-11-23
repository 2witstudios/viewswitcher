import type { ReactNode } from "react";
import { api } from "../lib/api";
import { useLive } from "../lib/live";
import { attempt } from "./ui";

export function PageHead({ crumb, title }: { crumb: ReactNode; title: string }) {
  const { state, connected } = useLive();
  const obs = state?.obs;
  const onAir = state?.onAir;
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
          <button type="button" className={`out-btn${obs?.recording ? " on" : ""}`} disabled={!obs?.connected} aria-pressed={!!obs?.recording}
            onClick={() => attempt(api.toggleRecord)}>
            <span className="dot" />REC
          </button>
          <button type="button" className={`out-btn${obs?.streaming ? " on" : ""}`} disabled={!obs?.connected} aria-pressed={!!obs?.streaming}
            onClick={() => (obs?.streaming || confirm("Start streaming?")) && attempt(api.toggleStream)}>
            <span className="dot" />{obs?.streaming ? "LIVE" : "GO LIVE"}
          </button>
          {!obs?.connected && <span className="pill off" title="Open OBS with Tools → WebSocket Server Settings enabled"><span className="dot" />OBS offline</span>}
        </div>
      </header>
      {!!state?.warnings.length && (
        <div className="warnings" role="alert">
          {state.warnings.map((w) => <span key={w}>{w}</span>)}
        </div>
      )}
    </>
  );
}
