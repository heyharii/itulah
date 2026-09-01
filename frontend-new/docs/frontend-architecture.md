# RetailOS Frontend Architecture

Status: **proposed**
Date: 2026-08-27
Supersedes: `docs/tanstack-migration.md` (still valid as the per-app conversion
recipe; this document is the layer contract around it)
Companion: **`docs/frontend-rules.md`** — the query, cache, prefetch, mutation,
state, form and table rules that implement this contract

---

## 0. Where we actually are

Measured on 2026-08-27 against `vite-app/`. Every row was produced by running
something, not by reading a doc.

### Broken now

| # | Finding | Measured by |
|---|---------|-------------|
| 1 | **`vite build` fails with a parse error.** `system.tsx:161` opens a `<Link>` and closes it with `</button>`, plus two orphaned `setModule` calls. The app cannot be built — which also means **no performance number in this document can be re-measured until it is fixed**. | `bunx vite build` |
| 2 | **`tsc --noEmit` fails: 32 errors in 11 files.** | `bunx tsc -p tsconfig.app.json --noEmit` |
| 3 | `accounting.tsx` is a half-finished migration: 15 errors, all calls to `setTab` / `setPeriodId` / `setAccountId` / `setOpenAccount` deleted when reads moved to search params but writes were never converted. | TS2304 / TS2552 |
| 4 | Search-param types bleed across routes. Four screens call a router-global `navigate()` whose `prev` is the union of **all 18 routes'** params. Fix is `Route.useNavigate()`. | 14 × TS2322 |

### Layers that never landed

| # | Finding | Measured by |
|---|---------|-------------|
| 6 | **Zero route `loader`s.** Every screen starts its fetches on mount, inside the component. Nav → blank → spinner → content, every time. | `grep` |
| 7 | **Zero `errorComponent` / `pendingComponent` / `notFoundComponent`.** A render crash blanks the whole SPA. | `grep` |
| 9 | `useApiQuery` wraps Query but **erases** it — key and fetcher are consumed inside a hook, so no loader, prefetch or `setQueryData` can name that query. Carries `JSON.stringify(key)` in a dep array behind an `eslint-disable`. | `lib/api/query.ts` |
| 11 | `@tanstack/react-form` installed, **0 usages**. `commercial/forms.tsx` is **3,211 lines** of `useState` holding eight sheet forms. | `grep` · `wc -l` |
| 12 | `@tanstack/react-virtual` **not installed**. Nothing is virtualized. | `node_modules` |
| 13 | **No runtime validation at the API boundary.** 93 endpoints, hand-written interfaces and normalizers, nothing checks the wire. | `grep` |
| 15 | `AuthUser.permissions` is fetched on login and **read by nothing**. No authorization in the UI. | `grep` |
| 17 | **Zero tests.** No Vitest, no Playwright, no CI gate. | `find` |
| 19 | ESLint has no boundary rules. Nothing stops `inventory/` importing `hr/store`. | `eslint.config.js` |
| 20 | `HrProvider` wraps the **entire app** in `__root.tsx` — one domain's store is global to eighteen. | `routes/__root.tsx` |

### Performance and platform

| # | Finding | Measured by |
|---|---------|-------------|
| 16 | **RESOLVED 2026-08-27 — splitting works.** `autoCodeSplitting` produces a chunk per route (inventory 27 kB gzip, commercial 42.6 kB, …), initial JS is ≈188 kB gzip, under the 300 kB budget. Original finding, kept for the record: **bundle size is unknown, not bad.** The only build artifact on disk is one 1.28 MB chunk — but it predates the router plugin: the committed `vite.config.ts` has **no** `tanstackRouter` plugin at all, and `autoCodeSplitting` was added uncommitted afterwards. The single chunk is stale evidence. Splitting is **unmeasured**, and finding 1 is what blocks measuring it. | `git show HEAD:vite.config.ts` |
| 21 | ~~117 KB of the 303 KB font payload is never used.~~ **CORRECTED 2026-08-27:** the unused subsets are emitted to `dist/` but never transferred — Fontsource stamps every `@font-face` with a `unicode-range`, so a browser fetches a subset only when it renders a glyph in that range. Real first-paint font transfer is **≈89 KB**, not 303 KB. What remains worth doing is *preloading* the two latin faces, which are otherwise discovered only after the stylesheet parses. See `docs/perf-baseline.md`. | `dist/assets/*.woff2` · Fontsource `index.css` |
| 22 | **`ledger.tsx:92` silently truncates to 200 rows** after client-side filtering, with no indication to the user that more exist. It is a workaround for having no virtualization, and it is a correctness bug. `audit.tsx` is honest about its 500-row cap; `journal.tsx` has no bound at all. | `grep .slice(0,` |
| 23 | **No React Compiler.** 81 files use `useState`, and there is no memoization discipline to speak of. The compiler reached **v1.0 stable in October 2025** and `eslint-plugin-react-hooks@7` — already a devDependency — carries the rules that flag what it can't optimize. | `package.json` |
| 24 | **Tables are 760–900 px wide by fixed minimum.** `min-w-[820px]`, `min-w-[900px]`, `min-w-[760px]` appear 23 times. iPad portrait is 768 pt. | `grep` |
| 25 | **`viewport-fit=cover` is missing** from `index.html`, so `env(safe-area-inset-*)` resolves to 0 on iOS — the one place that uses it (`animated-sidebar.tsx:759`) is dead code on the device it was written for. | `index.html` |
| 26 | Responsive coverage is thin: 47 `sm:`, 34 `md:`, 16 `lg:` across 274 files. | `grep` |
| 27 | **Money formatting is copy-pasted six ways.** `Rp ${x.toLocaleString("id-ID")}` appears in `commercial/data.ts`, `articles.tsx`, `accounting/api.ts`, `commercial/api.ts` and more, with different rounding rules and a different zero case in each. Dates meanwhile use `toLocaleDateString("en-GB")`. There is no locale module. | `grep` |
| 18 | Dead island: `dashboard.tsx` → `app-sidebar` → `nav-*`, plus `site-header`, `chat/`, `interaction-sounds`. shadcn scaffolding nothing imports. | import graph |

