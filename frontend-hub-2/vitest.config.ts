import { fileURLToPath } from "node:url"
import path from "node:path"
import { defineConfig } from "vitest/config"

/// Tests run against the source, not the bundle.
///
/// No jsdom: nothing tested here touches the DOM. The pieces worth testing in
/// this app are the DECISIONS — which columns fit, how a figure is written —
/// and rendering a component to assert it drew a `<td>` tests React rather than
/// the app. A test that needs a browser belongs in the browser.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
})
