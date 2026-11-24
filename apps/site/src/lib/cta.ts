// The site's call to action. Pure: the page passes in the config.
export type Link = { label: string; href: string };
export type Ctas = { state: "soon" | "download"; primary: Link; note: string };

/**
 * Before the Mac app ships there is nothing to download, so the honest, least technical step is
 * to follow its releases (GitHub emails a watcher when one is published). After MAC-8 it's the dmg.
 */
export function ctas(opts: { macAppReleased: boolean; repo: string; dmgUrl: string }): Ctas {
  const releases = `https://github.com/${opts.repo}/releases`;
  return opts.macAppReleased
    ? { state: "download", primary: { label: "Download for Mac", href: opts.dmgUrl }, note: "Free and open source. For macOS, with OBS." }
    : { state: "soon", primary: { label: "Follow the Mac app", href: releases }, note: "Free and open source. The Mac app is in testing; follow it to hear when it's out." };
}

/** The config value, unless an override (e.g. SITE_MAC_APP on a preview build) says otherwise. */
export function macAppFlag(configured: boolean, override: string | undefined): boolean {
  if (override === undefined || override === "") return configured;
  if (override === "1" || override === "true") return true;
  if (override === "0" || override === "false") return false;
  throw new Error(`SITE_MAC_APP must be 1, 0, true or false, not "${override}"`);
}
