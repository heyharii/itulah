#!/usr/bin/env node
/// Type in every search box and watch the network.
///
/// ## The question a grep cannot answer
///
/// `stack-lint` can tell you a file mentions `globalFilter`. It cannot tell you
/// what the box on the screen actually does, because a screen can hold both a
/// server parameter and a client filter, and which one runs depends on wiring
/// no regular expression can follow.
///
/// So this asks the screen instead. For each one it opens the page, waits for
/// it to settle, clears the network log, types into the search box, and waits
/// again. Then exactly one thing decides the verdict:
///
///   **server** — typing produced a request. The server answered the question,
///   so the result is about the whole list.
///
///   **browser** — typing produced nothing. The rows were narrowed in the page,
///   which means the answer is about whatever had been downloaded. On a short
///   list that is indistinguishable from correct. On a long one it silently
///   omits everything past the cap, and no one can see that it did.
///
/// A `browser` verdict is not automatically a defect — a list the endpoint
/// returns whole can honestly be searched in the page. It becomes a defect the
/// moment the request carried a `limit`, which is why the row also prints the
/// largest limit the screen asked for. `browser` with a limit is the pairing to
/// fix; `stack-lint`'s `capped-and-sorted` rule finds the same thing statically.
///
///   node scripts/search-test.mjs                 # every screen known to have a box
///   node scripts/search-test.mjs /people /files  # just these
import { execFileSync } from "node:child_process"

const APP = process.env.APP ?? "http://localhost:5273"
const SESSION = "search-test"
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 4500)
const AFTER_MS = Number(process.env.AFTER_MS ?? 3000)

/// Screens `stack-lint` flagged, plus the ones whose lists are longest. A box
/// that is not found is reported as such rather than skipped silently — "no
/// search box here" and "the test could not find it" are different findings.
const SCREENS = [
  "/people",
  "/commercial",
  "/finance/accounts",
  "/finance/bills",
  "/finance/payments",
  "/finance/journal",
  "/inventory/availability",
  "/inventory/pools",
  "/procurement/purchase-orders",
  "/procurement/catalogue",
  "/files",
  "/members",
]

function ab(args, { json = true } = {}) {
  const full = ["--session", SESSION, ...args]
  try {
    const out = execFileSync(
      "agent-browser",
      json ? [...full, "--json"] : full,
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    )
    return json ? JSON.parse(out) : out
  } catch {
    return null
  }
}

const sleep = (ms) => execFileSync("sleep", [String(ms / 1000)])

function apiCalls() {
  const d = ab(["network", "requests", "--filter", "/api/v1"])
  const rs = (d?.data?.requests ?? []).filter((r) => r.resourceType === "Fetch")
  return [...new Set(rs.map((r) => r.url))]
}

function findBox() {
  const tree = ab(["snapshot", "-i"], { json: false }) ?? ""
  // The first textbox on the page. Screens here put the search first; a screen
  // that does not would need naming, and naming it is better than guessing.
  const m = /textbox "([^"]*)" \[ref=(e\d+)\]/.exec(tree)
  return m ? { label: m[1], ref: `@${m[2]}` } : null
}

function check(path) {
  ab(["open", `${APP}${path}`])
  sleep(SETTLE_MS)

  const box = findBox()
  if (!box) return { path, verdict: "no box", limit: null, label: "" }

  const before = apiCalls()
  let biggest = 0
  for (const url of before) {
    const m = /[?&]limit=(\d+)/.exec(url)
    if (m) biggest = Math.max(biggest, Number(m[1]))
  }

  ab(["network", "requests", "--clear"])
  ab(["fill", box.ref, "nina"])
  sleep(AFTER_MS)

  const after = apiCalls()
  return {
    path,
    verdict: after.length > 0 ? "server" : "browser",
    limit: biggest || null,
    label: box.label,
    triggered: after.length,
  }
}

const only = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const list = only.length > 0 ? only : SCREENS

console.log(`search: ${list.length} screens against ${APP}\n`)
console.log(`  verdict   asked   screen`)

const results = []
for (const path of list) {
  const r = check(path)
  results.push(r)
  const mark =
    r.verdict === "server" ? "✓ server" : r.verdict === "browser" ? "✗ browser" : "· no box"
  console.log(
    `  ${mark.padEnd(9)} ${String(r.limit ?? "—").padStart(5)}   ${r.path}` +
      (r.label ? `   “${r.label}”` : ""),
  )
}

const unsafe = results.filter((r) => r.verdict === "browser" && r.limit !== null)
const local = results.filter((r) => r.verdict === "browser" && r.limit === null)
console.log(
  `\n  ${results.filter((r) => r.verdict === "server").length} search the server` +
    `\n  ${unsafe.length} search the browser OVER A CAPPED LIST — these are the defects` +
    `\n  ${local.length} search the browser over an uncapped list — honest today, fragile`,
)
if (unsafe.length) console.log(`\n  fix first: ${unsafe.map((r) => r.path).join(" ")}`)

ab(["close"])
process.exit(unsafe.length > 0 ? 1 : 0)