### Already right — do not touch

File-based routing with zod-validated search params across all 18 routes
(`routes/inventory.tsx` is genuinely well done). The `ApiClient` transport with
its normalized `ApiError` and HTML-fallback guard. The auth service. The shadcn
`base-lyra` / Base UI layer. And `lib/touch.ts` — a careful, correct treatment
of pointer-coarse gesture handling that most codebases get wrong.

### The diagnosis

This is not an app that lacks architecture. It is one where a good architecture
was applied per-app by parallel workers and merged without a green build. That
sets the order of everything below: **the first phase is not adopting
libraries, it is making the thing compile and keeping it compiling** — and for
performance specifically, a broken build means there is nothing to measure.

---

## 1. The layer model

```
┌──────────────────────────────────────────────────────────────────────┐
│  SHELL      app/ — providers, router, auth gate, rail, theme         │
│             loaded once, never split, never imports a domain         │
└───────────────────────────────┬──────────────────────────────────────┘
┌───────────────────────────────▼──────────────────────────────────────┐
│  ROUTE      routes/ — path · search schema · guard · loader          │
│             thin. declares WHAT to load and WHO may see it.          │
│             owns errorComponent / pendingComponent.                  │
└───────────────────────────────┬──────────────────────────────────────┘
┌───────────────────────────────▼──────────────────────────────────────┐
│  DOMAIN     domains/<d>/ — where the product lives                   │
│    model/ · api/ · queries/ · mutations/ · forms/ · tables/          │
│    components/                                                       │
└───────────────────────────────┬──────────────────────────────────────┘
┌───────────────────────────────▼──────────────────────────────────────┐
│  SHARED     shared/ — infrastructure, zero domain knowledge          │
│    ui/ · api/ · table/ · form/ · permissions/ · realtime/            │
│    documents/ · locale/ · lib/                                       │
└───────────────────────────────┬──────────────────────────────────────┘
                                ▼
                Go · cloud-hub → store-router → dc-edge
```

**The one rule that makes this real:** dependencies point down and inward.
`shared/` may not import `domains/`. A domain may not reach into another
domain's internals — only its published `index.ts`. `app/` may import anything.
Enforced by ESLint in Phase 2, not by good intentions.

---

## 2. State: seven homes, one decision rule

| Ask | Home | Examples |
|-----|------|----------|
| *Would I paste this in Slack and expect a colleague to see the same screen?* | **URL** — Router search params | selected store, date range, search text, page, tab, sort, open record id |
| *Does the server own the truth?* | **TanStack Query** | articles, balances, movements, POs, employees, journals |
| *Is the user typing it and hasn't committed yet?* | **TanStack Form** | Create PO, Edit Article, Adjust Inventory |
| *Is it how a table is arranged, not what it contains?* | **TanStack Table**, seeded from the URL | column sizing, visibility, expansion, row selection |
| *Is it chrome, where restoring it from a link would be weird?* | **TanStack Store** or local `useState` | rail collapsed, command palette, AI panel, sound |
| *Is it identity?* | **Auth provider** (exists) | session, user, permissions |
| *Is it a live push from the backend?* | **SSE → `queryClient`**, never a second store | stock movements, PO status, chat |

