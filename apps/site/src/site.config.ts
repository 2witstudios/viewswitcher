import { ctas, macAppFlag } from "./lib/cta";

// THE SWITCH: set to true when the Mac app's first release (MAC-8) is out.
// Before: "Get it on GitHub" + "Watch releases". After: "Download for Mac" + GitHub.
// A build can override it with SITE_MAC_APP=1 or 0 (e.g. on a Vercel preview) to show the other state.
const MAC_APP_RELEASED = false;

export const site = {
  url: "https://viewswitcher.com",
  name: "ViewSwitcher",
  repo: "2witstudios/viewswitcher",
  /** MAC-8 must publish a release asset with exactly this name for this link to resolve. */
  dmgUrl: "https://github.com/2witstudios/viewswitcher/releases/latest/download/ViewSwitcher.dmg",
  /** Drop SITE-11's recording here (public/demo/viewswitcher-demo.mp4) and the hero plays it. */
  demoVideo: "/demo/viewswitcher-demo.mp4",
  macAppReleased: macAppFlag(MAC_APP_RELEASED, process.env.SITE_MAC_APP),
};

export const cta = ctas(site);
export const github = `https://github.com/${site.repo}`;
