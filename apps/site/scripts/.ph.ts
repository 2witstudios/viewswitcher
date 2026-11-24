// For each Unsplash photo slug: license, photographer, image URL; saves a 480px thumb.
import { chromium } from "playwright-core";
import sharp from "sharp";
const out = process.env.OUT!;
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36" });
const res: any[] = [];
for (const slug of process.argv.slice(2)) {
  try {
    await p.goto(`https://unsplash.com/photos/${slug}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await p.waitForFunction(() => !document.title.startsWith("Checking"), null, { timeout: 60000 });
    await p.waitForLoadState("networkidle").catch(() => {});
    const info = await p.evaluate(() => {
      const og = document.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? "";
      const text = document.body.innerText;
      const lic = /Unsplash\+ License/.test(text) ? "Unsplash+" : /Free to use under the Unsplash License/.test(text) ? "Unsplash License" : "?";
      const author = document.querySelector('meta[name="twitter:creator"]')?.getAttribute("content") ?? "";
      const title = document.title;
      return { og, lic, author, title };
    });
    const id = slug.split("-").pop()!;
    const img = info.og.replace(/\?.*/, "") + "?w=480&q=70&fm=jpg";
    const buf = Buffer.from(await (await fetch(img)).arrayBuffer());
    await sharp(buf).toFile(`${out}/t-${id}.jpg`);
    res.push({ slug, id, ...info });
  } catch (e) { res.push({ slug, err: String(e).slice(0, 100) }); }
}
console.log(JSON.stringify(res, null, 1));
await b.close();
