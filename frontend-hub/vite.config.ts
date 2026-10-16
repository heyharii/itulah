import path from "path"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import { nitro } from "nitro/vite"
import { VitePWA } from "vite-plugin-pwa"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

import { screenPreloads } from "./vite.screen-preloads"

// This surface talks to the CLOUD node.
//
// Production serves the front end and its API from one origin (the reverse
// proxy rewrites `/api/*` to the node), so the client uses a relative base URL
// and the `SameSite=Strict` session cookie is actually sent. Development has
// to reproduce that single origin rather than point the browser at a second
// one: a cross-origin dev setup drops the session cookie, and the login then
// appears to succeed and immediately fail.
const apiTarget =
  process.env.VITE_API_TARGET ?? "https://itulah-cloud.onrender.com"

// And to a DC EDGE node, for the Operations module.
//
// A warehouse console reads the machine standing in the warehouse, so this is
// a second backend and there is no hosted one to fall back to — a DC runs in
// the building it belongs to. Default to a node on this machine.
const edgeTarget = process.env.VITE_EDGE_TARGET ?? "http://127.0.0.1:8081"

/// The picture service that takes a background off a garment photo. A local
/// `rembg s` on this machine by default.
const rembgTarget = process.env.VITE_REMBG_TARGET ?? "http://127.0.0.1:7100"

/// The two backends, behind one origin.
///
/// Shared by `server` and `preview` rather than written twice. A built bundle
/// served on this laptop is the same app talking to the same pair of nodes; the
/// only difference is that one is compiled. Two copies of this table is how the
/// deployed surface quietly acquires a proxy rule the dev surface never had —
/// and the symptom is a module that works until it is built.
const backends = {
  "/api": { target: apiTarget, changeOrigin: true, secure: true },
  // The edge node's own `/api/v1/*`, reached under a prefix this origin
  // owns and stripped before it is forwarded. The prefix is what keeps the
  // two backends apart in one app: `/api` is the centre, `/edge/api` is
  // the warehouse, and neither client has to know the other exists.
  //
  // `cookieDomainRewrite`/`cookiePathRewrite` are deliberately absent. The
  // edge session is a bearer token (see `lib/api.ts`), and the cookies this
  // node sets are named exactly as the cloud's are — letting them land on
  // this origin is what would sign the operator out of the centre.
  "/edge": {
    target: edgeTarget,
    changeOrigin: true,
    secure: false,
    rewrite: (path: string) => path.replace(/^\/edge/, ""),
  },
  // The background-removal service (`rembg`), for the item photo's menu. A
  // sibling of the two nodes, not part of either: it only ever sees a picture
  // and hands one back.
  "/rembg": {
    target: rembgTarget,
    changeOrigin: true,
    secure: false,
    rewrite: (path: string) => path.replace(/^\/rembg/, ""),
  },
}

/// Hosts the built surface will answer to.
///
/// Vite refuses a request whose `Host` it does not recognise, which is right:
/// a preview server that answers to any name can be reached through somebody
/// else's DNS. Portless fronts this process as `<name>.localhost` over its own
/// HTTPS, so that suffix — and nothing wider — is what has to be allowed.
const previewHosts = [".localhost"]

