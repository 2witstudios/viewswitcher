import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const server = `http://localhost:${process.env.PORT ?? 7420}`;

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react()],
  server: {
    port: 5173,
    proxy: {
      "/api": server,
      "/library": server,
      "/ws": { target: server.replace("http", "ws"), ws: true },
    },
  },
});
