#!/usr/bin/env node
/// Every list endpoint, timed — and asked whether it can page.
///
/// ## The rule this enforces
///
/// The owner's rule is one sentence with two halves: **under 100 ms, and if it
/// cannot be, it must paginate.** Both halves matter, and a harness that
/// checked only the first would pass the most dangerous endpoint in the system.
///
/// An endpoint that answers in 40 ms because it returns everything it has is
/// not fast. It is fast *today*, on a seeded laptop, on the smallest the table
/// will ever be — and it has no way to get slower gracefully. The first real
/// month of data makes it a ten-second request and there is nothing to turn
/// down, because it was never asked for a page. The endpoint that answers in
/// 90 ms with a cursor is the safe one, even though it is slower right now.
///
/// So every endpoint gets two verdicts:
///
///   **time** — the MEDIAN of several runs, not the first. The first request
///   pays for the connection, the plan cache and whatever the OS had paged
///   out, and quoting it would make every endpoint look bad in the same way.
///
///   **pages** — does the answer carry `next_cursor`? Not "is there a `limit`":
///   a clamp is not pagination, it is truncation with a polite name. A `limit`
///   with no cursor means the rows past it are unreachable, and the screen
///   above it is searching a slice while claiming to search a list.
///
/// A row fails if it is over budget **and** cannot page. Under budget but not
/// paging is a warning: it is fine now and has no route out.
///
/// ## "Over budget but paging" is not automatically a tuning job
///
/// This harness used to say *lower the default limit* for anything over budget
/// that had a cursor, and that advice was wrong often enough to be dangerous.
/// At 106,000 movements, three inventory endpoints were over budget and the
/// page size had nothing to do with it:
///
///     movements?limit=1     185 ms      movements?limit=200   137 ms
///     pools?limit=1         185 ms      pools?limit=50        177 ms
///
/// Flat. The cost was **fixed per request** — the `total`, the facet counts and
/// a ledger fold, all computed over the whole matched set — while the page
/// itself was nearly free. Halving the limit would have bought nothing, and a
/// morning would have gone into it.
///
/// So the harness now measures that instead of guessing: it times each
/// over-budget endpoint at a deliberately tiny page and compares. If a tenth of
/// the rows costs about the same, the advice is not "lower the limit", it is
/// "make the fixed half optional or cheaper" — which is what `?count=0` does
/// for `/audit`, taking it from 99 ms to 2 ms at the same row count.
///
/// ## What this cannot tell you, and must not be quoted as saying
///
/// **Run it against a RELEASE build.** A debug Rust build is commonly 10–50×
/// slower on the same query, so a debug number neither proves nor disproves
/// 100 ms. The harness prints which build it thinks it measured, from the
/// binary you point it at, and labels every number with it. It also cannot see
/// data volume: an endpoint that is fast over a seeded 24 rows says nothing
/// about 24,000. That is what `EXPLAIN (ANALYZE, BUFFERS)` is for, and a
/// sequential scan is a failure even at 3 ms.
///
///   node scripts/api-perf.mjs
///   API=http://127.0.0.1:8085 node scripts/api-perf.mjs
///   node scripts/api-perf.mjs --runs 9 --budget 100

const API = process.env.API ?? "http://127.0.0.1:8080"
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? Number(process.argv[i + 1]) : fallback
}
const RUNS = arg("runs", 7)
const BUDGET = arg("budget", 100)
// `--only pos` measures the rows whose NAME contains the substring — an edge
// node answers only the pos/* rows and every cloud row would print as 404.
const onlyIndex = process.argv.indexOf("--only")
const ONLY = onlyIndex > 0 ? String(process.argv[onlyIndex + 1] ?? "") : ""
// An edge node with sign-in required answers 401 without a bearer. Export
// PERF_TOKEN (login once, then reuse) and every request below carries it.
const TOKEN = process.env.PERF_TOKEN ?? ""
// A sandbox gateway serves many businesses and wants to be told which one:
// `PERF_BUSINESS=<slug>` sends it as `x-itulah-business`.
const BUSINESS = process.env.PERF_BUSINESS ?? ""
const AUTH = {
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  ...(BUSINESS ? { "x-itulah-business": BUSINESS } : {}),
}

