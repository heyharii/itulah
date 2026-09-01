import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The till is served by the shop's own edge binary, from a directory on the
// same machine. So: relative asset paths, no CDN, nothing fetched from the
// internet at runtime — a shop may have none.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    // Every asset inlined below this rides in the HTML rather than costing a
    // round trip. Small on a LAN, but a till starts from cold every morning.
    assetsInlineLimit: 8192,
    sourcemap: true,
  },
  server: {
    // `npm run dev` talks to a store edge running locally.
    proxy: { "/api": "http://127.0.0.1:8082" },
  },
});