/// The hub as an installable app, with a service worker of its own.
///
/// `injectManifest` rather than a generated worker because the reason for the
/// worker is Web Push: `src/sw.ts` shows a notification when the cloud pushes
/// one and opens the right screen when it is tapped, and a generated worker
/// has nowhere to put that.
///
/// `prompt`, not `autoUpdate`: a new build is announced in a toast and loaded
/// when the person says so (`lib/pwa.ts`). Reloading under somebody halfway
/// through a goods receipt is not an update, it is lost work.
///
/// Under SSR there is no `index.html` to read the shell's entry list from, so
/// the precache manifest is empty for now: the worker installs, push works,
/// and the hashed assets a person has fetched are kept per screen by the
/// worker's own runtime cache (`sw.ts`). The offline document shell returns
/// when the entry-asset list can be read out of the Start client build.
/// Nitro's public directory is where the built client lives (see `nitro()`
/// below), so the worker is written beside the assets it serves.
const pwa = VitePWA({
  outDir: path.resolve(__dirname, ".output/public"),
  strategies: "injectManifest",
  srcDir: "src",
  filename: "sw.ts",
  registerType: "prompt",
  injectRegister: false,
  // `public/` holds the icons (`scripts/pwa-icons.mjs` draws them).
  includeAssets: ["apple-touch-icon.png", "pwa-badge-96.png"],
  manifest: {
    name: "Central Dashboard",
    short_name: "Central",
    description: "Head office, shops and warehouses in one place.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // The page's own white, so the splash an installed app opens on is the
    // colour of the screen that replaces it rather than a flash of another.
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
      { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/pwa-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  },
  injectManifest: {
    globPatterns: ["**/*.{js,css,html}"],
    // The entry chunk carries React, Router and Query; over workbox's 2 MB
    // default it would be left out of the precache with only a warning.
    maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
    manifestTransforms: [
      async () => {
        // No document exists to name the shell's files (see above), so the
        // static precache is deliberately empty; the worker's runtime caches
        // carry what a device keeps.
        return { manifest: [], warnings: [] }
      },
    ],
  },
  devOptions: {
    // Off under SSR: the dev worker's `navigateFallback` pointed at
    // `index.html`, which a Start server does not serve. Push is tried
    // against a build.
    enabled: false,
  },
})

export default defineConfig(({ command }) => ({
  plugins: [
    tailwindcss(),
    // react's vite plugin must come after start's vite plugin
    tanstackStart(),
    // The hosting layer for the build: `node .output/server/index.mjs`
    // (Start's hosting guide, Vite on Node). Build only — in development it
    // replaces Vite's own server, and with it the `/api` and `/edge` proxy
    // below that keeps the session cookie on one origin.
    command === "build"
      ? nitro({
          // Assets are written gzip- and brotli-compressed at build time and
          // served pre-compressed: no per-request compression, and a phone
          // on a slow line downloads a third of the bytes.
          compressPublicAssets: { gzip: true, brotli: true },
        })
      : null,
    react(),
    pwa,
    screenPreloads(),
  ],
  // Which build this is, for the persisted query cache (`lib/query-persist.ts`):
  // a new build starts with an empty one.
  define: {
    __BUILD_ID__: JSON.stringify(
      process.env.BUILD_ID ?? new Date().toISOString()
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
        "../frontend-contract/src/money/index.ts"
      ),
      "@itulah/contract/reporting": path.resolve(
        __dirname,
        "../frontend-contract/src/reporting/index.ts"
      ),
      "@itulah/contract/client": path.resolve(
        __dirname,
        "../frontend-contract/src/client/index.ts"
      ),
      "@itulah/contract": path.resolve(
        __dirname,
        "../frontend-contract/src/index.ts"
      ),
    },
  },
  server: {
    port: 5273,
    // Vite's "localhost" binds ::1 on this machine; bind IPv4 so the dev
    // proxy, the node and every probe address the same stack.
    host: "127.0.0.1",
    proxy: backends,
    fs: {
      allow: [path.resolve(__dirname, ".."), path.resolve(__dirname)],
    },
  },

  /// The built bundle, served from this laptop.
  ///
  /// This is a deployment, not a rehearsal: `npm run build` output, served on a
  /// stable HTTPS name by portless, reading the DC node in this room and the
  /// cloud on Render. It carries the proxy because the alternative is changing
  /// both backends — the edge mounts no CORS layer at all, and the cloud's
  /// session cookie is `SameSite=Strict` and would never cross to another
  /// origin. One origin costs a proxy rule; two origins cost a protocol.
  preview: {
    port: Number(process.env.PORT ?? 4173),
    strictPort: true,
    allowedHosts: previewHosts,
    proxy: backends,
  },
}))
