// Which ViewSwitcher client a page is running in, from its user agent.
//
// The iPad app appends "ViewSwitcher-iPad" (the native app, apps/apple, adds "/<version>"; the
// Capacitor build before it added nothing); builds before the Mac app appended plain "ViewSwitcher"
// at the very end, so that still counts until every iPad is redeployed. The Mac app sends
// "ViewSwitcher-Mac/<version>", so its window is never mistaken for the iPad and never bounces to the
// iPad connector.

export type ClientKind = "ipad" | "mac" | "browser";

export function clientKind(userAgent: string): ClientKind {
  if (/\bViewSwitcher-iPad\b/.test(userAgent) || /\sViewSwitcher$/.test(userAgent)) return "ipad";
  if (/\bViewSwitcher-Mac\b/.test(userAgent)) return "mac";
  return "browser";
}

/** Where the iPad app's bundled connector page lives: viewswitcher://connector/ in the native app, capacitor://localhost/ in older builds. */
export function connectorUrl(userAgent: string): string {
  return /\bViewSwitcher-iPad\/\d/.test(userAgent) ? "viewswitcher://connector/" : "capacitor://localhost/";
}