Two anti-rules, both currently violated:

- **No domain store in the root.** `HrProvider` moves out of `__root.tsx` into
  the `hr-*` routes.
- **No second cache for server data.** Realtime writes into the Query cache.

---

## 3. Package decisions

### Keep

| Concern | Package | Note |
|---|---|---|
| Rendering | **React 19.2** | Solid was floated. Rejected: 73k LOC of React, a React-only Base UI layer, and no measured perf problem that the compiler + virtualization won't fix. |
| Routing | **TanStack Router 1.170** | Already file-based with validated search. |
| Server state | **TanStack Query 5.102** | Installed, half-adopted. |
| UI | **shadcn `base-lyra` on Base UI 1.7** | Current, well chosen. |
| Styling | **Tailwind 4** | 153 CSS custom properties already define the tokens. |
| Charts · motion | **recharts 3.8 · motion 13** | Fine. Revisit against a measurement. |

### Adopt

| Concern | Package | Why now |
|---|---|---|
| Render perf | **babel-plugin-react-compiler** | v1.0 stable since Oct 2025. Automatic, granular, conditional memoization — which this codebase has none of by hand. `"use no memo"` is the per-component escape hatch; `eslint-plugin-react-hooks@7` (already installed) flags what can't be compiled. Needs `@vitejs/plugin-react@6+` and `@rolldown/plugin-babel`; the compiler must run **first** in the Babel pipeline. |
| Forms | **@tanstack/react-form** *(installed, unused)* | 3,211 lines of `useState` in one file. Headless, typed, Standard-Schema validators, `form.Subscribe` for selective re-render. |
| Tables | **@tanstack/react-table v9** *(installed, 5/37)* | v9 is a real upgrade: `useTable` (not `useReactTable`), explicit `tableFeatures` so unused features tree-shake, prototype-shared row methods — up to **86% less retained heap**. Caveat: never destructure methods off rows or cells; they need `this`. |
| Long lists | **@tanstack/react-virtual** *(to install)* | See §7. |
| Client state | **@tanstack/react-store** *(present transitively)* | Make explicit. One store, ~5 keys. |
| Testing | **vitest · testing-library · playwright** *(to install)* | Currently zero. |
| Boundaries | **eslint-plugin-boundaries** *(to install)* | §1 is decoration without it. |
| Scanning | **a WASM barcode decoder** (zxing-wasm or zbar-wasm) *(to install, floor apps only)* | See §8. |

### Reject — with the condition that would change it

| Candidate | Verdict |
|---|---|
| **TanStack Start** | No. Internal ERP, no SEO, auth is cookie/bearer against a Go API. *Revisit for server-rendered public pages.* |
| **TanStack DB** | No — and it is genuinely interesting: normalized collections, sub-millisecond differential-dataflow live queries, optimistic mutations, sitting on top of Query. But we have not finished adopting Query itself. *Revisit after Phase 1, against a measured problem.* |
| **TanStack Pacer** | No. Still beta. Debounced search in ~6 places is ten lines. *Revisit at 1.0.* |
| **Any client-side PDF generator** (jsPDF, pdfmake, @react-pdf/renderer) | **No — architecturally wrong here.** See §9. |
| **A browser offline layer** (service-worker sync, IndexedDB queue) | No. See §8. |
| **Zod on every response** | Scoped down — see §4. |
| **A global store** | No, explicitly. |

---

## 4. The contract layer, honestly

The proposal draws `OpenAPI → generated client → Zod boundary`. That box cannot
be built today:

- `openapi-full.yaml` — 412 paths, **0 component schemas**. Produced by
  `gen_openapi.py`, a regex scraper over the chi router; every response is
  `200: Success`. Generating from it yields `Promise<unknown>` 412 times.
- `docs/api/openapi.json` — 128 real hand-authored schemas, but covering
  **8 of our 93 endpoints — 9%**.

The layer is right; the *source* is missing. Three steps, in order:

**Step 1 — make the boundary a real seam (now).** Keep hand-written adapters in
`domains/*/api/`, each with a declared response type and a normalizer. This
mostly exists; it just needs to be the *only* place a wire shape appears.

**Step 2 — validate selectively (now).** 128 response schemas would be a second
copy of the backend's types that drifts. Spend validation where being wrong is
expensive:

| Tier | What | Cost |
|---|---|---|
| **Always** | Envelope guard — JSON, `{data, meta}`, error shape, SPA-fallback HTML. Mostly written already. | ~0 |
| **Always** | **Write inputs** — the user can produce garbage. TanStack Form validates against the same schema, so it pays for itself twice. | low |
| **Always** | **Money- and stock-bearing reads** — accounting reports, journal, GL, inventory balances, movements, PO totals. A renamed field here becomes a wrong number someone acts on. | ~15 schemas |
| **Never** | Everything else — covered by Step 3. | 0 |

