// TEMPORARY, measuring only: the app without its service worker.
import path from "path"
import type { Plugin, PluginOption, UserConfig } from "vite"

import base from "./vite.config"

const named = (p: PluginOption): p is Plugin =>
  typeof p === "object" && p !== null && !Array.isArray(p) && "name" in p

const config = base as UserConfig
export default {
  ...config,
  plugins: (config.plugins ?? [])
    .flat()
    .filter((p) => !(named(p) && p.name.startsWith("vite-plugin-pwa"))),
  resolve: {
    ...config.resolve,
    alias: {
      ...(config.resolve?.alias as Record<string, string>),
      "virtual:pwa-register": path.resolve(
        __dirname,
        "../../../../private/tmp/claude-501/-Users-hari-Documents-itulah/3b688bae-304b-4568-b5e3-f76bc83a816c/scratchpad/pwa-stub.js",
      ),
    },
  },
} satisfies UserConfig
