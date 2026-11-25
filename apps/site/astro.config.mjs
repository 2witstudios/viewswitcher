// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// SITE-11's recording. Checked here, relative to this file, so it works from any working directory
// and nothing gets bundled; the hero reads the result as __HAS_DEMO_VIDEO__.
const hasDemoVideo = existsSync(fileURLToPath(new URL("./public/demo/viewswitcher-demo.mp4", import.meta.url)));

export default defineConfig({
  site: "https://viewswitcher.com",
  output: "static",
  trailingSlash: "never",
  integrations: [sitemap({ filter: (page) => !page.includes("/404") })],
  // One URL per page (SITE-24): pages build as privacy.html and Vercel's cleanUrls serves them at /privacy,
  // redirecting /privacy.html (and /index.html) there; there is no /privacy/ directory to duplicate it.
  build: { inlineStylesheets: "always", format: "file" },
  server: { port: 4321, host: "127.0.0.1" },
  devToolbar: { enabled: false },
  // Emit the hero script as a file, never inline, so the CSP in vercel.json can say script-src 'self'.
  vite: { build: { assetsInlineLimit: 0 }, define: { __HAS_DEMO_VIDEO__: JSON.stringify(hasDemoVideo) } },
});
