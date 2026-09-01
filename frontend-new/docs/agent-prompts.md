# Agent prompts

Ready-to-paste prompts for executing `docs/frontend-architecture.md`.
Date: 2026-08-27

---

## Why these prompts look the way they do

The last parallel agent run on this codebase left it **unable to build**. The
contract it ran under, `docs/tanstack-migration.md`, had ownership rules and a
definition of done. It still failed, and the reason is one line in that document:

> `bunx tsc -p tsconfig.app.json --noEmit` is clean **for your files**.

Scoping verification to the agent's own files is the whole bug. An agent can have
clean files while the project does not compile — a JSX parse error in
`system.tsx` never appears in the errors for `inventory.tsx`, and nobody ran the
build. Two apps shipped broken.

So every prompt below carries the same three hard constraints:

1. **The gate is whole-project.** All three commands, no path filters.
2. **Ownership is an allow-list**, not a suggestion.
3. **A pre-existing failure is reported, not fixed.** An agent that starts
   patching another agent's files is how a merge conflict becomes a broken merge.

Run order matters. **Phase 0 is not parallelisable and nothing else starts until
it is green.** Where a phase fans out, the reference implementation lands first
and the fan-out agents copy it.

Package manager is **bun** (`bun.lock`, no `packageManager` field). Use `bunx`.

---

## The preamble — prepend to every prompt

```text
You are working in /Users/hari/Documents/slowdown/vite-app.

READ FIRST, in this order:
  1. docs/frontend-architecture.md   — the layer contract
  2. docs/frontend-rules.md          — the query/cache/prefetch/state/form/table rules
Both are authoritative. Where this prompt and those documents disagree, ask
rather than guessing.

PACKAGE MANAGER: bun. Use `bunx`, never `npx`.

THE GATE — you are not done until all three pass, project-wide, no path filters:
    bunx tsc -p tsconfig.app.json --noEmit
    bunx eslint .
    bunx vite build

  - Run all three yourself. Do not report success on a subset.
  - "Clean for my files" is not the gate. The last agent run on this repo
    failed exactly there and left the app unbuildable.
  - If the gate is ALREADY failing when you start, and the failure is outside
    your ownership list: STOP, report what is failing, and do not touch it.

OWNERSHIP: you may edit only the paths listed under "You own" below. Everything
else is read-only to you, including src/routeTree.gen.ts, which is generated.

DEPRECATED APIs — do not write these into new code. Verified against the
installed @tanstack/query-core@5.102.7 type declarations:
  queryClient.ensureQueryData(o)  →  queryClient.query({ ...o, staleTime: "static" })
  queryClient.prefetchQuery(o)    →  void queryClient.query(o).catch(noop)
  queryClient.fetchQuery(o)       →  queryClient.query(o)
  useReactTable(...)              →  useTable(...) with explicit tableFeatures

REPORT when finished, in this shape:
  - What you changed, by file.
  - The three gate commands and their actual output (paste the tail).
  - Anything you found that is broken but outside your ownership.
  - Anything in the two documents that turned out to be wrong.

Do not commit. Do not push. Leave the working tree for review.
```

---

## Phase 0 — Make it build

**One agent. Sequential. Nothing else runs until this is green.**

