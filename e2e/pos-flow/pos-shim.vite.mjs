// The counter app (pos-desktop/ui) in an ordinary browser, for headless tests.
//
// pos-desktop/ui never calls `fetch`: every node call goes through the Tauri
// shell (`edge_call`, src-tauri/src/edge.rs). Outside the shell every call
// refuses on purpose, so a headless browser cannot drive the till as it is.
// This config serves the same UI and injects a stand-in for the shell's
// bridge that does what `session_attempt` does — base URL + path, the bearer
// token, `X-Terminal-Id` — through a same-origin proxy to the store node
// (the node sends no CORS headers, which is right).
//
// Devices answer "not attached", receipts go nowhere. Nothing here is a
// second implementation of the till: the page, the basket, the tender screen
// and every call it makes are the real app's.
//
//   STORE_TARGET=http://127.0.0.1:8482 PORT=5419 \
//     npx vite --config ../../e2e/pos-flow/pos-shim.vite.mjs   (cwd pos-desktop/ui)

import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const ui = path.resolve(here, "../../pos-desktop/ui")
// This file lives outside the app, so its packages are the app's own.
const fromUi = createRequire(path.join(ui, "package.json"))
const load = async (name) => import(pathToFileURL(fromUi.resolve(name)).href)
const react = (await load("@vitejs/plugin-react")).default
const { defineConfig } = await load("vite")
const store = process.env.STORE_TARGET ?? "http://127.0.0.1:8482"
const port = Number(process.env.PORT ?? 5419)
const terminal = process.env.TERMINAL_ID ?? "POS-01"

// Runs in the page before the app. Mirrors NodeConfig::default() and
// Peripherals::default() with the receipt printer off.
const bridge = `
(() => {
  const KEY = "pos-shim:node-config"
  const initial = {
    base_url: ${JSON.stringify(store)}, token: null, terminal_id: ${JSON.stringify(terminal)},
    printer_host: null, printer_port: 9100, paper: "WIDE",
    pairing_id: null, pairing_secret: null, pairing_sequence: 0,
    simulate_fingerprint: null, joined: null,
    peripherals: { customer_display: false, customer_display_on_start: false,
      desk_reader: null, cash_drawer: null, scanner: null, receipt_printer: "NONE",
      printer_id: null, printer_label: null, usb_printer_model: null,
      usb_printer_name: null, unsent: false, reported_at: null },
    node_instance: null, node_host: null, moved_from: null,
  }
  const read = () => { try { return { ...initial, ...JSON.parse(localStorage.getItem(KEY) || "{}") } } catch { return initial } }
  const write = (c) => { try { localStorage.setItem(KEY, JSON.stringify(c)) } catch {} ; return c }
  async function call(method, path, body) {
    const c = read()
    const headers = { Accept: "application/json", "X-Terminal-Id": c.terminal_id }
    if (c.token) headers.Authorization = "Bearer " + c.token
    if (body !== undefined && body !== null) headers["Content-Type"] = "application/json"
    let res
    try {
      res = await fetch("/__edge" + path, { method, headers,
        body: body === undefined || body === null ? undefined : JSON.stringify(body) })
    } catch (e) {
      return { ok: false, status: 0, body: null, problem: "shim: node unreachable: " + e }
    }
    const text = await res.text()
    let parsed = null
    try { parsed = text ? JSON.parse(text) : null } catch {}
    const ok = res.status >= 200 && res.status < 300
    const problem = ok ? null : ((parsed && (parsed.message || parsed.error)) || text ||
      ("The shop node refused this with a " + res.status + " and said nothing."))
    return { ok, status: res.status, body: parsed, problem }
  }
  const commands = {
    node_config: () => read(),
    set_node_config: ({ next }) => write({ ...read(), ...next }),
    edge_call: ({ method, path, body }) => call(method, path, body),
    edge_signed_call: () => ({ ok: false, status: 0, body: null, problem: "shim: terminal is not paired" }),
    rfid_state: () => ({ bound: false, detail: "shim: no reader" }),
    fingerprint_state: () => ({ bound: false, detail: "shim: no scanner" }),
    open_drawer: () => ({ bound: false, detail: "shim: no drawer" }),
    fingerprint_identify: () => ({ bound: false, actor_id: null, score: null, detail: "shim" }),
    set_peripherals: ({ next }) => ({ config: write({ ...read(), peripherals: next }), reported: false, problem: "shim" }),
    report_peripherals: () => ({ config: read(), reported: false, problem: "shim" }),
    discover_nodes: () => [],
    join_current: () => null,
    local_printers: () => [],
  }
  window.__TAURI_INTERNALS__ = {
    invoke: async (command, args = {}) => {
      const run = commands[command]
      if (!run) throw new Error("shim: shell command '" + command + "' is not available in a browser")
      return run(args)
    },
  }
  window.__POS_SHIM__ = { read, write }
})()
`

export default defineConfig({
  root: ui,
  plugins: [
    react(),
    {
      name: "pos-shim-bridge",
      transformIndexHtml: () => [{ tag: "script", children: bridge, injectTo: "head-prepend" }],
    },
  ],
  server: {
    port,
    strictPort: true,
    proxy: {
      "/__edge": {
        target: store,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/__edge/, ""),
      },
    },
  },
  clearScreen: false,
  resolve: {
    alias: {
      "@": path.resolve(ui, "src"),
      "@epc": path.resolve(ui, "../../frontend-store-new/src/lib/epc.ts"),
      "@itulah/contract/money": path.resolve(ui, "../../frontend-contract/src/money/index.ts"),
      "@itulah/contract": path.resolve(ui, "../../frontend-contract/src/index.ts"),
    },
  },
})
