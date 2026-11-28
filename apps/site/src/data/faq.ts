// The homepage's questions (Jono's design: five, collapsed). The page shows them and its FAQPage
// structured data repeats them word for word. "Do I need AI?" follows AI_CONNECT_RELEASED.
import { site } from "../site.config";
import { IPAD_PRICE } from "../lib/cta";

export type Faq = { q: string; a: string; more?: { href: string; label: string } };

export const FAQS: Faq[] = [
  { q: "Do I need to know how to code?", a: "No. Start from a template, then retype your titles and drag the boxes right on the view. Templates are small web pages, so you can code your own if you like." },
  { q: "Do I need AI?", a: site.aiConnect
    ? "No. The templates work on their own, and you edit them right on the view. Connecting your favorite AI (Claude, Cursor or any app with MCP) is optional and free: it makes custom overlays and slides when you ask."
    : "No. Start from a free template and edit it right on the view. If you want a view that isn't there, an AI assistant can make one for you, but that's optional." },
  { q: "Does it work with my camera?", a: "If OBS can see it, ViewSwitcher can place it: the Mac's built-in camera, a USB webcam, or a camera through a capture card. Your screen share works the same way." },
  { q: "Can I switch from my phone?", a: site.ipadApp.state === "store"
    ? `Yes, with ViewSwitcher for iPhone and iPad (${IPAD_PRICE} once, one purchase for both). Held sideways, your views fill the phone like a deck. On the Mac, in ViewSwitcher's menu bar, turn on Let Phones and Tablets on This Wi-Fi Connect, then tap Scan the code in the app. Only phones and tablets you pair can switch scenes. Use it on Wi-Fi you trust, like home or church Wi-Fi.`
    : `Yes. ViewSwitcher for iPhone and iPad is coming to the App Store (${IPAD_PRICE} once, one purchase for both). Held sideways, your views fill the phone like a deck, and you pair it by scanning the code the Mac shows. Until then, any phone can switch from its browser: in ViewSwitcher's menu bar, turn on Let Phones and Tablets on This Wi-Fi Connect and scan the QR code with the phone's camera. Only phones and tablets you pair can switch scenes. Use it on Wi-Fi you trust, like home or church Wi-Fi.`,
    more: { href: "/ipad", label: "ViewSwitcher for iPhone and iPad" } },
  { q: "Windows?", a: site.windowsAppReleased
    ? "Yes. ViewSwitcher for Windows 10 and 11 is free too: download the installer, run it, and ViewSwitcher sets up OBS for you the first time. Phones and tablets connect over the Wi-Fi the same way, and it keeps itself up to date."
    : "Coming soon. ViewSwitcher for Windows 10 and 11 is on its way, with everything the Mac app does: OBS set up for you, phones and tablets over the Wi-Fi, and Edit with AI.",
    ...(site.windowsAppReleased ? { more: { href: site.windowsSetupUrl, label: "Download for Windows" } } : {}) },
];