```text
[PREAMBLE]

GOAL: the project builds and typechecks. It currently does neither.

You own: src/components/system/system.tsx, src/components/accounting/accounting.tsx,
src/components/inventory/inventory.tsx, src/components/inventory/operations.tsx,
src/components/customers/customers.tsx, src/components/commercial/*.tsx,
src/components/dashboard/dashboard.tsx, src/components/dashboard/nav-sidebar.tsx,
src/components/system/api.ts, src/components/po/po-draft.tsx,
plus deletion of the dead files listed in task 5, plus CLAUDE.md and the CI workflow.

TASKS

1. src/components/system/system.tsx is a PARSE error and blocks the build.
   Around line 161 a <Link> is opened and closed with </button>. Two orphaned
   setModule(...) calls remain below it from the same half-finished conversion.
   Finish the conversion: those controls become <Link ... search={...}> per
   rules S5, and the setModule calls go away with them.
   Verify with `bunx vite build` — this error hides everything after it.

2. src/components/accounting/accounting.tsx — 15 errors. Reads were moved to
   search params but writes never were, so setTab / setPeriodId / setAccountId /
   setOpenAccount no longer exist. Convert each writer to Route.useNavigate()
   per rules S3 and S4: filter and tab changes use replace: true, opening a
   record pushes.

3. 14 × TS2322 across inventory.tsx, customers.tsx, commercial/*.tsx and
   dashboard/*.tsx. Cause: a router-global useNavigate() types `prev` as the
   union of all 18 routes' search params. Fix is Route.useNavigate() — rule S4.
   Fix the cause, not the symptom; do not cast or widen a search schema.

4. Clear the remaining 3: an unused local in system/api.ts, a `po_date` field
   that is not in PurchaseOrderWriteInput (po-draft.tsx), and an
   `Error | ApiError | undefined` being rendered as ReactNode
   (inventory/operations.tsx). For the last one render errorMessage, not error.

5. Delete the dead island — verify with a grep for importers first, then remove:
     src/components/dashboard.tsx        (root-level, not the folder)
     src/components/app-sidebar.tsx
     src/components/site-header.tsx
     src/components/nav-main.tsx
     src/components/nav-user.tsx
     src/components/nav-documents.tsx
     src/components/nav-secondary.tsx
     src/components/interaction-sounds.tsx
     src/components/chat/            (the folder; chat-app/ is the live one)
   If any of these turns out to have a live importer, keep it and say so.

6. Create CLAUDE.md at the repo root containing the non-negotiables, so future
   agents get them without being told to read a doc:
     - the three gate commands, whole-project
     - bunx not npx
     - never edit src/routeTree.gen.ts
     - the deprecated-API table from the preamble
     - Route.useNavigate(), never global useNavigate()
     - a pointer to docs/frontend-architecture.md and docs/frontend-rules.md
   Keep it under 60 lines. It is loaded into every session; length is a cost.

7. Add a CI workflow running the three gate commands on every push.

CONSTRAINTS
  - Do not refactor. Do not adopt any library. Do not rename anything.
  - Do not "improve" a file you are only in to fix a type error.
  - If a fix requires a decision about product behaviour, ask.

GATE: all three commands green, and `git status` shows only files from your
ownership list.
```

---

## Phase 1 — Measure, then take the free wins

**One agent. Requires Phase 0 green.**

