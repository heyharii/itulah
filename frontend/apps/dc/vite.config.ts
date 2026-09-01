import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Served as plain files by the binary this console belongs to. Relative paths,
// nothing fetched from the internet at runtime.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", assetsInlineLimit: 8192, sourcemap: true },
  server: { proxy: { "/api": "http://127.0.0.1:8081" } },
});
