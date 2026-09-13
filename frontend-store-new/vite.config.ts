import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

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

// And to the CLOUD, for the HR screens — the first thing in this app that
// addresses the centre at all.
//
// It is not a change of mind about the architecture. The Edge has no HR:
// there is no employee, no roster, no attendance and no leave in
// `backend/src/edge/` or in `backend/migrations/sqlite/`, because a shop's
// rota is a fact about the company rather than about the shop's machine.
// Those five screens are therefore NOT offline-first, and they say so on
// screen rather than drawing an empty rota when the line is down.
//
// Default to a cloud node on this laptop. There is a hosted one, but pointing
// a dev till at production HR by default is how somebody approves real leave
// while testing a layout.
const cloudTarget = process.env.VITE_CLOUD_TARGET ?? "http://127.0.0.1:8080"

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
    port: 5275,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true, secure: true },
      // The cloud's own `/api/v1/*`, reached under a prefix this origin owns
      // and stripped before it is forwarded. The prefix is what keeps the two
      // backends apart in one app: `/api` is this shop, `/central/api` is head
      // office, and neither client has to know the other exists. It cannot
      // collide with `/api`, and it is not a route this app serves — every
      // screen path here begins `/sell`, `/catalogue`, `/stock`, `/money`,
      // `/hr`, `/shop` or `/node`.
      //
      // **The cloud's `Set-Cookie` is thrown away here, and it has to be.**
      // Both backends name their cookies identically — `inventory_session`
      // and `inventory_csrf`, from `security.rs` — and the cloud's login sets
      // both with `Path=/` and no `Domain`, so proxied onto this origin they
      // land on top of the till's. A manager opening the rota would overwrite
      // the cashier's counter session, silently, and the next thing scanned
      // would be a 403 with a customer standing there.
      //
      // Carrying a bearer token is only half the fix: it stops this app from
      // *sending* the wrong cookie, and does nothing about the browser
      // *storing* one. This is the other half. Nothing is lost — the
      // head-office session is the token in the login response body, and
      // `src/lib/cloud.ts` sends no cookies to the centre at all.
      //
      // **Production still needs a rule here, and it needs both halves.**
      // Render serves this front end from one origin and rewrites `/api/*` to
      // the store node; nothing today rewrites `/central/*` to the cloud
      // service, so the HR screens would 404 against the till's own node until
      // that second rewrite exists — and it must drop the centre's
      // `Set-Cookie` too, or the collision above comes back in the one place
      // where somebody is actually taking money. One origin costs a rewrite
      // rule; two origins cost a protocol — the cloud's session cookie is
      // `SameSite=Strict` and the edge mounts no CORS layer at all.
      "/central": {
        target: cloudTarget,
        changeOrigin: true,
        secure: false,
        rewrite: (path: string) => path.replace(/^\/central/, ""),
        configure: (proxy) => {
          proxy.on("proxyRes", (response) => {
            delete response.headers["set-cookie"]
          })
        },
      },
    },
    fs: {
      // The shared contract package lives beside this app, not inside it.
      allow: [path.resolve(__dirname, ".."), path.resolve(__dirname)],
    },
  },
})