```text
[PREAMBLE]

GOAL: a recorded performance baseline, and the three cheap wins that need no
architecture. Read docs/frontend-architecture.md §7 before starting.

You own: vite.config.ts, index.html, src/index.css, package.json,
docs/perf-baseline.md (new).

TASKS

1. BASELINE FIRST — before changing anything.
   Run `bunx vite build`, then add rollup-plugin-visualizer (dev dep) and build
   again. Record in docs/perf-baseline.md:
     - every emitted chunk and its raw + gzip size
     - whether autoCodeSplitting is actually producing per-route chunks
     - total CSS, total fonts
     - the five largest modules
   This is the number every later phase is measured against. Do not skip it and
   do not estimate.

   Context you need: the 1.28 MB single chunk currently in dist/ is STALE
   evidence — the committed vite.config.ts has no tanstackRouter plugin at all;
   it was added uncommitted afterwards. Splitting is unmeasured, not broken.
   Report what you actually find.

2. FONTS — src/index.css imports the full @fontsource-variable packages, which
   ship Cyrillic, Greek and Vietnamese subsets. 117 KB of the 303 KB payload is
   unused. Switch to the latin/latin-ext subset entrypoints, then <link rel=
   "preload"> the two faces the shell actually paints with.
   Re-measure and record the delta.

3. index.html — the viewport meta lacks `viewport-fit=cover`, so
   env(safe-area-inset-*) resolves to 0 on iOS and the one place that uses it
   (motion/animated-sidebar.tsx:759) is dead. Add it.

4. REACT COMPILER — v1.0 stable. Install babel-plugin-react-compiler and
   @rolldown/plugin-babel; wire it in vite.config.ts:

     import react, { reactCompilerPreset } from "@vitejs/plugin-react"
     import babel from "@rolldown/plugin-babel"
     plugins: [
       react(),
       babel({ presets: [reactCompilerPreset()] }),   // MUST run first in Babel
       tanstackRouter({ target: "react", autoCodeSplitting: true }),
       tailwindcss(),
     ]

   Requires @vitejs/plugin-react v6+ — check the installed version first.
   Then enable the compiler rules in eslint-plugin-react-hooks (already a
   devDependency at v7) and run `bunx eslint .`. For every component it reports
   as un-compilable: either fix the Rules-of-React violation, or add
   "use no memo" with a one-line comment saying why. List every opt-out in your
   report — that list is a debt register, not a solution.

5. Re-measure and append an after-column to docs/perf-baseline.md.

CONSTRAINTS
  - Do NOT tune chunk configuration in this phase. Measure only.
    Note for later: Vite 8 is Rolldown-based, manualChunks is deprecated in
    favour of advancedChunks, and Rolldown splits more aggressively than Rollup —
    so the likely finding is too MANY small chunks, not too few. Record it;
    don't act on it yet.
  - Do not touch any file under src/components or src/routes.

GATE: three commands green, plus docs/perf-baseline.md with real numbers.
```

---

## Phase 2A — Cache layer, reference implementation

**One agent. Inventory only. This is the template the fan-out copies.**

```text
[PREAMBLE]

GOAL: convert ONE domain end-to-end to the query/loader pattern, and write the
recipe the other 17 will follow. Read docs/frontend-rules.md Parts 1–4 in full.

You own: src/routes/inventory.tsx, src/components/inventory/**,
src/lib/api/stale.ts (new), src/routes/__root.tsx (error/notFound only),
docs/recipe-domain-conversion.md (new).

TASKS

1. src/lib/api/stale.ts — the named stale classes from rules C1. Export a
   frozen STALE object with reference / catalogue / operational / ledger /
   session / document, each carrying staleTime, gcTime and
   refetchOnWindowFocus. Nothing else in the codebase sets staleTime by hand
   after this lands.

2. src/components/inventory/queries/ — queryOptions factories replacing the
   useApiQuery calls in api.ts. Rules Q1–Q4: keys hierarchical and
   prefix-invalidatable, every fetcher input in the key, flat scalars only.
   Pick a STALE class per query — the ledger and movements are STALE.ledger,
   balances are STALE.operational, locations are STALE.reference.

   Note rule C2: the inventory snapshot reports its own projection readiness.
   Use the staleTime-as-function form there — it is the exact case it exists for.

3. src/routes/inventory.tsx — add loaderDeps and loader per rules P1–P4.
   The snapshot is critical: await it, with staleTime: "static".
   Movements are secondary: void … .catch(noop).
   Add pendingComponent rendering the screen's own skeleton (not a spinner) and
   errorComponent reading ApiError.kind / .status / .retryable per rule C6.

4. The screen switches to useSuspenseQuery. Delete the mount-time fetching.
   Apply rule Q7 while you are here: keepPreviousData belongs on the filtered
   ledger list, NOT on any detail view.

5. src/components/inventory/mutations/ — the adjustment and cycle-count writes,
   per rules M1–M7. Note M4: inventory adjustments are stock-bearing, so they
   are NOT optimistic — pending state, then wait for the server.

6. src/routes/__root.tsx — root errorComponent and notFoundComponent. This is
   the only shared file you may touch, and only for those two.

7. docs/recipe-domain-conversion.md — the recipe, written from what you just
   did. Concrete, with real code from inventory. It must be followable by an
   agent that has never seen this repo. Include what was harder than expected.

CONSTRAINTS
  - Do NOT delete src/lib/api/query.ts or useApiQuery — 17 apps still use it.
    Add an @deprecated JSDoc tag pointing at the new pattern.
  - Do not touch another domain.
  - Do not restructure folders. That is Phase 3.

GATE: three commands green. Plus, verified by hand in the browser: navigating
to /inventory paints structure immediately, changing the location filter
re-runs the loader, and a forced fetch failure shows the route errorComponent
with the rail and the other apps still usable.
```

