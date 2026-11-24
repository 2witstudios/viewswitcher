import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36" });
await p.goto(`https://unsplash.com/photos/young-woman-in-plaid-shirt-filming-herself-at-home-iOVRrjgvQT8`, { waitUntil: "domcontentloaded" });
await p.waitForLoadState("networkidle").catch(() => {});
console.log(await p.title());
console.log(await p.evaluate(() => [...document.querySelectorAll("meta")].map(m => (m.getAttribute("property")||m.getAttribute("name"))+"="+(m.getAttribute("content")||"").slice(0,120)).join("\n")));
console.log(await p.evaluate(() => document.body.innerText.slice(0, 1500)));
await b.close();
