// The site's call to action. Pure: the page passes in the config.
export type Link = { label: string; href: string };
export type Ctas = { state: "github" | "download"; primary: Link; secondary: Link };

export function ctas(opts: { macAppReleased: boolean; repo: string; dmgUrl: string }): Ctas {
  const github = `https://github.com/${opts.repo}`;
  return opts.macAppReleased
    ? { state: "download", primary: { label: "Download for Mac", href: opts.dmgUrl }, secondary: { label: "View on GitHub", href: github } }
    : { state: "github", primary: { label: "Get it on GitHub", href: github }, secondary: { label: "Watch releases", href: `${github}/releases` } };
}

/** The config value, unless an override (e.g. SITE_MAC_APP on a preview build) says otherwise. */
export function macAppFlag(configured: boolean, override: string | undefined): boolean {
  if (override === undefined || override === "") return configured;
  if (override === "1" || override === "true") return true;
  if (override === "0" || override === "false") return false;
  throw new Error(`SITE_MAC_APP must be 1, 0, true or false, not "${override}"`);
}