---

## Phase 2B — Cache layer, fan-out

**One agent per domain. Only after 2A is green and the recipe exists.**
**Cap at 4 concurrent.** Each gets the preamble plus:

```text
[PREAMBLE]

GOAL: convert the <DOMAIN> app to the pattern already proven in inventory.

READ FIRST, in addition to the two architecture documents:
  docs/recipe-domain-conversion.md   — follow it; do not invent a variant
  src/components/inventory/queries/  — the reference implementation
  src/lib/api/stale.ts               — pick a class, never a number

You own: src/routes/<DOMAIN>.tsx and src/components/<DOMAIN>/** ONLY.

Domains, one agent each:
  commercial · articles · sourcing · po (+ shortlist) · finance · accounting
  customers · hr-ho · hr-store · system · forum · files · chat · suppliers

TASKS: follow the recipe. queries/ factories, loader + loaderDeps,
pendingComponent + errorComponent, useSuspenseQuery, mutations/ owning their
own invalidation.

CONSTRAINTS
  - You may not edit src/lib/**, src/routes/__root.tsx, src/components/ui/**,
    or any other domain. If you need a change there, STOP and report it.
  - If the recipe does not cover your case, report the gap. Do not improvise a
    second pattern — a second pattern is how this codebase got into its
    current state.
  - Run the FULL gate. Another agent's in-flight work is not your problem to
    fix, but it is your problem to report: if the gate fails outside your
    files, say so and stop.

GATE: three commands green, and `git status` shows only your two paths.
```

---

## Phase 3 — Structure and enforcement

**One agent. Not parallelisable — it is a tree-wide move.**

```text
[PREAMBLE]

GOAL: the folder structure in docs/frontend-architecture.md §6, made
machine-enforceable.

You own: the whole tree, for moves only.

TASKS

1. `git mv`, ONE domain per commit, imports updated in the same commit:
     src/components/<domain>/  →  src/domains/<domain>/
     src/components/ui/        →  src/shared/ui/
     src/lib/api/              →  src/shared/api/
     src/lib/auth/             →  src/shared/auth/
     src/lib/{utils,day,touch,ease,...}  →  src/shared/lib/
     src/components/{app-rail,app-switcher,auth-gate,apps}  →  src/app/shell/
   Inside each domain, split into model/ api/ queries/ mutations/ forms/
   tables/ components/ per §6.
   Run the gate after EVERY commit, not at the end.

2. Move HrProvider out of src/routes/__root.tsx into the hr-ho and hr-store
   routes. It currently mounts for all eighteen apps — rule S6.

3. Install eslint-plugin-boundaries and encode §1 as ERRORS, not warnings:
     - shared/** may not import domains/** or app/**
     - domains/<a>/** may not import domains/<b>/** except via its index.ts
     - routes/** may import app/, domains/*/index.ts, shared/
     - app/** may import anything
   Then run `bunx eslint .` and fix every violation it finds. Violations are
   the point of this task — expect real ones, especially inventory ↔ hr and
   po ↔ commerce.

CONSTRAINTS
  - Moves and import updates only. No behaviour changes, no refactors.
    If you find a bug, write it down; do not fix it here.
  - Never edit src/routeTree.gen.ts — the plugin regenerates it. If the route
    tree breaks, the cause is a moved route file, not the generated one.

GATE: three commands green after every commit, and `bunx eslint .` clean with
the boundary rules on.
```

