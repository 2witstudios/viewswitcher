// The site's call to action. Pure: the page passes in the config.
export type Link = { label: string; href: string };
export type Ctas = { state: "soon" | "download"; primary: Link };

/**
 * Before the Mac app ships there is nothing to download, so the honest, least technical step is
 * to follow its releases (GitHub emails a watcher when one is published). After MAC-8 it's the dmg.
 */
export function ctas(opts: { macAppReleased: boolean; repo: string; dmgUrl: string }): Ctas {
  const releases = `https://github.com/${opts.repo}/releases`;
  return opts.macAppReleased
    ? { state: "download", primary: { label: "Download for Mac", href: opts.dmgUrl } }
    : { state: "soon", primary: { label: "Follow the Mac app", href: releases } };
}

/** The config value, unless an override (e.g. SITE_MAC_APP on a preview build) says otherwise. */
export function macAppFlag(configured: boolean, override: string | undefined): boolean {
  return flag("SITE_MAC_APP", configured, override);
}

/** A config switch, unless its env override (1, 0, true or false) says otherwise. */
export function flag(name: string, configured: boolean, override: string | undefined): boolean {
  if (override === undefined || override === "") return configured;
  if (override === "1" || override === "true") return true;
  if (override === "0" || override === "false") return false;
  throw new Error(`${name} must be 1, 0, true or false, not "${override}"`);
}

/** The iPhone and iPad app (one universal app): optional, a one-time price on the App Store. Before its listing is live it's "coming". */
export const IPAD_PRICE = "$9.99";
export type IpadApp = { state: "soon" } | { state: "store"; href: string };

/** IPAD_APP_URL (or a SITE_IPAD_APP_URL override) turns "Coming to the App Store" into the store badge. */
export function ipadApp(url: string | null | undefined): IpadApp {
  const u = url?.trim();
  if (!u) return { state: "soon" };
  if (!/^https:\/\/apps\.apple\.com\//.test(u)) throw new Error(`IPAD_APP_URL must be an https://apps.apple.com/ link, not "${u}"`);
  return { state: "store", href: u };
}
