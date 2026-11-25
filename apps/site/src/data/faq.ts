// The homepage's questions (Jono's design: five, collapsed). The page shows them and its FAQPage
// structured data repeats them word for word. "Do I need AI?" follows AI_CONNECT_RELEASED.
import { site } from "../site.config";

export type Faq = { q: string; a: string; more?: { href: string; label: string } };

export const FAQS: Faq[] = [
  { q: "Do I need to know how to code?", a: "No. Start from a template, then retype your titles and drag the boxes right on the view. Templates are small web pages, so you can code your own if you like." },
  { q: "Do I need AI?", a: site.aiConnect
    ? "No. The templates work on their own, and you edit them right on the view. Connecting your favorite AI (Claude, Cursor or any app with MCP) is optional and free: it makes custom overlays and slides when you ask."
    : "No. Start from a free template and edit it right on the view. If you want a view that isn't there, an AI assistant can make one for you, but that's optional." },
  { q: "Does it work with my camera?", a: "If OBS can see it, ViewSwitcher can place it: the Mac's built-in camera, a USB webcam, or a camera through a capture card. Your screen share works the same way." },
  { q: "Can I switch from my phone?", a: "Yes. In ViewSwitcher's menu bar, turn on Let Phones and Tablets on This Wi-Fi Connect, then scan the QR code with your phone's camera. Only phones and tablets you pair can switch scenes. Use it on Wi-Fi you trust, like home or church Wi-Fi." },
  { q: "Windows?", a: "Not yet. ViewSwitcher is Mac only for now. If you'd use it on Windows, tell us on GitHub." },
];