**Step 3 — contract tests instead of schemas for the rest (Phase 6).** Record
one response fixture per endpoint from a running cloud-hub; assert in CI that
each adapter still normalizes it. Drift caught before deploy, zero runtime cost.

**The path to codegen.** The real fix is upstream: the Go handlers should emit
the spec. When a schema-bearing spec exists, `generated/api/` drops in
*underneath* `domains/*/api/`, hand-written response types delete themselves,
and Step 2 stays as it is. **Nothing here blocks on that, and nothing here has
to be undone when it lands.**

---

## 5. Data flow contracts

### Read — the loader is the point

> **API note.** `ensureQueryData`, `fetchQuery` and `prefetchQuery` are
> **deprecated in the installed `@tanstack/query-core@5.102.7`** and marked for
> removal in the next major; `queryClient.query()` replaces all three, with
> `staleTime: 'static'` covering the old `ensureQueryData` behaviour. Verified
> against the shipped type declarations, not the docs.

```
route.loader ──► queryClient.query({ ...inventoryQueries.snapshot(loc),
                                     staleTime: 'static' })
                     │  starts the fetch DURING navigation, in parallel
                     │  with the code chunk
                     ▼
component ─────► useSuspenseQuery(inventoryQueries.snapshot(loc))
                     │  reads the warm cache, subscribes
                     ▼
              domains/inventory/api ──► ApiClient ──► Go
```

**A query key is created in exactly one place** — a `queryOptions` factory in
`domains/<d>/queries/`. That helper exists precisely so one definition feeds
`useQuery`, `useSuspenseQuery`, `queryClient.query`, `invalidateQueries` and
`setQueryData` with one shared type. Today's `useApiQuery` takes the key as a
loose argument and throws the pairing away — which is exactly why no loader can
exist.

```ts
// domains/inventory/queries/snapshot.ts
export const inventoryQueries = {
  all: () => ["inventory"] as const,
  snapshot: (locationId: string) =>
    queryOptions({
      queryKey: [...inventoryQueries.all(), "snapshot", locationId],
      queryFn: ({ signal }) => fetchInventorySnapshot(locationId, signal),
      staleTime: 30_000,
    }),
}
```

`useApiQuery` is **not** deleted on day one — it keeps unconverted screens
alive. Mark it deprecated; it shrinks to zero as domains convert.

### Write

```
Form (TanStack Form)
   │  input schema validates the draft
   ▼
mutation()  in domains/<d>/mutations/
   ├─ onMutate   optimistic setQueryData + snapshot for rollback
   ├─ onError    rollback + toast
   └─ onSettled  invalidateQueries(domainQueries.all())
                     ▼
               screens refetch themselves
```

Invalidation targets a **domain-namespaced prefix**, never a hand-listed array.

### Realtime

```
Go (SSE) ──► shared/realtime ──► setQueryData        (targeted)
                             └─► invalidateQueries   (coarse)
```

One connection per app session, opened in `app/providers`. It translates event
types into cache operations and holds no state of its own.

---

## 6. Source structure

```
src/
├── app/            providers · router · shell/ · auth/
├── routes/         file-based; one thin file per app
├── domains/<d>/    index.ts · model/ api/ queries/ mutations/
│                   forms/ tables/ components/
├── shared/         ui/ api/ table/ form/ permissions/ realtime/
│                   documents/ locale/ lib/
└── routeTree.gen.ts    generated — never edit
```

**On "domain-first" vs file-based routing.** The proposal put `routes/` inside
each domain. The Router plugin scans *one* directory, so that shape needs
`virtualRouteConfig` (`@tanstack/virtual-file-routes`, already in the lockfile).
**Recommendation: keep one thin `src/routes/` tree** — path, search schema,
guard, loader, lazy import, ~30 lines. The domain still owns everything real,
`autoCodeSplitting` stays on the well-trodden path, and for an 18-app ERP the
whole URL surface stays readable in one directory listing.

**Migration is `git mv`, not a rewrite.** `src/components/<domain>/` is already
~80% of the target. One domain per commit.

---

## 7. Performance

The priority. Four levers, ordered by how much they move what a user actually
feels — which is not the same as ordered by bundle size.

### Lever 1 — Kill the waterfall *(the biggest win, and it is free)*

Zero route loaders today. Every screen mounts, then fetches. The cost is not
throughput, it is that **the user sees nothing until the round trip returns**,
on every navigation, forever.