---

## Phase 4A — shared/form and shared/table

**One agent. Builds the primitives the fan-out needs.**

```text
[PREAMBLE]

GOAL: the two shared primitives, plus one converted screen each proving they work.
Read docs/frontend-rules.md Parts 6 and 7 in full.

You own: src/shared/form/**, src/shared/table/**,
src/domains/commercial/forms/** (the pilot), package.json.

TASKS

1. src/shared/form/ — createFormHookContexts + createFormHook per rule F1, with
   TextField, NumberField, MoneyField, SelectField, DateField, SwitchField,
   SubmitButton and FormError bound once. Export useAppForm and withForm.
   MoneyField uses formatIDR — if shared/locale does not exist yet, define the
   one function here and note it for Phase 5.
   Validators take a Standard Schema directly (rule F3) — no adapter.

2. PILOT: convert ONE sheet out of domains/commercial/forms.tsx — the file is
   3,211 lines holding eight of them. Take PriceListSheet, the smallest.
   Prove F2 (write-input schema, not read model), F4 (trigger per field type),
   F5 (form.Subscribe, never whole form state), F6 (server field errors map
   back), F7, F8, F10.
   Report the before/after line count. That number decides the budget for the
   other seven.

3. src/shared/table/DataTable — TanStack Table v9. Rule T2: explicit
   tableFeatures, and never destructure methods off rows or cells.
   CRITICAL, rule T3: rows are CSS GRID, not <table>. A native table cannot do
   dynamic-height virtual rows, and the virtualization in Phase 4B depends on
   this. Getting the markup right here is the whole point of doing it once.
   Table arrangement state (sort, filter, page) reads from and writes to the
   URL; row-model state (sizing, visibility, selection) stays in the table —
   rule T1.

4. Install @tanstack/react-virtual and add a virtualized body variant, with a
   fixed estimateSize (rule T4). Prove it on domains/inventory/ledger.tsx, and
   DELETE the silent .slice(0, 200) there — rule T5.

CONSTRAINTS
  - Do not convert the other seven sheets. Do not convert other domains'
    tables. This phase is the primitive plus one proof of each.
  - Do not change what any converted screen does. Same fields, same
    validation rules, same submit behaviour.

GATE: three commands green, plus: the pilot sheet saves correctly against a
running backend, and the ledger renders 10k rows without the truncation.
```

---

## Phase 4B — Form and table fan-out

**One agent per domain. After 4A. Cap at 4 concurrent.**

```text
[PREAMBLE]

GOAL: convert <DOMAIN>'s forms and tables onto the shared primitives.

READ FIRST: src/shared/form/, src/shared/table/, and the pilot conversions
from Phase 4A. Follow them exactly.

You own: src/domains/<DOMAIN>/** ONLY.

TASKS
  1. Every form → useAppForm, with a write-input schema in forms/.
  2. Every table with sorting or filtering → DataTable with tableFeatures.
  3. Every list that can exceed ~500 rows → virtualized, fixed estimateSize.
  4. Any invisible truncation → removed, or made visible with a count and a
     total (rule T5, and audit.tsx is the correct pattern to copy).

CONSTRAINTS
  - A table with no sorting and no filtering stays as it is. Do not convert
    markup for its own sake.
  - Do not change field sets, validation rules or submit behaviour. This is a
    mechanism change, not a product change. If you believe a rule is wrong,
    report it; do not fix it.
  - You may not edit src/shared/**. Need a change there? STOP and report.

GATE: three commands green, `git status` shows only your domain.
```

---

## Phase 5 — Platform, authorization, realtime

**Three agents, independent, can run concurrently.**

### 5A — Floor apps

