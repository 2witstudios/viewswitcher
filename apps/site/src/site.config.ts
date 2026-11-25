import { ctas, ipadApp, macAppFlag } from "./lib/cta";
import { softwareApp } from "./lib/seo";

// THE SWITCH: set to true when the Mac app's first release (MAC-8) is out.
// Before: "Follow the Mac app" (GitHub releases). After: "Download for Mac" (the dmg).
// A build can override it with SITE_MAC_APP=1 or 0 (e.g. on a Vercel preview) to show the other state.
const MAC_APP_RELEASED = true;

// THE iPAD SWITCH: paste the App Store link (https://apps.apple.com/...) once the iPad app is live.
// Before: "Coming to the App Store". After: the "Download on the App Store" badge links there.
// A build can override it with SITE_IPAD_APP_URL.
const IPAD_APP_URL: string | null = null;

// THE TEMPLATES SWITCH (SITE-26): the page where the example shows' template sets download free, once it's live.
// Before: the show cards say "Download coming soon" and link /download. After: "Download these templates", linking here.
const TEMPLATE_DOWNLOADS_URL: string | null = null;

export const site = {
  url: "https://viewswitcher.com",
  name: "ViewSwitcher",
  repo: "2witstudios/viewswitcher",
  /** MAC-8 must publish a release asset with exactly this name for this link to resolve. */
  dmgUrl: "https://github.com/2witstudios/viewswitcher/releases/latest/download/ViewSwitcher.dmg",
  /** The Mac app's current release (SITE-20). Update with each release: the version that /download and the structured data state. */
  mac: { version: "1.0.0", minOS: "14", minOSName: "macOS 14 Sonoma" },
  /** Drop SITE-11's recording here (public/demo/viewswitcher-demo.mp4) and the hero plays it. */
  demoVideo: "/demo/viewswitcher-demo.mp4",
  macAppReleased: macAppFlag(MAC_APP_RELEASED, process.env.SITE_MAC_APP),
  ipadApp: ipadApp(process.env.SITE_IPAD_APP_URL || IPAD_APP_URL),
  templateDownloads: process.env.SITE_TEMPLATE_DOWNLOADS_URL || TEMPLATE_DOWNLOADS_URL,
};

export const cta = ctas(site);
export const github = `https://github.com/${site.repo}`;
export const releases = `${github}/releases`;
/** The persistent descriptor (SITE-19): what ViewSwitcher is, in the words people search for. */
export const descriptor = "The free, custom scene manager and one-click switcher for OBS on Mac.";

/** The Mac app as schema.org sees it, for the homepage and /download (free, macOS 14+). */
export const macAppSchema = (path: string) => softwareApp({
  url: new URL(path, site.url).href, name: site.name, version: site.mac.version, minOS: site.mac.minOS,
  description: "A one-click scene switcher for OBS. Pick a view and your camera, screen and titles move into place.",
  downloadUrl: site.dmgUrl, image: new URL("/og.png", site.url).href, releaseNotes: `${releases}/latest`,
});
