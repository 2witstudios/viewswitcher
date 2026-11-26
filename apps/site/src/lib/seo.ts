// schema.org JSON-LD for the site's pages. Pure: pages pass in what's on them, and only
// what the page visibly says goes in (Google wants structured data to match the page).

type Thing = Record<string, unknown>;
const ctx = "https://schema.org";

export type App = { url: string; name: string; version: string; minOS: string; description: string; downloadUrl: string; image: string; releaseNotes: string };

/** The Mac app: free, macOS, Apple silicon and Intel. */
export function softwareApp(a: App): Thing {
  return {
    "@context": ctx,
    "@type": "SoftwareApplication",
    name: a.name,
    description: a.description,
    url: a.url,
    image: a.image,
    applicationCategory: "MultimediaApplication",
    operatingSystem: `macOS ${a.minOS} or later`,
    processorRequirements: "Apple silicon or Intel",
    softwareVersion: a.version,
    downloadUrl: a.downloadUrl,
    releaseNotes: a.releaseNotes,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
}

export type Qa = { q: string; a: string };

/** Questions answered on the page, as plain text (no markup in the answer). */
export function faqPage(faqs: Qa[]): Thing {
  if (!faqs.length) throw new Error("an FAQPage needs at least one question");
  return {
    "@context": ctx,
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}

export type Step = { name: string; text: string; url: string; image?: string };

/** A how-to guide: its steps in order, each linking to its own heading on the page. */
export function howTo(h: { name: string; description: string; totalTime?: string; tools: string[]; steps: Step[] }): Thing {
  if (!h.steps.length) throw new Error("a HowTo needs at least one step");
  return {
    "@context": ctx,
    "@type": "HowTo",
    name: h.name,
    description: h.description,
    ...(h.totalTime ? { totalTime: h.totalTime } : {}),
    tool: h.tools.map((name) => ({ "@type": "HowToTool", name })),
    step: h.steps.map((s, i) => ({ "@type": "HowToStep", position: i + 1, name: s.name, text: s.text, url: s.url, ...(s.image ? { image: s.image } : {}) })),
  };
}

/** Home → this page. */
export function breadcrumbs(site: string, trail: { name: string; path: string }[]): Thing {
  return {
    "@context": ctx,
    "@type": "BreadcrumbList",
    itemListElement: [{ name: "Home", path: "/" }, ...trail].map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, item: new URL(t.path, site).href })),
  };
}

/** For a <script type="application/ld+json">: "<" escaped so text can never close the script. */
export const jsonLd = (things: Thing[]) => JSON.stringify(things.length === 1 ? things[0] : things).replace(/</g, "\\u003c");
