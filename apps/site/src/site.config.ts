import { ctas, flag, ipadApp, macAppFlag } from "./lib/cta";
import { softwareApp } from "./lib/seo";

// THE SWITCH: set to true when the Mac app's first release (MAC-8) is out.
// Before: "Follow the Mac app" (GitHub releases). After: "Download for Mac" (the dmg).
// A build can override it with SITE_MAC_APP=1 or 0 (e.g. on a Vercel preview) to show the other state.
const MAC_APP_RELEASED = true;

// THE iPAD SWITCH: paste the App Store link (https://apps.apple.com/...) once the iPad app is live.
// Before: "Coming to the App Store". After: the "Download on the App Store" badge links there.
// A build can override it with SITE_IPAD_APP_URL.
const IPAD_APP_URL: string | null = null;

// THE TEMPLATES SWITCH (SITE-26): where the example shows' template packs download free.
// Set: the show cards say "Download these templates" and link each set's page. Null: "Download coming soon".
const TEMPLATE_DOWNLOADS_URL: string | null = "/templates";

// THE PACK INSTALL SWITCH: the first ViewSwitcher release that installs template packs (EDIT-24 shipped after 1.0.0).
// Null: the template pages say installing packs comes with the next update. Set (e.g. "1.1.0"): "Needs ViewSwitcher 1.1.0 or later."
const PACK_INSTALL_VERSION: string | null = "1.1.0";

// THE AI SWITCH: true once Edit with AI (MCP, PR #8) ships, in v1.2.0. How it works step 1 then says
// you can connect your favorite AI in one click, with the Edit with AI sheet as its picture, and /download
// gets a line. False: today's step 1. A build can override it with SITE_AI_CONNECT_RELEASED=1 or 0.
const AI_CONNECT_RELEASED = true;

export const site = {
  url: "https://viewswitcher.com",
  name: "ViewSwitcher",
  repo: "2witstudios/viewswitcher",
  /** MAC-8 must publish a release asset with exactly this name for this link to resolve. */
  dmgUrl: "https://github.com/2witstudios/viewswitcher/releases/latest/download/ViewSwitcher.dmg",
  /** The Mac app's current release (SITE-20). Update with each release: the version that /download and the structured data state. */
  mac: { version: "1.2.0", minOS: "14", minOSName: "macOS 14 Sonoma" },
  /** Drop SITE-11's recording here (public/demo/viewswitcher-demo.mp4) and the hero plays it. */
  demoVideo: "/demo/viewswitcher-demo.mp4",
  macAppReleased: macAppFlag(MAC_APP_RELEASED, process.env.SITE_MAC_APP),
  ipadApp: ipadApp(process.env.SITE_IPAD_APP_URL || IPAD_APP_URL),
  templateDownloads: process.env.SITE_TEMPLATE_DOWNLOADS_URL || TEMPLATE_DOWNLOADS_URL,
  aiConnect: flag("SITE_AI_CONNECT_RELEASED", AI_CONNECT_RELEASED, process.env.SITE_AI_CONNECT_RELEASED),
  packInstallVersion: process.env.SITE_PACK_INSTALL_VERSION || PACK_INSTALL_VERSION,
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
  downloadUrl: site.dmgUrl, image: new URL("/og/home.jpg", site.url).href, releaseNotes: `${releases}/latest`,
});
