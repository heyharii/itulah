#!/usr/bin/env node
/**
 * Which edge endpoints this app actually reaches.
 *
 * The naive version of this — grep the route string across `src/` and the
 * shared client — reported 60/60 for an app that has never heard the word
 * "koli". `frontend-contract/src/client/dc.ts` calls every DC route, so
 * scanning it makes every app look complete regardless of what it uses.
 *
 * So the walk is two steps: parse the client into method → route, then ask
 * which of those methods this app's own `src/` calls. A route is covered when
 * `src/` names its path directly, or calls a client method that does.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const CONTRACT = join(ROOT, "..", "frontend-contract", "src", "client")
const ROUTER = join(ROOT, "..", "backend", "src", "edge", "http.rs")

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory()
      ? walk(full)
      : /\.tsx?$/.test(entry)
        ? [full]
        : []
  })
}

const routes = [
  ...new Set(
    [...readFileSync(ROUTER, "utf8").matchAll(/\.route\(\s*"([^"]+)"/g)].map(
      (m) => m[1],
    ),
  ),
].sort()

/** The literal part of a route, up to its first parameter. */
const prefixOf = (route) => {
  const brace = route.indexOf("{")
  return brace === -1 ? route : route.slice(0, brace)
}

/**
 * method name → the route prefixes its body mentions.
 *
 * A class method here is `name(args) { … }` at one indent level, and its body
 * runs to the next method at the same indent. Crude, and adequate: these files
 * are generated-adjacent and uniformly formatted.
 */
function clientMethods() {
  const map = new Map()
  for (const file of walk(CONTRACT)) {
    const source = readFileSync(file, "utf8")
    const lines = source.split("\n")
    let current = null
    for (const line of lines) {
      const start = /^ {2}(?:async )?([a-zA-Z][a-zA-Z0-9_]*)\s*\(/.exec(line)
      if (start && !["constructor", "if", "for", "while"].includes(start[1])) {
        current = start[1]
        if (!map.has(current)) map.set(current, [])
      }
      if (current) {
        for (const [, path] of line.matchAll(/`?(\/api\/v1\/[^`"'?\s$]*)/g)) {
          map.get(current).push(path)
        }
      }
    }
  }
  return map
}

/**
 * The Edge binary serves several surfaces from one router. Keep the DC route
 * family in the audit (the unused DC routes belong to the opposite Edge role),
 * but do not require this warehouse console to call Store, attendance,
 * terminal administration, RFID-reader, catalogue-delivery, or ledger-history
 * endpoints that belong to other screens and processes.
 */
const OTHER_ROLE_PREFIXES = ["/api/v1/dc/"]
const OUTSIDE_FLOOR_PREFIXES = [
  "/api/v1/attendance/",
  "/api/v1/auth/fingerprints",
  "/api/v1/auth/methods",
  "/api/v1/auth/pin/",
  "/api/v1/auth/pins",
  "/api/v1/auth/terminals",
  "/api/v1/catalog/campaign-image",
  "/api/v1/catalog/image",
  "/api/v1/catalog/snapshot",
  "/api/v1/inventory/movements",
  "/api/v1/rfid/",
  "/api/v1/store/",
]

const app = walk(join(ROOT, "src"))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n")

const methods = clientMethods()
const reachable = new Set()
for (const [name, paths] of methods) {
  // A method counts only if this app calls it by name.
  if (new RegExp(`\\.${name}\\s*\\(`).test(app)) {
    for (const path of paths) reachable.add(path)
  }
}

const missing = []
const otherRole = []
const outsideFloor = []
let covered = 0
for (const route of routes) {
  const prefix = prefixOf(route)
  const direct = app.includes(prefix)
  const viaClient = [...reachable].some((path) => path.startsWith(prefix))
  if (direct || viaClient) covered += 1
  else if (OTHER_ROLE_PREFIXES.some((outside) => route.startsWith(outside))) {
    otherRole.push(route)
  } else if (
    OUTSIDE_FLOOR_PREFIXES.some((outside) => route.startsWith(outside))
  ) {
    outsideFloor.push(route)
  } else missing.push(route)
}

const mine = covered + missing.length
console.log(`endpoints: ${covered}/${mine} reached from src/`)
if (otherRole.length > 0) {
  console.log(`(${otherRole.length} belong to the other Edge role)`)
}
if (outsideFloor.length > 0) {
  console.log(`(${outsideFloor.length} belong to other Edge surfaces)`)
}
if (missing.length > 0) {
  console.log("\nnot reached:")
  for (const route of missing) console.log(`  ${route}`)
  process.exit(1)
}
