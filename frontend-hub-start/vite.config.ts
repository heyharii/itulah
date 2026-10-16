import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import { defineConfig } from "vite"
import viteReact from "@vitejs/plugin-react"

// The same one-origin rule as frontend-hub (vite.config.ts): the browser
// addresses /api on its own origin and the proxy forwards it to the CLOUD
// node, so the SameSite=Strict session cookie is actually sent. Development
// proxies here; production fronts the built server with a reverse proxy that
// does the same split (Render rewrite / Caddy), plus / → this server.
const apiTarget = process.env.VITE_API_TARGET ?? "http://127.0.0.1:8080"

const proxy = {
  "/api": { target: apiTarget, changeOrigin: true },
}

export default defineConfig({
  server: {
    port: 3001,
    // Vite's "localhost" binds ::1 on this machine; bind IPv4 so the dev
    // proxy, the node, and every probe address the same stack.
    host: "127.0.0.1",
    proxy,
  },
  preview: {
    port: 3001,
    proxy,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    // react's vite plugin must come after start's vite plugin
    tanstackStart(),
    viteReact(),
  ],
})
