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
}

/// Hosts the built surface will answer to.
///
/// Vite refuses a request whose `Host` it does not recognise, which is right:
/// a preview server that answers to any name can be reached through somebody
/// else's DNS. Portless fronts this process as `<name>.localhost` over its own
/// HTTPS, so that suffix — and nothing wider — is what has to be allowed.
const previewHosts = [".localhost"]

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
})
