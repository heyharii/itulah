#!/usr/bin/env node
/// The stack rules, enforced instead of remembered.
///
/// This app is built on TanStack Router, Query, Table and Virtual, and the
/// value of that is not the packages — it is that **there is one way to do each
/// thing**. One place a URL is declared, one place a request is made, one
/// answer to who narrows a list. The moment a second way appears the first one
/// stops being true, and the file that broke it looks perfectly reasonable on
/// its own.
///
/// Every rule below is a way that has actually been reached for by somebody
/// writing a screen in a hurry, and every one of them produces a defect that
/// `tsc` and `eslint` both call correct:
///
///   - a `fetch` outside `lib/api.ts` misses the auth headers, the error
///     envelope and the abort signal, and nothing fails until a slow screen is
///     left early;
///   - an `<a href>` inside the app reloads the whole bundle instead of
///     routing, and the only symptom is that it feels slow;
///   - a client-side row model re-sorts the PAGE and presents it as the list,
///     which is the defect `lib/table.ts` exists to prevent and the one a
///     reader cannot see;
///   - `useState` holding a filter means a link to what you are looking at
///     sends the recipient an unfiltered screen.
///
/// It is a grep, not a compiler, so it is deliberately narrow: it only reports
/// what it can be sure about, and every rule can be suppressed on one line with
/// `// stack-lint-ok: <reason>` — a suppression with no reason is itself a
/// finding, because "I meant to" is not one.
///
///   node scripts/stack-lint.mjs
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = join(process.cwd(), "src")

/// Files allowed to hold the one implementation of a thing everybody else must
/// go through. This list should stay short; adding to it is the decision, not
/// the edit that follows.
const HOME = {
  fetch: ["src/lib/api.ts"],
  rowModels: ["src/lib/table.ts"],
  routing: ["src/router.tsx", "src/lib/nav.ts"],
}

const RULES = [
  {
    id: "fetch",
    test: /(?<![.\w])fetch\s*\(/,
    say: "calls fetch() directly — go through `api` in lib/api.ts, which carries the credentials, the error envelope and the abort signal",
    allow: (file) => HOME.fetch.includes(file),
  },
  {
    id: "anchor",
    test: /<a\s[^>]*href=["']\/(?!\/)/,
    say: "links with <a href> to an in-app path — use <Link> or kit/app-link, or the whole bundle reloads",
    allow: () => false,
  },
  {
    id: "row-model",
    test: /create(Filtered|Sorted|Faceted|Paginated)RowModel|rowPaginationFeature/,
    say: "registers a client row model — narrowing is the server's job, see the reasoning in lib/table.ts",
    allow: (file) => HOME.rowModels.includes(file),
  },
  {
    id: "hand-routing",
    test: /createRoute\(|createRootRoute\(|history\.(push|replace)State/,
    say: "declares a route or drives history by hand — routes are generated from lib/nav.ts",
    allow: (file) => HOME.routing.includes(file),
  },
  {
    id: "screen-state",
    test: /\buseState\b/,
    say: "holds state in the component — a filter, tab or sort belongs in the URL via useQueryState so it can be linked to and reloaded",
    // Only screens. `kit/` and `lib/` legitimately hold transient UI state (a
    // measured width, a debounce), and saying otherwise would train people to
    // suppress the rule rather than read it.
    only: (file) => file.startsWith("src/modules/"),
    allow: () => false,
  },
  {
    id: "axios",
    test: /from\s+["'](axios|swr|react-query)["']/,
    say: "imports a second data library — this app has TanStack Query",
    allow: () => false,
  },
]

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const findings = []
const suppressed = []

for (const full of walk(ROOT)) {
  const file = relative(process.cwd(), full)
  const lines = readFileSync(full, "utf8").split("\n")
  lines.forEach((line, i) => {
    // A line that is only a comment is a line describing the rule, not breaking
    // it — this file's own prose would otherwise trip half of these.
    const code = line.replace(/^\s*(\/\/|\/\/\/|\*).*$/, "")
    for (const rule of RULES) {
      if (rule.only && !rule.only(file)) continue
      if (rule.allow(file)) continue
      if (!rule.test.test(code)) continue
      const ok = /stack-lint-ok:\s*\S/.test(line)
      const claimed = /stack-lint-ok/.test(line)
      if (ok)
        suppressed.push({
          file,
          line: i + 1,
          id: rule.id,
          why: line.split("stack-lint-ok:")[1].trim(),
        })
      else
        findings.push({
          file,
          line: i + 1,
          id: rule.id,
          say: claimed ? "suppressed with no reason given" : rule.say,
          text: code.trim().slice(0, 90),
        })
    }
  })
}

for (const f of findings) {
  console.log(`${f.file}:${f.line}  [${f.id}] ${f.say}\n    ${f.text}`)
}

if (suppressed.length > 0) {
  console.log(`\n${suppressed.length} deliberate exception(s):`)
  for (const s of suppressed)
    console.log(`  ${s.file}:${s.line} [${s.id}] ${s.why}`)
}

console.log(
  findings.length === 0
    ? `\nstack-lint: clean.`
    : `\nstack-lint: ${findings.length} finding(s).`,
)
process.exit(findings.length > 0 ? 1 : 0)
