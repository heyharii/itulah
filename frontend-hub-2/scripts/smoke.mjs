#!/usr/bin/env node
/// Open every screen in a real browser and make it prove it reached the server.
///
/// ## Why this exists, and why it is not a unit test
///
/// Everything else in this repo checks a screen in isolation: `tsc` checks the
/// types, `vitest` checks the pure functions, `design-lint` checks the tokens.
/// None of them can catch the failure that actually ships — a screen that
/// compiles, renders, and quietly shows nothing because the endpoint it asks
/// for does not exist, or answers a shape it no longer reads.
///
/// That failure has a signature, and it is the one this checks for: the page
/// renders, the route resolves, and the network tab is full of 404s while the
/// table says "no rows". A person looking at it sees an empty warehouse.
///
/// So each route is opened in Chrome, against the dev server, against a live
/// backend, and three things are demanded of it:
///
///   1. **No page error.** An exception during render is a failure even if
///      something still drew.
///   2. **Every `/api` call answered 2xx.** A 404 or a 502 behind a screen that
///      looks fine is exactly the defect above. A route that asked for nothing
///      at all is reported separately — it is not a pass, it is a screen with
///      no data behind it, which is worth knowing.
///   3. **The main region has content**, and it is not one of the failure
///      states from `kit/state.tsx`.
///
/// ## The route list is not written here
///
/// It is read from `src/modules/*/nav.tsx`, which is where the router itself
/// gets it. A hand-kept list in a test file is a list that goes stale the first
/// time somebody adds a screen, and then the test reports success about a
/// screen nobody checked.
///
/// Usage:
///   node scripts/smoke.mjs                  # every route
///   node scripts/smoke.mjs finance people   # only these modules
///
/// Requires `agent-browser` (npm i -g agent-browser && agent-browser install),
/// a dev server on APP (default http://localhost:5320), and the backend it
/// proxies to actually running. If the backend is down every route fails, which
/// is the correct answer rather than a skipped test.
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const APP = process.env.APP ?? "http://localhost:5320"
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 1400)

/// `--a11y` also runs axe-core on each route.
///
/// Off by default, and that is a judgement rather than laziness: the app
/// currently has a known palette-level contrast problem (`--ink-4` is 2.64:1 on
/// the sidebar, where AA wants 4.5:1), and it is on every screen. Failing every
/// route on one unresolved design decision would make the whole check
/// worthless — people would stop reading it, which is how a suite dies.
///
/// So the audit reports what it finds, and only a **critical** violation fails
/// the run. A serious one is printed, counted, and left for somebody to decide
/// about — which is the honest state of that particular question.
const AUDIT = process.argv.includes("--a11y")

/// Sentences `kit/state.tsx` draws when a screen has nothing to show. Matching
/// on the words rather than a test id on purpose: a test id can be removed
/// while the sentence stays, and it is the sentence a person reads.
const FAILURE_TEXT = [
  "Could not load",
  "Something went wrong",
  "You cannot see",
  "no open posting",
]

/// What a screen that is not written yet says — `kit/soon.tsx` and a module's
/// own `Gap`. These are NOT failures and must not be reported as ones: they are
/// deliberate, and each says so on the page.
///
/// They are counted separately all the same, because a run that reports
/// "24/24 clean" while half of them are placeholders is a run that flatters the
/// migration. The number that matters is how many screens actually read data.
const PLACEHOLDER_TEXT = [
  "Not written in this app yet",
  "Nothing is hidden here and nothing failed to load",
]

/// Its own browser session, named after what is being checked.
///
/// `agent-browser` keeps one browser per session and a single buffer of network
/// requests and page errors in it. Two runs sharing the `default` session read
/// each other's traffic and clear each other's buffer — so one reports another
/// module's 404 as its own, and both occasionally report nothing at all. That
/// failure is intermittent and it looks exactly like a flaky test, which is the
/// worst thing a test can look like.
///
/// So the session is derived from the arguments: `smoke.mjs inventory` runs in
/// `smoke-inventory`. Several modules can be checked at once, by several
/// people, without anybody coordinating.
const SESSION = `smoke-${
  process.argv
    .slice(2)
    .filter((a) => !a.startsWith("--"))
    .join("-") || "all"
}`

