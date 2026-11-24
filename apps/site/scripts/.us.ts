import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36" });
for (const q of process.argv.slice(2)) {
  await p.goto(`https://unsplash.com/s/photos/${encodeURIComponent(q)}?license=free&orientation=landscape`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(2500);
  const items = await p.$$eval('a[href^="/photos/"]', (as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).getAttribute("href")! + " | " + (a.querySelector("img")?.getAttribute("alt") ?? "")))].slice(0, 12));
  console.log("##", q, await p.title()); for (const i of items) console.log(i);
}
await b.close();
