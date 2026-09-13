#!/usr/bin/env node
/// What each screen costs to open, measured rather than guessed.
///
/// ## The three numbers, and why these three
///
///   **calls** — how many DISTINCT `/api/v1` requests the screen makes. Counted
///   distinct on purpose: a dev server aborts and re-issues requests, so the
///   raw count is roughly double and would flatter or alarm at random. This is
///   the number that says whether a screen asks one question or twenty.
///
///   **rows** — the largest `limit` any of those calls asked for. A screen that
///   asks for a thousand rows to show fifty is not slow because the network is
///   slow; it is slow because it decided to be, and no amount of caching fixes
///   a question that was too big.
///
///   **LCP** — when the largest thing a person is waiting for actually
///   appeared. FCP says something painted; LCP says the thing they came for
///   did.
///
/// ## What this cannot tell you
///
/// The backend here is a **debug build** on a laptop, against a seeded
/// database. Its timings are not production timings and must never be quoted
/// as such — a release build is commonly an order of magnitude faster on the
/// same query. What DOES carry over is the shape: how many calls, how big the
/// question, how much of the answer the browser then throws away. Those are
/// decisions in the code, and they are the same in production.
///
///   node scripts/perf.mjs                      # the busiest screens
///   node scripts/perf.mjs /people /commercial  # specific ones
import { execFileSync } from "node:child_process"

const APP = process.env.APP ?? "http://localhost:5273"
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 4000)
const SESSION = "perf"

/// The screens worth measuring first: the ones standing in front of the most
/// data. Everything else is cheap because it is small, not because it is
/// careful, and measuring it first would say the app is fine.
const BUSIEST = [
  "/people",
  "/commercial",
  "/finance/accounts",
  "/inventory/availability",
  "/procurement/purchase-orders",
  "/inventory/pools",
]

function ab(args) {
  return JSON.parse(
    execFileSync("agent-browser", ["--session", SESSION, ...args, "--json"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  )
}

function measure(path) {
  ab(["network", "requests", "--clear"])
  ab(["open", `${APP}${path}`])
  execFileSync("sleep", [String(SETTLE_MS / 1000)])

  const raw = (ab(["network", "requests", "--filter", "/api/v1"]).data
    .requests ?? []).filter((r) => r.resourceType === "Fetch")

  // Distinct by URL. The same question asked twice because React re-rendered is
  // one question as far as the screen's design is concerned; the duplicate is a
  // dev-server artefact, not a decision.
  const urls = [...new Set(raw.map((r) => r.url))]
  let biggest = 0
  for (const url of urls) {
    const m = /[?&]limit=(\d+)/.exec(url)
    if (m) biggest = Math.max(biggest, Number(m[1]))
  }

  const v = ab(["vitals"]).data ?? {}
  const lcp = typeof v.lcp?.startTime === "number" ? Math.round(v.lcp.startTime) : null

  return { path, calls: urls.length, biggest, lcp, urls }
}

const only = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const list = only.length > 0 ? only : BUSIEST
const verbose = process.argv.includes("--urls")

console.log(`perf: ${list.length} screens against ${APP}`)
console.log(`  (debug backend on a laptop — read the shape, not the milliseconds)\n`)
console.log(`  calls  rows-asked   LCP   screen`)

const results = []
for (const path of list) {
  const r = measure(path)
  results.push(r)
  console.log(
    `  ${String(r.calls).padStart(5)}  ${String(r.biggest || "—").padStart(10)}  ${String(r.lcp ?? "—").padStart(5)}   ${r.path}`,
  )
  if (verbose) for (const u of r.urls) console.log(`         ${u.split("/api/v1")[1]}`)
}

const worst = [...results].sort((a, b) => b.calls - a.calls)[0]
const greediest = [...results].sort((a, b) => b.biggest - a.biggest)[0]
console.log(
  `\n  most calls:   ${worst.path} (${worst.calls})` +
    `\n  biggest ask:  ${greediest.path} (${greediest.biggest || 0} rows)`,
)

try {
  ab(["close"])
} catch {
  // Nothing to close is not a failure.
}
