import { ctas, ipadApp, macAppFlag } from "./lib/cta";

// THE SWITCH: set to true when the Mac app's first release (MAC-8) is out.
// Before: "Follow the Mac app" (GitHub releases). After: "Download for Mac" (the dmg).
// A build can override it with SITE_MAC_APP=1 or 0 (e.g. on a Vercel preview) to show the other state.
const MAC_APP_RELEASED = false;

// THE iPAD SWITCH: paste the App Store link (https://apps.apple.com/...) once the iPad app is live.
// Before: "Coming to the App Store". After: the "Download on the App Store" badge links there.
// A build can override it with SITE_IPAD_APP_URL.
const IPAD_APP_URL: string | null = null;

export const site = {
  url: "https://viewswitcher.com",
  name: "ViewSwitcher",
  repo: "2witstudios/viewswitcher",
  /** MAC-8 must publish a release asset with exactly this name for this link to resolve. */
  dmgUrl: "https://github.com/2witstudios/viewswitcher/releases/latest/download/ViewSwitcher.dmg",
  /** Drop SITE-11's recording here (public/demo/viewswitcher-demo.mp4) and the hero plays it. */
  demoVideo: "/demo/viewswitcher-demo.mp4",
  macAppReleased: macAppFlag(MAC_APP_RELEASED, process.env.SITE_MAC_APP),
  ipadApp: ipadApp(process.env.SITE_IPAD_APP_URL || IPAD_APP_URL),
};

export const cta = ctas(site);
export const github = `https://github.com/${site.repo}`;
