import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

/// This surface talks to the CLOUD node.
///
/// Production serves the front end and its API from one origin, so the client
/// uses a relative base URL and the `SameSite=Strict` session cookie is
/// actually sent. Development has to reproduce that single origin rather than
/// point the browser at a second one: a cross-origin dev setup drops the
/// session cookie, and the login then appears to succeed and immediately fail.
///
/// This app deliberately proxies ONE backend. `frontend-hub` proxies two —
/// the cloud and a DC edge node — because its Operations module reads the
/// machine standing in the warehouse. Nothing here does yet, and a proxy rule
/// for a backend no screen calls is a rule nobody can tell is broken.
const apiTarget = process.env.VITE_API_TARGET ?? "http://127.0.0.1:8080"

const backends = {
  "/api": { target: apiTarget, changeOrigin: true, secure: true },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // The contract is GENERATED from the Rust types by `make contract`. It
      // is not part of what this app rewrites and must never be hand-edited
      // here: the day these types are written by hand is the day the client
      // and the server can disagree without anything failing to compile.
      "@itulah/contract/money": path.resolve(
        __dirname,
        "../frontend-contract/src/money/index.ts",
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
    port: 5320,
    proxy: backends,
    fs: { allow: [path.resolve(__dirname, ".."), path.resolve(__dirname)] },
  },
  preview: {
    port: Number(process.env.PORT ?? 4174),
    strictPort: true,
    allowedHosts: [".localhost"],
    proxy: backends,
  },
})
