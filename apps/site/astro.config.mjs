// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://viewswitcher.com",
  output: "static",
  trailingSlash: "ignore",
  integrations: [sitemap({ filter: (page) => !page.includes("/404") })],
  build: { inlineStylesheets: "always" },
  server: { port: 4321, host: "127.0.0.1" },
  devToolbar: { enabled: false },
  // Emit the hero script as a file, never inline, so the CSP in vercel.json can say script-src 'self'.
  vite: { build: { assetsInlineLimit: 0 } },
});
