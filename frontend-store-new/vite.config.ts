import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

// This surface talks to the STORE node — the shop's own Edge, standing in the
// shop, answering out of the shop's own SQLite.
//
// Production serves the front end and its API from one origin (Render rewrites
// `/api/*` to the node), so the client uses a relative base URL and the
// `SameSite=Strict` session cookie is actually sent. Development has to
// reproduce that single origin rather than point the browser at a second one:
// a cross-origin dev setup drops the session cookie, and the login then appears
// to succeed and immediately fail.
const apiTarget =
  process.env.VITE_API_TARGET ?? "https://store-mhpy.onrender.com"

// Head office is NOT a second target. The HR and GA screens reach the centre
// through this same node — `/api/v1/store/central/*`, which the node relays to
// the cloud on behalf of whoever is signed in here (see
// `docs/store-edge-hr-relay.md`). So a dev till needs a store node configured
// with `SYNC_UPLOAD_URL`/`SYNC_UPLOAD_KEY`, and nothing more here.

/// The service worker (`src/lib/pwa.ts`): every file of the build precached,
/// so the app opens from the device. A generated worker — this app has no
/// push and nothing else for a worker of its own to do.
///
/// `prompt` rather than `autoUpdate`, because `autoUpdate` reloads the page
/// when a new build takes over; `lib/pwa.ts` takes the new build in without
/// one. No manifest: installing the app is a separate decision.
const pwa = VitePWA({
  strategies: "generateSW",
  registerType: "prompt",
  injectRegister: false,
  manifest: false,
  workbox: {
    globPatterns: ["**/*.{js,css,html,svg,woff2}"],
    // Hand-made prototype pages under `public/`, not part of the app.
    globIgnores: ["prototypes/**"],
    // The entry chunk carries React, Router and Query; over workbox's 2 MB
    // default it would be left out of the precache with only a warning.
    maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
    // Any path the app routes is answered with the shell, and the router
    // takes it from there — except the node's own: its API, its console and
    // its enrolment page are not this app's, and opening one in a tab must
    // reach the node.
    navigateFallback: "index.html",
    navigateFallbackDenylist: [
      /^\/api\//,
      /^\/console/,
      /^\/setup/,
      /^\/prototypes\//,
    ],
    cleanupOutdatedCaches: true,
  },
  devOptions: {
    enabled: false,
  },
})

export default defineConfig({
  plugins: [react(), tailwindcss(), pwa],
  // Which build this is, for the cache kept on the device
  // (`lib/query-persist.ts`): a new build starts with an empty one.
  define: {
    __BUILD_ID__: JSON.stringify(
      process.env.BUILD_ID ?? new Date().toISOString(),
    ),
  },
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
    port: 5275,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true, secure: true },
    },
    fs: {
      // The shared contract package lives beside this app, not inside it.
      allow: [path.resolve(__dirname, ".."), path.resolve(__dirname)],
    },
  },
})
