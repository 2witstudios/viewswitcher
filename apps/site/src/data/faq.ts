// The homepage's questions. The page shows them and its FAQPage structured data repeats them word for word.
// `more` links to the page that answers the question in full.
import { site } from "../site.config";
import { IPAD_PRICE } from "../lib/cta";

export type Faq = { q: string; a: string; more?: { href: string; label: string } };

export const FAQS: Faq[] = [
  { q: "Do I need OBS?", a: "Yes. OBS is the free app that does the streaming, and ViewSwitcher sets it up for you the first time. After that, ViewSwitcher tells OBS what to show and where your camera goes; you keep streaming to YouTube, Facebook or wherever you go live today.", more: { href: "/setup", label: "How to set up OBS with ViewSwitcher" } },
  { q: "Do I need to know how to code?", a: "No. You pick views, type in your show's name and titles, and drag boxes where you want them." },
  { q: "Do I need AI?", a: "No. The views in the set are ready to use as they are. If you ever want a kind of view that isn't in the set, you can describe it and an AI assistant can make it for you, but that's optional." },
  { q: "Does it work on Windows?", a: "Not yet. ViewSwitcher is Mac only for now. If you'd use it on Windows, tell us on GitHub." },
  { q: "Can my church use it?", a: "Yes. Set up views once for your service (a welcome, worship, the sermon with the scripture beside the pastor, giving, the goodbye) and each Sunday is just new titles. There's no yearly seat fee.", more: { href: "/church-livestream", label: "Church livestreaming with ViewSwitcher" } },
  { q: "Does it work with my camera?", a: "If OBS can see it, ViewSwitcher can place it: the Mac's built-in camera, a USB webcam, or a camera through a capture card. Your screen share and an iPad's screen work the same way." },
  { q: "Can I switch from an iPad?", a: `Yes, with ViewSwitcher for iPad: plug it into the Mac with a USB-C cable and tap views on it. It's optional, ${IPAD_PRICE} once, ${site.ipadApp.state === "store" ? "on the App Store" : "and coming to the App Store"}.`, more: { href: "/ipad", label: "ViewSwitcher for iPad" } },
  { q: "Can I switch from my phone?", a: "Not yet. Today you switch from the Mac app, a browser on the Mac, or an iPad on a USB-C cable. Pairing a phone over Wi-Fi is coming soon." },
  { q: "What does it cost?", a: `The Mac app is free and open source, with no subscription. The iPad app is optional: ${IPAD_PRICE}, once, ${site.ipadApp.state === "store" ? "on the App Store" : "when it arrives on the App Store"}.` },
];
