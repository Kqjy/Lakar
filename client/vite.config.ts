import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.LAKAR_API || "http://localhost:5191";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5190,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
      "/ws": {
        target: apiTarget.replace(/^http/, "ws"),
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