With `loader: ({context}) => context.queryClient.query(...)` the fetch starts *during* navigation, in
parallel with the route's code chunk, and `pendingComponent` paints the screen's
own skeleton immediately. Same bytes, same requests — a completely different
experience. This is Phase 1 and it needs no new dependency.

### Lever 2 — Render cost: React Compiler + virtualization

**React Compiler.** Stable at v1.0 since October 2025. This codebase has 81
files using `useState` and essentially no `useMemo`/`useCallback` discipline —
which is the exact profile the compiler was built for, because it memoizes
granularly and *conditionally* in ways hand-written memoization cannot. Adoption
is incremental: `"use no memo"` opts a component out, and
`eslint-plugin-react-hooks@7` (already a devDependency) reports what it had to
skip.

```ts
// vite.config.ts
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import babel from "@rolldown/plugin-babel"

plugins: [
  react(),
  babel({ presets: [reactCompilerPreset()] }),   // must run first in Babel
  tanstackRouter({ target: "react", autoCodeSplitting: true }),
  tailwindcss(),
]
```

**Virtualization.** Nothing is virtualized, and `ledger.tsx:92` shows what that
costs: a silent `.slice(0, 200)` that hides rows from the user to keep the page
from dying. Ledger, movements, audit, journal and the article catalogue are all
unbounded.

Two things to know before starting, both of which change the cost estimate:

- **A native `<table>` cannot do dynamic-height virtual rows.** Virtual rows are
  absolutely positioned; table layout fights that. Rows must be CSS grid or
  flex. So virtualizing our ~37 `<table>` screens is a **markup change**, not a
  wrapper — which is why §12 pairs it with the TanStack Table v9 rollout rather
  than treating it as a separate quick win.
- **Fixed row heights are far cheaper than measured ones.** Use `estimateSize`
  with a constant where rows are uniform (ledger, audit, journal — they are),
  and reach for `measureElement` + `data-index` only where they genuinely are
  not. Overscan trades DOM nodes against visible blanking.

### Lever 3 — Bytes

**Fonts — a free 117 KB.** `@import "@fontsource-variable/inter"` ships Cyrillic,
Cyrillic-ext, Greek, Greek-ext and Vietnamese. Import the latin subsets only:

```css
@import "@fontsource-variable/inter/latin.css";
@import "@fontsource-variable/inter/latin-ext.css";
@import "@fontsource-variable/jetbrains-mono/latin.css";
```

Then `<link rel="preload">` the two the shell actually paints with, so they are
not discovered only after the stylesheet parses.

**Code splitting — measure before tuning.** The 1.28 MB single chunk predates
the router plugin, so it proves nothing. Once the build is green:

1. Confirm `autoCodeSplitting` is producing per-route chunks.
2. Run a bundle visualizer before touching config.
3. **Note that Vite 8 is Rolldown-based and `manualChunks` is deprecated** in
   favour of `advancedChunks`. Rolldown also splits more aggressively than
   Rollup did, so the likely problem after step 1 is *too many small chunks*,
   not too few — the opposite of what the stale artifact suggests.

Only then set budgets. Guessing at chunk config before a visualizer run is how
teams pull rarely-used dependencies into widely-loaded chunks.

**Charts and heavy widgets.** `recharts` and `shiki` are large and used on few
screens. Once splitting is confirmed, they should be behind `React.lazy` at the
panel level, not the route level.

### Lever 4 — Data volume

Client-side filtering over a full dataset is the pattern behind finding 22.
Where a list can exceed a few thousand rows, filtering and paging belong on the
Go side; `placeholderData: keepPreviousData` (already the default in
`useApiQuery`) keeps paging from flashing. Where truncation is genuinely the
right answer, it must be **visible** — `audit.tsx` does this correctly and
`ledger.tsx` does not.

### Budgets

| Budget | Now | Target |
|---|---|---|
| Initial JS (shell + first route) | **unmeasured** — build broken | < 300 KB gzip |
| Per-app chunk | unmeasured | < 150 KB gzip |
| Fonts on first paint | 303 KB all subsets | < 90 KB, latin only |
| CSS | 301 KB raw | < 80 KB gzip |
| Rows in the DOM | all of them | viewport + overscan |
| Route transition to first paint | round-trip bound | skeleton immediate |

Every one of these becomes a CI check in Phase 5. A budget nobody enforces is a
wish.

---

## 8. Platform: desktop, iPad, and the floor

### The insight this section turns on

This is not one product that needs to be responsive. It is **two products
sharing a codebase**, and they want opposite things:

