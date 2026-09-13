#!/usr/bin/env node
/// Who narrows the list — the server, or the browser?
///
/// This app already runs the whole TanStack stack: Router, Query, Table v9,
/// Virtual, Form. So "are we on TanStack" is the wrong question; the answer is
/// yes and has been for months. The question that decides whether a screen
/// tells the truth is narrower:
///
///   **When somebody types in a search box or clicks a column heading, does the
///   answer come from the server, or from whatever rows the browser happened to
///   download?**
///
/// TanStack Table will happily do either. `globalFilter` and a client `sorting`
/// state are legitimate features — over a complete list. Over a page, or over a
/// `limit=1000` slice of a longer list, they produce a screen that searches a
/// thousand rows out of twelve hundred and reports the result as the answer.
/// Nothing errors. The numbers are simply wrong, quietly, and only for the
/// records that fell outside the slice.
///
/// So the rules below look for exactly that pair — a client-side narrowing, and
/// a request that capped what there was to narrow — and for the four other ways
/// a screen can step outside the one path everything else takes.
///
/// Each finding is a repair, not a rewrite: the fix is to put `q`, `sort`,
/// `dir` and `cursor` on the wire and set `manualSorting`, which is what
/// `lib/queries/people.ts` already does for the workforce.
///
///   node scripts/stack-lint.mjs            # findings, grouped
///   node scripts/stack-lint.mjs --summary  # just the counts
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = join(process.cwd(), "src")

/// The files allowed to hold the one implementation everybody else goes
/// through. Short on purpose: adding to it is the decision, not the edit.
const HOME = {
  fetch: ["src/lib/api.ts", "src/lib/edge-session.tsx"],
  rowModels: ["src/lib/table.ts"],
  routing: ["src/routes.tsx", "src/lib/navigate.ts", "src/lib/navigation.ts"],
}

/// Per-line rules. `whole` rules look at the file instead, because the defect
/// is a RELATIONSHIP between two lines that may be far apart.
const RULES = [
  {
    id: "client-search",
    test: /globalFilter|onGlobalFilterChange/,
    say: "searches in the browser — over the rows already downloaded, not over the list. Put `q` on the wire.",
    allow: (f) => HOME.rowModels.includes(f),
  },
  {
    id: "row-model",
    test: /create(Filtered|Sorted|Faceted|Paginated)RowModel|rowPaginationFeature/,
    say: "registers a client row model — it re-orders the page and presents it as the list",
    allow: (f) => HOME.rowModels.includes(f),
  },
  {
    id: "fetch",
    test: /(?<![.\w])fetch\s*\(/,
    say: "calls fetch() directly — go through lib/api.ts, which carries the credentials, the error envelope and the abort signal",
    allow: (f) => HOME.fetch.includes(f),
  },
  {
    id: "anchor",
    test: /<a\s[^>]*href=["']\/(?!\/)/,
    say: "links with <a href> to an in-app path — the whole bundle reloads instead of routing",
    allow: () => false,
  },
  {
    id: "hand-routing",
    test: /history\.(push|replace)State/,
    say: "drives history by hand instead of navigating",
    allow: (f) => HOME.routing.includes(f),
  },
  {
    id: "second-library",
    test: /from\s+["'](axios|swr|react-query)["']/,
    say: "imports a second data library — this app has TanStack Query",
    allow: () => false,
  },
]

/// The one that matters most, and it cannot be seen on a single line: a screen
/// that sorts in the browser AND asked for a capped number of rows. Either
/// alone can be fine. Together they are a sorted answer about an arbitrary
/// slice — "who expires first" over the first thousand employees.
function cappedAndClientSorted(source) {
  const sorts = /\bsorting\b/.test(source) && !/manualSorting/.test(source)
  const cap =
    /limit:\s*(\d{3,})|limit=(\d{3,})/.exec(source) ?? namedCap(source)
  if (!sorts || !cap) return null
  return Number(cap[1] ?? cap[2])
}

/// The same cap, written as a constant.
///
/// A screen that draws `<Truncated>` names its ceiling once — `const CAP` — so
/// the banner and the request cannot say different numbers. That is the right
/// shape and it used to make the screen INVISIBLE here, because the literal
/// left the call site: doing the honest thing switched the detector off, which
/// is the worst incentive a lint can carry. So the constant is followed.
///
/// Only a module-level `const` with a plain number, and only where the call
/// site named it: an identifier this cannot resolve is left alone rather than
/// guessed at.
function namedCap(source) {
  const named = /limit:\s*([A-Z][A-Z0-9_]*)\b/.exec(source)
  if (named === null) return null
  const bound = new RegExp(`^const ${named[1]} = ([\\d_]+)$`, "m").exec(source)
  if (bound === null) return null
  const value = Number(bound[1].replaceAll("_", ""))
  return Number.isFinite(value) && value >= 100 ? [null, String(value)] : null
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const findings = []

for (const full of walk(ROOT)) {
  const file = relative(process.cwd(), full)
  const source = readFileSync(full, "utf8")

  const cap = cappedAndClientSorted(source)
  if (cap !== null) {
    findings.push({
      file,
      line: 0,
      id: "capped-and-sorted",
      say: `sorts in the browser over a list it capped at ${cap} rows — the order is about the slice, not the list`,
      text: "",
    })
  }

  source.split("\n").forEach((line, i) => {
    // A line that is only a comment describes a rule rather than breaking it.
    const code = line.replace(/^\s*(\/\/|\/\/\/|\*).*$/, "")
    for (const rule of RULES) {
      if (rule.allow(file) || !rule.test.test(code)) continue
      if (/stack-lint-ok:\s*\S/.test(line)) continue
      findings.push({
        file,
        line: i + 1,
        id: rule.id,
        say: rule.say,
        text: code.trim().slice(0, 86),
      })
    }
  })
}

const byRule = new Map()
for (const f of findings) byRule.set(f.id, [...(byRule.get(f.id) ?? []), f])

const summary = process.argv.includes("--summary")
if (!summary) {
  for (const [id, list] of [...byRule].sort(
    (a, b) => b[1].length - a[1].length
  )) {
    console.log(`\n── ${id} — ${list.length} ──`)
    console.log(`   ${list[0].say}\n`)
    for (const f of list.slice(0, 12)) {
      console.log(`   ${f.file}${f.line ? `:${f.line}` : ""}`)
      if (f.text) console.log(`       ${f.text}`)
    }
    if (list.length > 12) console.log(`   … and ${list.length - 12} more`)
  }
}

console.log(
  `\nstack-lint: ${findings.length} finding(s) across ${byRule.size} rule(s)`
)
for (const [id, list] of [...byRule].sort(
  (a, b) => b[1].length - a[1].length
)) {
  console.log(`  ${String(list.length).padStart(4)}  ${id}`)
}
process.exit(findings.length > 0 ? 1 : 0)