```text
[PREAMBLE]

GOAL: make the three store/DC floor screens usable on an iPad, one-handed,
with a scanner. Read docs/frontend-architecture.md §8 in full first.

You own: src/domains/inventory/components/{store-receiving,operations}.tsx,
src/domains/people/components/hr-store.tsx, src/shared/scanner/** (new),
public/manifest.webmanifest and its icons.

CONTEXT THAT DECIDES THE DESIGN
  BarcodeDetector is NOT implemented in WebKit. It does not exist in any
  browser on iPad or iPhone. Do not build around it and do not polyfill it as
  the primary path.

TASKS
  1. Touch-first layouts for the three screens: large targets, few fields per
     view, forgiving of a mis-tap. These are seconds-long standing sessions,
     not hour-long desk sessions. An 18-column grid is the wrong answer here
     even if it is the right answer in HO.
  2. src/shared/scanner/ — HID keyboard-wedge as the PRIMARY path: a focused,
     always-listening input that appends a scanned code to the working list and
     survives losing focus to a tap. This is an interaction design problem, not
     a library problem.
  3. A lazily-loaded WASM decoder (zxing-wasm or zbar-wasm) over getUserMedia
     as the camera fallback. It must NOT be in the HO bundle — verify against
     the Phase 1 baseline that it is a separate chunk.
  4. PWA manifest and icons for the floor apps. NO service-worker sync layer —
     store-router and dc-edge already own offline, and §8 explains why a third
     sync tier is the wrong move.
  5. The 23 tables carrying min-w-[760px]…[900px] are HO screens; leave them.
     Note in your report which, if any, are reachable from a floor screen.

GATE: three commands green, plus a screenshot of each screen at an iPad
portrait viewport (768×1024) with no horizontal page scroll.
```

### 5B — Authorization, realtime, locale

```text
[PREAMBLE]

GOAL: three shared modules that currently do not exist.

You own: src/shared/permissions/**, src/shared/realtime/**,
src/shared/locale/**, and route beforeLoad guards in src/routes/*.tsx.

TASKS
  1. src/shared/permissions/ — AuthUser.permissions is already fetched on login
     and read by NOTHING. Give it: requireCapability() for route beforeLoad
     (throws redirect, so an unauthorized user never loads the chunk), <Can>
     for affordances, useCan() for disabled states needing a reason.
     The UI gate is a courtesy. Go remains the enforcement point — do not write
     anything that implies otherwise.
  2. src/shared/realtime/ — one SSE connection opened in app/providers.
     Rules R1–R4. Events map to setQueryData or invalidateQueries and NOTHING
     else. Coalesce bursts (R3) — a receiving session emits hundreds of
     movement events and one invalidation each is a refetch storm.
  3. src/shared/locale/ — formatIDR, formatQty, formatDate, formatDateTime,
     formatRelative. Then replace every one of the six copy-pasted
     `Rp ${x.toLocaleString("id-ID")}` sites. They currently disagree on
     rounding and on the zero case; pick the correct behaviour, state which you
     picked and why, and make it the only one.
     Note: lib/day.ts derives "today" from the device clock and timezone.
     Do not silently change that — write down where it is load-bearing
     (attendance, receiving) and flag it for a decision.

GATE: three commands green, plus a test that a user missing a capability is
redirected away from that route rather than shown an empty screen.
```

### 5C — Documents and budgets

