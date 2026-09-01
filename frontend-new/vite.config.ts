import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// Built as plain files and served BY the cloud binary from a directory on the
// machine it runs on: one origin, so the session cookie simply works and there
// is no CORS to configure.
//
// In development there is no binary in front of the page, so requests are
// proxied instead — which keeps the browser seeing one origin and keeps
// development honest about the shape production has.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const api = env.API_URL ?? "https://itulah-cloud.onrender.com";

  return {
    base: "./",
    plugins: [react()],
    build: { outDir: "dist", assetsInlineLimit: 8192, sourcemap: true },
    server: {
      proxy: {
        "/api": {
          target: api,
          changeOrigin: true,
          secure: true,
          // The session cookie is set for the API's host; without this the
          // browser files it under a domain the page will never send it back
          // to, and every request after login is anonymous again.
          cookieDomainRewrite: "",
        },
      },
    },
  };
});