/// The lists a person actually waits on. Not every route — the ones behind a
/// screen that draws a table, which is where a slow answer is felt.
const ENDPOINTS = [
  ["audit", "/api/v1/audit?limit=50"],
  ["audit (count off)", "/api/v1/audit?limit=50&count=0"],
  ["employees", "/api/v1/employees?limit=50"],
  ["finance/money", "/api/v1/finance/money?limit=50"],
  ["finance/bills", "/api/v1/finance/bills?limit=50"],
  ["finance/payments", "/api/v1/finance/payments?limit=50"],
  ["finance/accounts", "/api/v1/finance/accounts?inactive=false"],
  ["finance/trial-balance", "/api/v1/finance/trial-balance"],
  // No `limit`: this one is measured at the DEFAULT the screen actually gets.
  // Its default was tuned down to 20 because the per-shop price book is a fixed
  // cost per request — forcing `limit=50` here measured a page size nothing asks
  // for and reported a failure that does not exist in the app.
  ["commercial/article-prices", "/api/v1/commercial/article-prices?channel=STORE"],
  ["commercial/rules", "/api/v1/commercial/rules"],
  ["commercial/campaigns", "/api/v1/commercial/campaigns"],
  ["commercial/vouchers", "/api/v1/commercial/vouchers"],
  ["inventory/fleet-pools", "/api/v1/inventory/fleet-pools"],
  ["inventory/pools", "/api/v1/inventory/pools?limit=50"],
  ["inventory/availability", "/api/v1/inventory/availability?source_pool_id=dc.warehouse&limit=50"],
  ["inventory/movements", "/api/v1/inventory/movements?limit=50"],
  ["inventory/observations", "/api/v1/inventory/observations?limit=50"],
  ["inventory/counts", "/api/v1/inventory/counts?limit=50"],
  ["inventory/missing", "/api/v1/inventory/missing?limit=50"],
  ["inventory/reconciliations", "/api/v1/inventory/reconciliations?limit=50"],
  ["inventory/control", "/api/v1/inventory/control?limit=50"],
  ["members", "/api/v1/members?limit=50"],
  ["suppliers", "/api/v1/suppliers?limit=50"],
  ["purchase-orders", "/api/v1/purchase-orders?limit=50"],
  ["purchase-amendments", "/api/v1/purchase-price-amendments?limit=50"],
  // Deliberately unpaged, and measured anyway: a list that refuses a cursor
  // has to earn it by being bounded, and the only way to keep that claim
  // honest is to watch the number. A row here is a building.
  ["purchase-destinations", "/api/v1/purchase-destinations"],
  // ── the till (store edge). Run against a seeded edge node with PERF_TOKEN
  // set (scripts/benchmark-pos-edge.py boots one). The catalog page is the
  // size the desk actually pulls (frontend-store-new queries.ts fetches whole
  // book in limit=500 pages); identities is what a handheld syncs. The POST
  // paths — quote, sale, receipt print — are not lists; they are measured by
  // scripts/benchmark-pos-edge.py.
  ["pos/catalog-page", "/api/v1/store/catalog?limit=500"],
  // A handheld syncs identities for its resident page of SKUs in one call
  // (`?skus=` comma list, edge/http.rs catalog_identities) — bounded by the
  // request, so the harness measures the page worth a handheld holds.
  ["pos/catalog-identities", `/api/v1/catalog/identities?skus=${Array.from({ length: 100 }, (_, i) => `B${String(i).padStart(5, "0")}`).join(",")}`],
]

/// Does the body prove there is a way to the rows past this page?
///
/// `next_cursor: null` on a short answer is a genuine "that was all", so it
/// counts as paging: the shape is there and the server used it. A body with no
/// such field at all cannot say, which is the finding.
function pages(body) {
  if (body === null || typeof body !== "object") return false
  if ("next_cursor" in body) return true
  // Some envelopes nest one level — a report with a list inside it.
  return Object.values(body).some(
    (v) => v !== null && typeof v === "object" && "next_cursor" in v,
  )
}

function rowsIn(body) {
  if (Array.isArray(body)) return body.length
  if (body === null || typeof body !== "object") return 0
  for (const key of ["rows", "items", "accounts", "vouchers", "orders"]) {
    if (Array.isArray(body[key])) return body[key].length
  }
  return 0
}