```text
[PREAMBLE]

GOAL: the document layer, and turn the Phase 1 baseline into CI gates.
Read docs/frontend-architecture.md §9 first — it decides the whole design.

You own: src/shared/documents/**, .github/workflows/**, vite.config.ts.

CONTEXT THAT DECIDES THE DESIGN
  The Go backbone ALREADY renders and seals PDFs: go-pdf/fpdf,
  internal/cloud/checkprint/renderer.go, and internal/cloud/docartifact, which
  seals with SHA-256, an issuance key and a doc-policy class.
  Do NOT add jsPDF, pdfmake or @react-pdf/renderer. A client-rendered invoice
  has no seal and no issuance record; two users could produce two different
  "official" documents for one record.

TASKS
  1. src/shared/documents/ — request an artifact, fetch the sealed bytes as a
     blob, preview in an <iframe>/<embed> (native PDF preview works on iOS
     Safari with no library), download with the server-supplied filename.
     Add PDF.js ONLY if in-app search or annotation is actually required — it
     is not, today.
  2. A print stylesheet for operational sheets that carry no seal: picking
     lists, shelf labels, count sheets.
  3. CSV export client-side (a copy of what is on screen claims no authority).
     XLSX stays server-side.
  4. Turn docs/perf-baseline.md into CI checks: fail the build if initial JS,
     per-app chunk, CSS or font payload exceeds the §7 budgets.
     NOW is when chunk tuning is allowed — you have the baseline. Vite 8 is
     Rolldown: use advancedChunks, not the deprecated manualChunks.

GATE: three commands green, plus CI failing on a deliberately oversized import
and passing once it is removed.
```

---

## Phase 6 — Tests

**Two agents.**

### 6A — Unit and contract

```text
[PREAMBLE]

GOAL: Vitest, and a contract test per API adapter.
You own: vitest.config.ts, src/**/*.test.ts, test/fixtures/**, package.json.

TASKS
  1. Install vitest + @testing-library/react + jsdom. Wire `bun run test`.
  2. Unit-test src/domains/*/model/ and src/shared/locale/. Money and date
     formatting first — six implementations just became one, and that is
     exactly where a regression hides.
  3. CONTRACT TESTS: record one real response fixture per endpoint from a
     running cloud-hub into test/fixtures/, then assert every
     domains/*/api/ normalizer still produces its declared model from it.
     This is what replaces writing 128 response schemas — see
     docs/frontend-architecture.md §4 Step 3. Record the fixtures; do not
     hand-write them, or the test proves nothing about the real API.
  4. Note which endpoints you could NOT record and why. That list is the real
     coverage number.

GATE: three commands green, `bun run test` green, and the fixture list in the
report.
```

### 6B — End-to-end

```text
[PREAMBLE]

GOAL: one Playwright smoke per app. Eighteen apps, and the failure mode this
repo actually has is "an app was merged broken and nobody noticed."

You own: playwright.config.ts, e2e/**, package.json, .github/workflows/**.

TASKS
  1. Install Playwright. One spec per app, each asserting:
       navigate → data renders → change a filter → RELOAD → same view
       → perform one write → it round-trips
  2. One floor flow at an iPad portrait viewport (768×1024): a scan-driven
     receiving session, start to finish.
  3. Wire all of it into CI alongside the three gate commands.

CONSTRAINTS
  - Breadth over depth. Eighteen shallow smokes beat three deep suites for the
    failure mode we have.
  - A test that needs a fixture the backend cannot produce is a finding, not a
    reason to mock. Report it.

GATE: three commands green, all specs green, CI running them.
```

---

## Running these

| Phase | Agents | Parallel? | Precondition |
|---|---|---|---|
| 0 | 1 | no | — |
| 1 | 1 | no | 0 green |
| 2A | 1 | no | 1 green |
| 2B | 14 | yes, cap 4 | 2A green + recipe written |
| 3 | 1 | **no** | 2B green |
| 4A | 1 | no | 3 green |
| 4B | ~10 | yes, cap 4 | 4A green |
| 5A/5B/5C | 3 | yes | 4B green |
| 6A/6B | 2 | yes | 5 green |

Two rules for whoever runs them:

1. **Review each agent's gate output yourself.** The report is a claim; the
   pasted command output is the evidence. The last run failed because nobody
   read the evidence.
2. **A phase is not green because most of its agents are.** One red domain
   blocks the next phase. That is the entire point of a gate.
