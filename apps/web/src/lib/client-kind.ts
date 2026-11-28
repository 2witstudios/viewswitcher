// Which ViewSwitcher client a page is running in, from its user agent.
//
// The iPad app appends "ViewSwitcher-iPad" (the native app, apps/apple, adds "/<version>"; the
// Capacitor build before it added nothing); builds before the Mac app appended plain "ViewSwitcher"
// at the very end, so that still counts until every iPad is redeployed. The Mac app sends
// "ViewSwitcher-Mac/<version>" and the Windows app "ViewSwitcher-Windows/<version>", so neither
// window is ever mistaken for the iPad and bounced to the iPad connector.

export type ClientKind = "ipad" | "mac" | "windows" | "browser";

export function clientKind(userAgent: string): ClientKind {
  if (/\bViewSwitcher-iPad\b/.test(userAgent) || /\sViewSwitcher$/.test(userAgent)) return "ipad";
  if (/\bViewSwitcher-Mac\b/.test(userAgent)) return "mac";
  if (/\bViewSwitcher-Windows\b/.test(userAgent)) return "windows";
  return "browser";
}

/** The switcher in ViewSwitcher's own window on the computer that runs it (the Mac or the Windows app). */
export const inDesktopApp = (kind: ClientKind) => kind === "mac" || kind === "windows";

/** Where the iPad app's bundled connector page lives: viewswitcher://connector/ in the native app, capacitor://localhost/ in older builds. */
export function connectorUrl(userAgent: string): string {
  return /\bViewSwitcher-iPad\/\d/.test(userAgent) ? "viewswitcher://connector/" : "capacitor://localhost/";
}
