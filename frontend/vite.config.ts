import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:4000";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/proxy-api": {
        target: apiTarget,
        rewrite: (path) => path.replace(/^\/proxy-api/, "/api"),
        changeOrigin: true,
        ws: true,
      },
      "/proxy-socket": {
        target: apiTarget,
        rewrite: (path) => path.replace(/^\/proxy-socket/, "/socket"),
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
