import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const server = `http://localhost:${process.env.PORT ?? 7420}`;
// The proxy keeps the browser's Host (localhost:5173): the server only takes changes from a page with
// exactly its own origin, and to it this page is http://localhost:5173 asking for localhost:5173.
// Vite's string shorthand would rewrite the Host to the server's (changeOrigin), and every change made
// from the dev page would be refused as coming from another port.
const proxy = (target: string, ws = false) => ({ target, changeOrigin: false, ws });

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react()],
  server: {
    port: 5173,
    proxy: {
      "/api": proxy(server),
      "/library": proxy(server),
      "/ws": proxy(server.replace("http", "ws"), true),
    },
  },
});
