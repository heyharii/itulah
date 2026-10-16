#!/usr/bin/env node
/**
 * The built hub, served on this machine the way production serves it.
 *
 * Production runs the Nitro server (`node .output/server/index.mjs`) behind a
 * reverse proxy that sends `/api` to the cloud node and `/edge` to the DC node,
 * so the browser sees one origin and the `SameSite=Strict` session cookie is
 * sent. `vite preview` cannot stand in for that any more: Start's preview
 * serves its own non-Nitro output, which this build does not write. So this
 * starts the Nitro server on the next port and puts the same three-way proxy
 * in front of it.
 *
 *   PORT                (default 4173)  where the browser connects
 *   VITE_API_TARGET     (default https://itulah-cloud.onrender.com)
 *   VITE_EDGE_TARGET    (default http://127.0.0.1:8081)
 *   VITE_REMBG_TARGET   (default http://127.0.0.1:7100)
 */
import { spawn } from "node:child_process"
import http from "node:http"
import https from "node:https"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const port = Number(process.env.PORT ?? 4173)
const inner = port + 1
const api = process.env.VITE_API_TARGET ?? "https://itulah-cloud.onrender.com"
const edge = process.env.VITE_EDGE_TARGET ?? "http://127.0.0.1:8081"
const rembg = process.env.VITE_REMBG_TARGET ?? "http://127.0.0.1:7100"

const server = spawn("node", [path.join(root, ".output/server/index.mjs")], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: String(inner),
    HOST: "127.0.0.1",
    // The SSR pass reads the cloud node directly (`lib/api.ts`).
    ITULAH_CLOUD_URL: process.env.ITULAH_CLOUD_URL ?? api,
  },
})
server.on("exit", (code) => process.exit(code ?? 0))
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.kill(signal)
    process.exit(0)
  })
}

/// Where a request goes, and the path it arrives with.
function route(url) {
  if (url.startsWith("/api/") || url === "/api") return [api, url]
  if (url.startsWith("/edge/")) return [edge, url.slice("/edge".length)]
  if (url.startsWith("/rembg/")) return [rembg, url.slice("/rembg".length)]
  return [`http://127.0.0.1:${inner}`, url]
}

http
  .createServer((request, response) => {
    const [base, rest] = route(request.url ?? "/")
    const target = new URL(rest, base)
    const client = target.protocol === "https:" ? https : http
    const upstream = client.request(
      target,
      {
        method: request.method,
        headers: { ...request.headers, host: target.host },
      },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, answer.headers)
        // Piped as it arrives: the SSR document streams.
        answer.pipe(response)
      }
    )
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502)
      response.end()
    })
    request.pipe(upstream)
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`hub preview: http://127.0.0.1:${port}`)
  })