| | **HO desktop** | **Store / DC floor** |
|---|---|---|
| Apps | articles, commercial, sourcing, buying, finance, accounting, system, customers | `hr-store`, `inventory/store-receiving`, `inventory/operations` |
| Device | 24–27″, mouse, keyboard | iPad, handheld, sometimes one hand or gloves |
| Wants | density, many columns, keyboard shortcuts | large targets, few fields, scanner, forgiving |
| Session | hours | seconds, standing, interrupted |

"Make the tables responsive" is the wrong frame — an 18-column price grid should
not be on an iPad at all. The right frame is: **floor screens get a
touch-first layout as a first-class design, and HO screens get a graceful
tablet fallback and are honest that they are desktop tools.**

That also bounds the work. Three screens need real touch design, not eighteen.

### What the audit found

- **`viewport-fit=cover` is missing.** Without it `env(safe-area-inset-*)`
  resolves to 0 on iOS, so `animated-sidebar.tsx:759` — the one place that
  respects the home indicator — is dead on the device it was written for. One
  line in `index.html`.
- **23 tables carry `min-w-[760px]` … `min-w-[900px]`.** iPad portrait is 768 pt.
  These will scroll horizontally, which is acceptable on an HO screen viewed on
  a tablet and unacceptable on a floor screen.
- **Responsive coverage is thin** — 47 `sm:` / 34 `md:` / 16 `lg:` across 274
  files.
- **`lib/touch.ts` is genuinely good.** It reasons correctly about
  `pointer: coarse` describing the *primary* pointer rather than the current
  gesture, and about hybrid machines being wrong in both directions. Build on
  it; do not replace it.

### Barcode scanning — the constraint that decides the design

**`BarcodeDetector` is not implemented in WebKit**, so it does not exist in any
browser on iPad or iPhone. The iOS 17 Shape Detection feature flag did not
survive. There are exactly two workable options for a floor app:

1. **A hardware scanner in HID keyboard-wedge mode.** The scanner types the code
   and presses Enter. Works everywhere, zero browser API, fastest for a receiving
   or cycle-count workflow where the operator scans hundreds of items. **This
   should be the primary path**, and it means the receiving and count screens
   need a focused, always-listening input and a scan-to-row-append interaction —
   a design decision, not a library.
2. **A WASM decoder** (`zxing-wasm` or `zbar-wasm`) over `getUserMedia`, for the
   iPad-camera case where no scanner is present. Lazy-loaded, floor screens
   only, never in the HO bundle.

### Offline — deliberately not in the browser

Retail floor work argues for offline. **We should still not build it in the
browser**, because the estate already solves it one layer down: the Go backbone
runs `store-router` and `dc-edge` as offline-first runtimes with their own event
backbone. A service worker with an IndexedDB mutation queue would make the
browser a *third* sync tier with its own conflict semantics, competing with a
system explicitly designed to own that problem.

The correct shape: **the iPad talks to the local `store-router`, which is
already offline-capable.** The browser's job is to survive brief network blips —
which Query's retry policy and cache already do — and to fail loudly rather than
silently queue.

If a genuinely disconnected browser session is ever required, note what iOS
costs: the Cache API quota is small, and script-writable storage is evicted
after roughly seven days of non-use unless Persistent Storage is granted. A
store app used weekly can lose its cache between uses. That is a reason to keep
durability in `store-router`, not in Safari.

### PWA

Worth doing for the floor apps, for a narrow reason: home-screen install gives a
full-screen, chrome-free surface and a stable launch target on a shared iPad.
iOS 26 now defaults home-screen sites to web-app mode. **Not** worth doing for
offline durability — see above. Scope: a manifest, icons, `viewport-fit=cover`,
and a minimal asset-caching service worker. No sync layer.

---

## 9. Documents, PDF and export

### The finding that settles this

The Go backbone **already renders PDFs server-side**: `go-pdf/fpdf v0.9.0`,
`internal/cloud/checkprint/renderer.go` (cheques and payment vouchers, with
Indonesian *terbilang* amount-in-words), and `internal/cloud/docartifact` — a
service that **seals** documents with a SHA-256 hash, an issuance key, an
issuer principal and a doc-policy class before storing them in the object store.

That is a governed document-issuance pipeline, not a print helper. So:

> **Never generate a business PDF in the browser.** A client-rendered invoice,
> PO or voucher has no seal, no issuance record and no hash — it bypasses
> `docartifact` entirely, and two users can produce two different "official"
> documents for the same record. This is why jsPDF, pdfmake and
> `@react-pdf/renderer` are rejected in §3: not because they are bad libraries,
> but because the artifact they produce is not the artifact this system defines.

### What the frontend owns instead

`shared/documents/`:

