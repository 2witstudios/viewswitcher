// Finds the ViewSwitcher server on the Mac: USB-C first (the app's tunnel on 127.0.0.1:7420), then the
// network address saved when the app was paired (scanned, or found on the Wi-Fi) or typed in. Shared by the connector (index.html) and the demo (demo/index.html).
window.VS = (() => {
  // A Debug build may point the probe elsewhere (VIEWSWITCHER_PROBE, for the simulator, which shares
  // the Mac's ports); the app sets window.VIEWSWITCHER_USB then. Release builds never do.
  const USB = window.VIEWSWITCHER_USB || "http://127.0.0.1:7420";
  const NETWORK = "viewswitcher.network";
  // Set once a Mac has answered: from then on a launch with no Mac shows the connector, not the demo.
  const CONNECTED = "viewswitcher.connectedOnce";
  // Set when the user leaves the demo for the connector, until the app is next launched.
  const LEFT_DEMO = "viewswitcher.leftDemo";
  const get = (store, k) => { try { return store.getItem(k) || ""; } catch { return ""; } };
  const set = (store, k, v) => { try { store.setItem(k, v); } catch {} };

  const network = () => get(localStorage, NETWORK);
  // Hosts the app shows (ViewSwitcherKit NavigationPolicy.iPadHostAllowed); anything else would open Safari.
  // A private LAN address too (or carrier-grade NAT, 100.64/10): the Mac's pairing QR code carries one (PHONE-4, PairingLink.isPrivateIPv4).
  const privateIPv4 = (h) => {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (!m) return false;
    const [a, b, c, d] = m.slice(1).map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return false;
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  };
  const usable = (v) => {
    try {
      const u = new URL(v);
      const h = u.hostname.toLowerCase();
      return /^https?:$/.test(u.protocol) && (h === "127.0.0.1" || h === "localhost" || h.endsWith(".ts.net") || h.endsWith(".local") || privateIPv4(h));
    } catch { return false; }
  };

  // Reachable = the request completed (no-cors: the response is opaque, which is all we need).
  async function reachable(base) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1200);
    try {
      await fetch(`${base}/api/state?probe=${Date.now()}`, { mode: "no-cors", cache: "no-store", signal: ctl.signal });
      return true;
    } catch { return false; } finally { clearTimeout(t); }
  }

  /** The first server that answers, as { base, how }, or null. */
  // (reachable is exported too: the connector checks a scanned code's .local name before pairing on it.)
  async function find() {
    const saved = usable(network()) ? network() : "";
    for (const [base, how] of [[USB, "USB-C"], ...(saved ? [[saved, "the network"]] : [])]) {
      if (await reachable(base)) return { base, how };
    }
    return null;
  }

  /** Open the switcher a Mac serves (and remember that a Mac has been connected). */
  function open(base) {
    set(localStorage, CONNECTED, "1");
    location.replace(`${base}/`);
  }

  return {
    network, usable, find, open, reachable,
    saveNetwork: (v) => set(localStorage, NETWORK, v),
    connectedBefore: () => get(localStorage, CONNECTED) === "1",
    leftDemo: () => get(sessionStorage, LEFT_DEMO) === "1",
    leaveDemo: () => set(sessionStorage, LEFT_DEMO, "1"),
  };
})();
