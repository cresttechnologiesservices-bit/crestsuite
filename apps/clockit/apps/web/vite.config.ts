import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  // Served under /clockit by the CrestSuite portal
  base: "/clockit/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/clockit/api": {
        target: "http://localhost:3000",
        rewrite: (p) => p.replace(/^\/clockit/, ""),
      },
    },
  },
});