| Concern | Approach |
|---|---|
| **Request** | Ask the server to issue a document; receive an artifact id. |
| **Preview** | Fetch the sealed bytes as a blob, render in an `<iframe>`/`<embed>`. Native PDF preview works on iOS Safari and every desktop browser, with no library. |
| **Reader UI** | Only add PDF.js if we need in-app search, annotation or page thumbnails. Do not add it for plain viewing. |
| **Download** | A blob URL with the server-supplied filename. Note the artifact-viewer sandbox blocks page-initiated downloads — the app is not affected, but shared previews of it are. |
| **Print** | A print stylesheet for operational sheets that need no seal (picking lists, shelf labels, count sheets). Anything legal, financial or customer-facing goes through `docartifact`. |
| **CSV export** | Client-side is fine — an export of what is already on screen carries no authority claim. |
| **XLSX export** | Server-side. Formatted workbooks are a report, and reports are the server's job. |

The rule to state plainly: **if the artifact makes a claim on behalf of the
company, the server issues and seals it; if it is a convenience copy of what the
user is already looking at, the client may produce it.**

---

## 10. Cross-cutting

### Errors — three tiers

| Tier | Owns |
|---|---|
| **Root** | `errorComponent` + `notFoundComponent` in `__root.tsx`. A render crash must never blank the SPA. |
| **Route** | One per app, so a broken accounting screen leaves the rail and the other 17 usable. `pendingComponent` renders the screen's own skeleton. |
| **Panel** | Around independently-loading regions — a sheet, a chart, the AI panel — so one failing widget doesn't take the screen. |

`ApiError` already carries `kind` / `status` / `retryable`. Boundaries render off
those, not off a bare message.

### Authorization

`AuthUser.permissions` is on the wire and read by nothing. `shared/permissions/`:

- `beforeLoad` throws `redirect` when a capability is missing — an unauthorized
  user never loads the chunk.
- `<Can do="inventory.adjust">` hides affordances the user can't use.
- `useCan()` for disabled states that need a reason tooltip.

The UI gate is a courtesy. **Go remains the enforcement point.**

### Locale — one module, not six copies

Money formatting is copy-pasted across at least six files with different
rounding and different zero cases, while dates use `en-GB`. For a chain whose
backend already writes Indonesian *terbilang*, that is both inconsistent and
wrong-facing.

`shared/locale/` owns: `formatIDR`, `formatQty`, `formatDate`, `formatDateTime`,
`formatRelative`, and the timezone the app treats as canonical. Two rules:

- **A money value is formatted in exactly one place.** Nothing else calls
  `toLocaleString` on a currency.
- **A "day" is a business day, not a browser day.** `lib/day.ts` derives days
  from the device clock and timezone. That happens to be safe for WIB/WITA/WIT
  today, but attendance and receiving dates should come from — or be reconciled
  against — the server, not the tablet's clock.

Indonesian UI strings are a separate, larger question. The domain structure means
i18n can be added per-domain later without a cross-cutting sweep. **Not
scheduled**, but the floor apps are where it would start, since that is where
the users are least likely to be reading English.

---

## 11. Testing

| Layer | Tool | Covers |
|---|---|---|
| Pure logic | **Vitest** | `model/` derivations, formatters, permission resolution |
| Adapters | **Vitest + recorded fixtures** | every `api/` normalizer against a real response — §4 Step 3 |
| Components | **Testing Library** | forms validate, tables sort, boundaries render |
| Flows | **Playwright** | one smoke per app: navigate → data renders → filter survives reload → write round-trips |
| Perf | **Playwright + size check** | the §7 budgets, as CI gates |
| Types | **`tsc --noEmit`** | must be green. It is not today. |
| Boundaries | **ESLint** | the §1 rules |

Eighteen apps, and the failure mode we actually hit is "an app was merged broken
and nobody noticed." The Playwright smoke matters more than any coverage number.

---

## 12. Execution plan

Each phase ends in a machine-checked gate. **No phase starts before the previous
gate is green.**

### Phase 0 — Make it build, and keep it building  *(~1 day, blocking)*

1. Fix `system.tsx:161` — the `<Link>`/`</button>` mismatch and two orphan
   `setModule` calls. *(item 1)*
2. Finish `accounting.tsx` — 15 dangling setters → `Route.useNavigate()`. *(item 3)*
3. Fix the 14 cross-route param bleeds. *(item 4)*
4. Clear the remaining 3 errors.
5. Delete the dead island — 8 files, no importers. *(item 18)*
6. CI: `tsc --noEmit && eslint . && vite build` on every push.

**Gate:** typecheck, lint and build green — and a broken merge is now impossible.

### Phase 1 — Measure, then take the free wins  *(~1 day)*

