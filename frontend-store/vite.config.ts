import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// This surface talks to the STORE node.
//
// In production the front end and its API are served from one origin (Render
// rewrites `/api/*` to the node), so the client uses a relative base URL and
// the `SameSite=Strict` session cookie is actually sent. Development has to
// reproduce that single origin rather than pointing the browser at a second
// one, which is what this proxy is for: a cross-origin dev setup would drop
// the session cookie and the login would appear to succeed and then fail.
const apiTarget = process.env.VITE_API_TARGET ?? "https://store-mhpy.onrender.com"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
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
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        secure: true,
      },
    },
    fs: {
      // The shared contract package lives beside this app, not inside it.
      allow: [path.resolve(__dirname, ".."), path.resolve(__dirname)],
    },
  },
})
