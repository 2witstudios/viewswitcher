// Which ViewSwitcher client a page is running in, from its user agent.
//
// The iPad app appends "ViewSwitcher-iPad" (apps/ipad/capacitor.config.ts); builds before the Mac app
// appended plain "ViewSwitcher" at the very end, so that still counts until every iPad is redeployed.
// The Mac app (Electron) sends "ViewSwitcher-Mac" and drops Electron's "ViewSwitcher/<version>" token,
// so its window is never mistaken for the iPad and never bounces to the iPad connector.

export type ClientKind = "ipad" | "mac" | "browser";

export function clientKind(userAgent: string): ClientKind {
  if (/\bViewSwitcher-iPad\b/.test(userAgent) || /\sViewSwitcher$/.test(userAgent)) return "ipad";
  if (/\bViewSwitcher-Mac\b/.test(userAgent)) return "mac";
  return "browser";
}
