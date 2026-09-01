import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// This surface talks to the DC EDGE node.
//
// An edge node serves this app itself, off the same origin as its API, so the
// client uses a relative base URL and the `SameSite=Strict` session cookie is
// actually sent. Development has to reproduce that single origin rather than
// point the browser at a second one: a cross-origin dev setup drops the session
// cookie, and the login then appears to succeed and immediately fail.
// Default to a DC node on this machine: an edge console is developed against a
// node, not against production. There is no hosted DC to fall back to — a DC
// runs in the building it belongs to.
const apiTarget = process.env.VITE_API_TARGET ?? "http://127.0.0.1:8080"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Hand-written entries rather than part of the generated barrel: that
      // barrel is written by `make contract`, and hand-written code must not
      // live in it.
      "@itulah/contract/money": path.resolve(
        __dirname,
        "../frontend-contract/src/money/index.ts",
      ),
      "@itulah/contract/reporting": path.resolve(
        __dirname,
        "../frontend-contract/src/reporting/index.ts",
      ),
      "@itulah/contract/client": path.resolve(
        __dirname,
        "../frontend-contract/src/client/index.ts",
      ),
      "@itulah/contract": path.resolve(
        __dirname,
        "../frontend-contract/src/index.ts",
      ),
    },
  },
  server: {
    port: 5274,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true, secure: false },
    },
    fs: {
      // The shared contract package lives beside this app, not inside it.
      allow: [path.resolve(__dirname, ".."), path.resolve(__dirname)],
    },
  },
})