Only possible once Phase 0 lands. Cheap, high-certainty, no new architecture.

1. Build and run a bundle visualizer. Record the real numbers. *(item 16)*
2. Font subsets → latin/latin-ext, preload the two the shell paints. *(item 21)*
3. `viewport-fit=cover` in `index.html`. *(item 25)*
4. Turn on React Compiler; fix or `"use no memo"` what the ESLint rule flags. *(item 23)*

**Gate:** a recorded baseline for every §7 budget, and the compiler is on with
a known opt-out list.

### Phase 2 — Cache layer, done properly  *(~3 days)*

Do **inventory** end-to-end as the reference implementation, then fan out to 17.

1. `queryOptions` factories in `domains/inventory/queries/`.
2. `loader: ({ context }) => context.queryClient.query(...)` on the route.
3. `useSuspenseQuery` in the screen; `pendingComponent` + `errorComponent`.
4. Mutations with optimistic `setQueryData` + prefix invalidation.
5. Root `errorComponent` / `notFoundComponent`.
6. Write up the recipe; convert the rest against it.

**Gate:** inventory paints structure immediately, data arrives without a
mount-time waterfall, and a thrown error is contained to the screen.

### Phase 3 — Structure and enforcement  *(~2 days)*

1. `git mv components/<d>` → `domains/<d>`, `components/ui` → `shared/ui`,
   `lib/api` → `shared/api`. One domain per commit.
2. `HrProvider` out of `__root.tsx`. *(item 20)*
3. `eslint-plugin-boundaries` with the §1 rules, as **errors**.

**Gate:** the layer model is machine-checked; a cross-domain import fails CI.

### Phase 4 — Forms, tables, virtualization  *(~6 days)*

1. `shared/form/` — Field / FieldError / SubmitButton over TanStack Form.
2. Convert `commercial/forms.tsx` (3,211 lines, 8 sheets) as the pilot; then PO
   draft, article edit, inventory adjust.
3. `shared/table/DataTable` — v9 `tableFeatures`, URL-backed sort and filter,
   **CSS-grid rows** so virtualization is possible at all.
4. Install `@tanstack/react-virtual`; virtualize ledger, movements, audit,
   journal, catalogue — fixed `estimateSize` where rows are uniform.
5. Remove `ledger.tsx`'s silent `.slice(0, 200)`. *(item 22)*
6. Convert the remaining hand-rolled tables, biggest first.

**Gate:** no screen hand-rolls sort/filter; no list renders more than a viewport
of rows; no truncation is invisible; no form holds its draft in ad-hoc `useState`.

### Phase 5 — Platform: floor apps, authorization, realtime  *(~5 days)*

1. Touch-first layouts for the three floor screens — `hr-store`,
   `store-receiving`, `operations`. Large targets, few fields, scan-to-append.
2. HID keyboard-wedge scanner support; lazy WASM camera decoder as the fallback.
3. PWA manifest + icons for the floor apps. No sync layer.
4. `shared/permissions/` + route guards + `<Can>`. *(item 15)*
5. `shared/realtime/` SSE bridge → cache.
6. `shared/locale/` — one money formatter, one date formatter. *(item 27)*
7. `shared/documents/` — request, preview, download, print.
8. Enforce the §7 budgets in CI against the Phase 1 baseline.

**Gate:** a receiving clerk can complete a scan-driven receipt one-handed on an
iPad; an unauthorized user cannot load a route's chunk; every budget is a CI
check.

### Phase 6 — Tests  *(~4 days)*

1. Vitest + Testing Library; unit tests for `model/` and `shared/locale/`.
2. Record fixtures from cloud-hub; contract-test every adapter.
3. Playwright smoke per app, including one floor flow on an iPad viewport.
4. All of it into CI.

**Gate:** §11 is real, and "merged broken" is caught by a machine.

---

## 13. What this plan deliberately does not do

- Rewrite in Solid.
- Adopt TanStack Start.
- Adopt TanStack DB before Query is finished.
- Write 128 response schemas.
- Block on backend OpenAPI work.
- **Generate PDFs in the browser** — the server seals them, and a client copy
  would be an unsealed claim.
- **Build a browser offline/sync layer** — `store-router` and `dc-edge` already
  own that, and a third sync tier would compete with them.
- Tune chunk configuration before running a bundle visualizer.
- Make eighteen desktop apps touch-first when three of them are the floor apps.
- Restructure and re-architect in the same commit.
- Add a global store.

The through-line: this codebase's problem is not a shortage of architecture. It
is that a good architecture was applied unevenly and merged unverified — and
that the one thing performance work needs most, a build you can measure, is the
thing that is currently broken. Every phase ends in a machine-checked gate for
that reason.
