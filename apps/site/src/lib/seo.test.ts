import { describe, expect, test } from "bun:test";
import { breadcrumbs, faqPage, howTo, jsonLd, softwareApp } from "./seo";

const app = {
  url: "https://viewswitcher.com/download", name: "ViewSwitcher", version: "1.0.0", minOS: "14", description: "d",
  downloadUrl: "https://example.com/ViewSwitcher.dmg", image: "https://viewswitcher.com/og.png", releaseNotes: "https://example.com/releases",
};

describe("softwareApp", () => {
  test("is free, for macOS, with the version", () => {
    const s = softwareApp(app);
    expect(s["@type"]).toBe("SoftwareApplication");
    expect(s.offers).toEqual({ "@type": "Offer", price: "0", priceCurrency: "USD" });
    expect(s.operatingSystem).toBe("macOS 14 or later");
    expect(s.softwareVersion).toBe("1.0.0");
  });
});

describe("faqPage", () => {
  test("each question has its answer", () => {
    const f = faqPage([{ q: "Do I need OBS?", a: "Yes." }]);
    expect(f.mainEntity).toEqual([{ "@type": "Question", name: "Do I need OBS?", acceptedAnswer: { "@type": "Answer", text: "Yes." } }]);
  });
  test("refuses an empty list", () => expect(() => faqPage([])).toThrow());
});

describe("howTo", () => {
  test("numbers the steps in order", () => {
    const h = howTo({ name: "n", description: "d", tools: ["OBS"], steps: [{ name: "a", text: "a", url: "u#a" }, { name: "b", text: "b", url: "u#b", image: "i" }] });
    expect((h.step as { position: number }[]).map((s) => s.position)).toEqual([1, 2]);
    expect(h.tool).toEqual([{ "@type": "HowToTool", name: "OBS" }]);
  });
});

describe("breadcrumbs", () => {
  test("start at home and use absolute URLs", () => {
    const b = breadcrumbs("https://viewswitcher.com", [{ name: "Setup", path: "/setup" }]);
    expect((b.itemListElement as { item: string }[]).map((i) => i.item)).toEqual(["https://viewswitcher.com/", "https://viewswitcher.com/setup"]);
  });
});

describe("jsonLd", () => {
  test("parses back, and text can't close the script tag", () => {
    const out = jsonLd([faqPage([{ q: "</script><b>", a: "x" }])]);
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out).mainEntity[0].name).toBe("</script><b>");
  });
});
