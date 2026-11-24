// What the menu-bar item shows, from the server's live state. Pure, so `bun test` covers it.
import { obsReady, type LiveState } from "@viewswitcher/shared";

export type TrayStatus = {
  /** Text beside the icon: the on-air scene, or nothing. */
  title: string;
  /** Red icon: something is on air. Red is only ever for on air. */
  live: boolean;
  onAir: string;
  obs: string;
  ipad: string;
  /** OBS is connected and has the scene and sources (devices aside). */
  obsReady: boolean;
};

const TITLE_MAX = 24;
const short = (s: string) => (s.length > TITLE_MAX ? `${s.slice(0, TITLE_MAX - 1).trimEnd()}…` : s);

/** `state` is null while the server doesn't answer. */
export function trayStatus(state: LiveState | null): TrayStatus {
  if (!state) return { title: "", live: false, onAir: "Server not responding", obs: "OBS: unknown", ipad: "iPad: unknown", obsReady: false };
  const label = state.onAir?.label ?? "";
  const setup = state.obsSetup;
  const needsSetup = state.obs.connected && !!setup && !obsReady(setup);

  let obs = "OBS: not connected";
  if (state.obs.connected) {
    if (needsSetup) obs = "OBS: needs setup";
    else if (setup?.missingDevices.length) obs = `OBS: connected · add ${setup.missingDevices.join(", ")}`;
    else obs = "OBS: connected";
    const outputs = [state.obs.streaming && "live", state.obs.recording && "recording"].filter(Boolean);
    if (outputs.length) obs += ` · ${outputs.join(", ")}`;
  }

  const usb = state.usb;
  const ipad = !usb?.enabled
    ? "iPad: USB link off"
    : usb.connected
      ? "iPad: connected over USB"
      : usb.attached
        ? "iPad: plugged in · open ViewSwitcher on it"
        : "iPad: not plugged in";

  return { title: label ? short(label) : "", live: !!state.onAir, onAir: label ? `On air: ${label}` : "Nothing on air", obs, ipad, obsReady: state.obs.connected && !!setup && !needsSetup };
}
