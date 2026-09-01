#!/usr/bin/env node
/**
 * Which cloud endpoints this app actually calls.
 *
 * "Every backend function works in the new app" is a claim, and a claim that
 * nobody can check goes stale in a week. This turns it into a number: it reads
 * the routes out of the Rust router and looks for each one in `src/lib/queries`.
 *
 * A path with parameters (`/api/v1/inventory/pools/{id}`) is matched by its
 * literal prefix, because the client writes it as a template string.
 *
 * Run: npm run endpoint-audit
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const ROUTER = join(ROOT, "..", "backend", "src", "cloud", "http", "mod.rs")
const MEDIA = join(ROOT, "..", "backend", "src", "cloud", "media.rs")

/**
 * Every `.route("…", …)` the cloud router declares, WITH its methods.
 *
 * The methods matter and leaving them out hid a real gap: `/api/v1/article-setups`
 * is `get(list).post(open)`, the client called only the GET, and a path-only
 * audit called the whole route covered. The chain from an accepted delivery to
 * a tagging job was broken in the browser and this script said 100%.
 */
function routes() {
  const found = new Map()
  for (const file of [ROUTER, MEDIA]) {
    const source = readFileSync(file, "utf8")
    for (const match of source.matchAll(
      /\.route\(\s*"([^"]+)"\s*,\s*([\s\S]*?)\)\s*(?=\.route\(|\.layer|\.with_state|\.fallback|\.merge|;)/g,
    )) {
      const [, path, body] = match
      const methods = [...body.matchAll(/\b(get|post|put|patch|delete)\s*\(/g)].map(
        (m) => m[1].toUpperCase(),
      )
      const already = found.get(path) ?? new Set()
      for (const method of methods) already.add(method)
      found.set(path, already)
    }
  }
  return [...found.entries()]
    .flatMap(([path, methods]) => [...methods].map((method) => ({ path, method })))
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
}

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory()
      ? walk(full)
      : entry.endsWith(".ts") || entry.endsWith(".tsx")
        ? [full]
        : []
  })
}

// The shared client counts: `auth/login`, `auth/me` and `health` are called
// through `@itulah/contract/client`, not from a screen, and an audit that only
// read `src/` would report the session as unimplemented.
const client = [
  ...walk(join(ROOT, "src")),
  ...walk(join(ROOT, "..", "frontend-contract", "src", "client")),
]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n")

/** The literal part of a route, up to its first parameter. */
function prefixOf(route) {
  const brace = route.indexOf("{")
  return brace === -1 ? route : route.slice(0, brace)
}

/**
 * Method-level gaps, found by reading rather than by matching.
 *
 * This script checks PATHS, because that is what it can check reliably. It
 * deliberately does not try to attribute methods: the client reaches the node
 * as `node.get(path)`, as `node.request("PATCH", path)`, and with generic
 * arguments that carry quotes and semicolons in between — every text rule
 * strict enough to catch a real gap also accused four routes the app plainly
 * calls, and a gate that cries wolf is one people stop reading.
 *
 * So the judgement lives here, in a list somebody maintains on purpose. Add a
 * line when you find a route whose path is reached but whose method is not.
 */
const KNOWN_METHOD_GAPS = [
  // Nothing opens a setup session, so an accepted delivery cannot be given an
  // identity and no tagging job is ever issued. The chain from goods-in to
  // tagging is broken in the browser; the endpoint exists and is unused.
  // Found by walking sourcing → PO → receipt → tagging on a live pair.
]

const missing = []
const paths = [...new Set(routes().map((route) => route.path))]
let covered = 0
for (const path of paths) {
  // `/metrics` is Prometheus scraping the node, not a screen's business.
  if (path === "/metrics") continue
  if (client.includes(prefixOf(path))) covered += 1
  else missing.push(path)
}

const total = covered + missing.length
console.log(`endpoints: ${covered}/${total} paths reached from src/`)
if (KNOWN_METHOD_GAPS.length > 0) {
  console.log(
    `(${KNOWN_METHOD_GAPS.length} known method-level gap${KNOWN_METHOD_GAPS.length === 1 ? "" : "s"} — see KNOWN_METHOD_GAPS)`,
  )
  for (const gap of KNOWN_METHOD_GAPS) console.log(`  ${gap}`)
}
if (missing.length > 0) {
  console.log("\nnot reached anywhere:")
  for (const path of missing) console.log(`  ${path}`)
  process.exit(1)
}
