import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// This surface talks to the CLOUD node.
//
// Production serves the front end and its API from one origin (Render rewrites
// `/api/*` to the node), so the client uses a relative base URL and the
// `SameSite=Strict` session cookie is actually sent. Development has to
// reproduce that single origin rather than point the browser at a second one:
// a cross-origin dev setup drops the session cookie, and the login then appears
// to succeed and immediately fail.
const apiTarget = process.env.VITE_API_TARGET ?? "https://itulah-cloud.onrender.com"

// And to a DC EDGE node, for the Operations module.
//
// A warehouse console reads the machine standing in the warehouse, so this is
// a second backend and there is no hosted one to fall back to — a DC runs in
// the building it belongs to. Default to a node on this machine.
const edgeTarget = process.env.VITE_EDGE_TARGET ?? "http://127.0.0.1:8080"

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
    port: 5273,
    proxy: {
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
        rewrite: (path) => path.replace(/^\/edge/, ""),
      },
    },
    fs: {
      // The shared contract package lives beside this app, not inside it.
      allow: [path.resolve(__dirname, ".."), path.resolve(__dirname)],
    },
  },
})
