import { useState } from "react";
import { api } from "../lib/api";
import { useLive } from "../lib/live";
import { cardKey, setupCard } from "../lib/setup-card";
import { toast } from "./ui";

const DEVICE_KIND: Record<string, string> = { Camera: "Video Capture Device", Screen: "macOS Screen Capture", iPad: "Video Capture Device (the iPad over USB)" };

// "Not now" lasts for this visit when OBS is offline or unset; for missing devices it sticks
// (someone without an iPad shouldn't be asked every time), until the list of missing ones changes.
const store = (key: string) => (key.startsWith("devices:") ? localStorage : sessionStorage);
const dismissed = (key: string) => {
  try {
    return store(key).getItem(`vs-setup-hidden:${key}`) === "1";
  } catch {
    return false;
  }
};

/** Shown while OBS, or the switcher's scene and sources in it, are missing or out of order. */
export function SetupCard() {
  const { state, connected } = useLive();
  const [busy, setBusy] = useState(false);
  const [, rerender] = useState(0);
  const card = connected && state ? setupCard(state) : null;
  if (!card || dismissed(cardKey(card))) return null;

  const hide = () => {
    try {
      store(cardKey(card)).setItem(`vs-setup-hidden:${cardKey(card)}`, "1");
    } catch {}
    rerender((n) => n + 1);
  };
  const setUp = async () => {
    const live = state?.obs.streaming || state?.obs.recording;
    if (live && !confirm(`OBS is ${state?.obs.streaming ? "streaming" : "recording"}. Set up the ViewSwitcher scene anyway? OBS will stay on the scene it's showing now.`)) return;
    setBusy(true);
    try {
      const r = await api.setupObs();
      const next = r.missing.length ? ` Add ${r.missing.join(", ")} next.` : "";
      toast(r.switched ? `OBS is set up.${next}` : `ViewSwitcher scene ready. OBS is live, so switch to it when you're ready.${next}`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="setup-card" aria-label="OBS setup">
      {card.kind === "connect" && !card.auth && (
        <div className="setup-text">
          <h2>Connect OBS</h2>
          <p>In OBS: <b>Tools → WebSocket Server Settings → Enable</b>.</p>
        </div>
      )}
      {card.kind === "connect" && card.auth === "missing" && (
        <div className="setup-text">
          <h2>OBS wants a password</h2>
          <p>
            OBS's WebSocket server asks for a password that ViewSwitcher can't find. In OBS: <b>Tools → WebSocket Server Settings</b>,
            press <b>Apply</b> so OBS saves it, or turn off <b>Enable Authentication</b>. ViewSwitcher tries again every few seconds.
          </p>
        </div>
      )}
      {card.kind === "connect" && card.auth === "wrong" && (
        <div className="setup-text">
          <h2>OBS refused the password</h2>
          <p>
            The password ViewSwitcher has doesn't match OBS's. In OBS: <b>Tools → WebSocket Server Settings</b>, check the password and
            press <b>Apply</b>. ViewSwitcher tries again every few seconds.
          </p>
        </div>
      )}
      {card.kind === "order" && (
        <div className="setup-text">
          <h2>Set up OBS again</h2>
          <p>A source in the ViewSwitcher scene sits above the program page, so it covers your views. Set up OBS puts the program back on top.</p>
        </div>
      )}
      {card.kind === "setup" && (
        <div className="setup-text">
          <h2>Set up OBS</h2>
          <p>Adds a ViewSwitcher scene to OBS and switches to it, unless OBS is live.</p>
        </div>
      )}
      {card.kind === "devices" && (
        <div className="setup-text">
          <h2>Add your devices in OBS</h2>
          <p>Add these sources to the ViewSwitcher scene, named exactly, then press Set up OBS again:</p>
          <ul>
            {card.missing.map((d) => <li key={d}><b>{d}</b>{DEVICE_KIND[d] ? `: ${DEVICE_KIND[d]}` : ""}</li>)}
          </ul>
        </div>
      )}
      <div className="setup-actions">
        {card.kind !== "connect" && (
          <button type="button" className="btn primary" disabled={busy} onClick={setUp}>{busy ? "Setting up…" : card.kind === "setup" ? "Set up OBS" : "Set up OBS again"}</button>
        )}
        <button type="button" className="btn ghost" onClick={hide}>Not now</button>
      </div>
    </section>
  );
}