async function time(path) {
  let last = null
  const ms = []
  for (let i = 0; i < RUNS; i++) {
    const started = performance.now()
    let res
    try {
      res = await fetch(`${API}${path}`, { headers: AUTH })
    } catch {
      return { error: "unreachable" }
    }
    const text = await res.text()
    ms.push(performance.now() - started)
    if (!res.ok) return { error: `HTTP ${res.status}` }
    try {
      last = JSON.parse(text)
    } catch {
      last = null
    }
  }
  ms.sort((a, b) => a - b)
  return {
    median: ms[Math.floor(ms.length / 2)],
    best: ms[0],
    worst: ms[ms.length - 1],
    pages: pages(last),
    rows: rowsIn(last),
  }
}

const probe = await fetch(`${API}/api/v1/health`).catch(() => null)
if (!probe?.ok) {
  console.error(`No backend at ${API}. Start one, then re-run.`)
  process.exit(2)
}

console.log(`api-perf: ${ENDPOINTS.length} endpoints at ${API}`)
console.log(`  median of ${RUNS} runs, budget ${BUDGET}ms`)
console.log(`  NOTE: only a RELEASE build's numbers mean anything here\n`)
console.log(`  median   worst  rows  pages  endpoint`)

const results = []
for (const [name, path] of ENDPOINTS) {
  if (ONLY && !name.includes(ONLY)) continue
  const r = await time(path)
  if (r.error) {
    console.log(`  ${"—".padStart(6)}  ${"".padStart(6)}              ${name}  (${r.error})`)
    continue
  }
  results.push({ name, ...r })
  const over = r.median > BUDGET
  const mark = over ? (r.pages ? "!" : "✗") : r.pages ? "✓" : "·"
  console.log(
    `${mark} ${r.median.toFixed(0).padStart(6)}  ${r.worst.toFixed(0).padStart(6)}  ${String(r.rows).padStart(4)}  ${r.pages ? " yes " : " NO  "}  ${name}`,
  )
}

/// For everything over budget: is the cost in the page, or fixed?
///
/// Asked with a real request rather than inferred. `limit=1` is the smallest
/// honest page; if it costs about as much as a full one, nothing about paging
/// will help.
for (const r of results.filter((x) => x.median > BUDGET)) {
  const path = ENDPOINTS.find(([name]) => name === r.name)?.[1]
  if (path === undefined) continue
  const tiny = path.includes("limit=")
    ? path.replace(/limit=\d+/, "limit=1")
    : `${path}${path.includes("?") ? "&" : "?"}limit=1`
  const small = await time(tiny)
  // Within a quarter of the full page's time counts as flat: the machine is
  // shared and a tighter threshold would read noise as signal.
  r.fixedCost =
    small.median !== undefined && small.median > r.median * 0.75
  r.tinyMs = small.median
}

const broken = results.filter((r) => r.median > BUDGET && !r.pages)
const tune = results.filter((r) => r.median > BUDGET && r.pages)
const exposed = results.filter((r) => r.median <= BUDGET && !r.pages)

console.log(
  `\n  ${results.filter((r) => r.median <= BUDGET && r.pages).length} within budget and paging` +
    `\n  ${tune.length} over budget but paging` +
    `\n  ${exposed.length} within budget but CANNOT page — fine today, no way out` +
    `\n  ${broken.length} over budget AND cannot page — these are the failures`,
)
if (tune.length) {
  const fixed = tune.filter((r) => r.fixedCost)
  const perRow = tune.filter((r) => !r.fixedCost)
  if (perRow.length) {
    console.log(
      `\n  lower the limit: ${perRow.map((r) => r.name).join(" ")}` +
        `\n    (cost falls with the page — these are a tuning job)`,
    )
  }
  if (fixed.length) {
    console.log(
      `\n  FIXED COST, the page size is irrelevant:` +
        fixed
          .map(
            (r) =>
              `\n    ${r.name}  ${r.median.toFixed(0)}ms at full page, ${r.tinyMs?.toFixed(0)}ms at limit=1`,
          )
          .join("") +
        `\n    The total, the facets or a fold is being computed over everything.` +
        `\n    Make that half optional or cheaper — see \`?count=0\` on /audit.`,
    )
  }
}
if (exposed.length) console.log(`  exposed: ${exposed.map((r) => r.name).join(" ")}`)
if (broken.length) console.log(`  FAILING: ${broken.map((r) => r.name).join(" ")}`)

process.exit(broken.length > 0 ? 1 : 0)