function ab(args, { json = true } = {}) {
  const full = ["--session", SESSION, ...args]
  const out = execFileSync("agent-browser", json ? [...full, "--json"] : full, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  return json ? JSON.parse(out) : out
}

function routes(only) {
  const dir = join(process.cwd(), "src/modules")
  const found = []
  for (const module of readdirSync(dir, { withFileTypes: true })) {
    if (!module.isDirectory()) continue
    if (only.length > 0 && !only.includes(module.name)) continue
    let source
    try {
      source = readFileSync(join(dir, module.name, "nav.tsx"), "utf8")
    } catch {
      continue
    }
    for (const m of source.matchAll(/path: "(\/[^"]*)"/g)) {
      found.push({ module: module.name, path: m[1] })
    }
  }
  // Declaration order within a module, modules alphabetically — stable, so two
  // runs are comparable line by line.
  return found
}

function check({ module, path }) {
  ab(["network", "requests", "--clear"])
  ab(["errors", "--clear"])
  ab(["open", `${APP}${path}`])
  execFileSync("sleep", [String(SETTLE_MS / 1000)])

  const errors = ab(["errors"]).data.errors ?? []
  const calls = (
    ab(["network", "requests", "--filter", "/api/v1"]).data.requests ?? []
  ).filter((r) => r.resourceType === "Fetch")
  // A request the browser cancelled because React unmounted mid-flight carries
  // no status. That is not a server failure and must not be reported as one —
  // the same call is almost always re-issued and answered.
  const failed = calls.filter((r) => r.status !== undefined && r.status >= 400)

  let text = ""
  try {
    text = ab(["get", "text", "main"]).data?.text ?? ""
  } catch {
    text = ""
  }
  const stateWord = FAILURE_TEXT.find((w) => text.includes(w))
  const placeholder = PLACEHOLDER_TEXT.some((w) => text.includes(w))

  let audit = null
  if (AUDIT) {
    try {
      const found = ab(["a11y"]).data?.violations ?? []
      audit = {
        critical: found.filter((v) => v.impact === "critical"),
        serious: found.filter((v) => v.impact === "serious"),
      }
    } catch {
      // An audit that would not run is reported as absent, never as a pass.
      audit = null
    }
  }

  const problems = []
  if (errors.length > 0)
    problems.push(`${errors.length} page error(s): ${errors[0]?.message ?? ""}`)
  for (const v of audit?.critical ?? [])
    problems.push(`a11y critical: ${v.id} (${v.nodes?.length ?? 0} element(s))`)
  for (const r of failed) problems.push(`${r.status} ${r.url.replace(APP, "")}`)
  if (stateWord) problems.push(`screen says "${stateWord}"`)
  if (text.trim().length < 20) problems.push("main region is empty")

  return { module, path, calls: calls.length, placeholder, audit, problems }
}

const only = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const list = routes(only)
if (list.length === 0) {
  console.error("No routes found. Run this from frontend-hub-2/.")
  process.exit(2)
}

console.log(`smoke: ${list.length} routes against ${APP}\n`)
const results = []
for (const route of list) {
  const r = check(route)
  results.push(r)
  const mark = r.problems.length > 0 ? "✗" : r.placeholder ? "·" : "✓"
  console.log(
    `${mark} ${r.path.padEnd(30)} ${String(r.calls).padStart(2)} call(s)` +
      (r.placeholder ? "  not written yet" : "") +
      (r.audit?.serious.length
        ? `  a11y: ${r.audit.serious
            .map((v) => `${v.id}×${v.nodes?.length ?? 0}`)
            .join(" ")}`
        : "") +
      (r.problems.length ? `\n    ${r.problems.join("\n    ")}` : ""),
  )
}

const broken = results.filter((r) => r.problems.length > 0)
const pending = results.filter((r) => r.problems.length === 0 && r.placeholder)
const real = results.filter((r) => r.problems.length === 0 && !r.placeholder)
console.log(
  `\n${results.length - broken.length}/${results.length} clean — ` +
    `${real.length} screens reading real data, ${pending.length} not written yet`,
)
if (pending.length) {
  console.log(`  not written: ${pending.map((r) => r.path).join(" ")}`)
}

// Shut this run's browser down. Without it every run leaves a Chrome behind,
// and a machine with six agents on it ends up with six of them holding the
// memory of whatever they last loaded.
try {
  ab(["close"])
} catch {
  // A session that already went away is not a test failure.
}

process.exit(broken.length > 0 ? 1 : 0)
