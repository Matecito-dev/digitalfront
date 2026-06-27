import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  server: {
    port: 5174,
    proxy: {
      "/api": { target: "http://localhost:3333", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
