import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import type { NextConfig } from "next"
import webpack from "webpack"

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const hub = path.resolve(here, "../frontend-hub/src")
const contract = path.resolve(here, "../frontend-contract/src")

const nextConfig: NextConfig = {
  basePath: process.env.NEXT_BASE_PATH ?? "",
  env: {
    NEXT_PUBLIC_ROUTER_BASEPATH: process.env.NEXT_BASE_PATH ?? "",
    NEXT_PUBLIC_DC_HOSTING: process.env.NEXT_DC_HOSTING ?? "cloud",
    NEXT_PUBLIC_EDGE_BASE: process.env.NEXT_PUBLIC_EDGE_BASE ?? "/edge",
  },
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(here, ".."),
  async rewrites() {
    const rust = process.env.RUST_API_ORIGIN ?? "http://127.0.0.1:5480"
    const edge = process.env.EDGE_API_ORIGIN ?? rust
    const rembg = process.env.REMBG_ORIGIN ?? rust
    return [
      { source: "/api/v1/:path*", destination: `${rust}/api/v1/:path*`, basePath: false },
      { source: "/edge/:path*", destination: `${edge}/:path*`, basePath: false },
      { source: "/rembg/:path*", destination: `${rembg}/:path*`, basePath: false },
    ]
  },
  webpack(config) {
    config.resolve.modules = [
      path.join(here, "node_modules"),
      ...(config.resolve.modules ?? ["node_modules"]),
    ]
    config.resolve.alias = {
      ...config.resolve.alias,
      "@/lib/api$": path.join(here, "src/hub-api.ts"),
      "@/lib/prefetch$": path.join(here, "src/hub-prefetch.ts"),
      "@/components/shell/app-shell$": path.join(here, "src/hub-app-shell.tsx"),
      "@/lib/pwa$": path.join(here, "src/hub-pwa.ts"),
      "@/screens/procurement/po-pdf$": path.join(here, "src/hub-po-pdf.ts"),
      "@itulah/contract/client$": path.join(contract, "client/index.ts"),
      "@itulah/contract/money$": path.join(contract, "money/index.ts"),
      "@itulah/contract/reporting$": path.join(contract, "reporting/index.ts"),
      "@itulah/contract$": path.join(contract, "index.ts"),
      "react$": require.resolve("react"),
      "react-dom$": require.resolve("react-dom"),
      "@tanstack/react-query$": require.resolve("@tanstack/react-query"),
      "@tanstack/react-router$": require.resolve("@tanstack/react-router"),
      "@": hub,
    }
    config.plugins.push(
      new webpack.DefinePlugin({
        "import.meta.env.DEV": JSON.stringify(false),
        "import.meta.env.PROD": JSON.stringify(true),
        "import.meta.env.VITE_TENANCY": JSON.stringify("off"),
        "import.meta.env.VITE_HIDE_DOMAINS": JSON.stringify(""),
        "import.meta.env.VITE_EDGE_BASE": JSON.stringify("/edge"),
      })
    )
    return config
  },
}

export default nextConfig
