# Performance baseline

Date: 2026-08-27
Measured against a running cloud-hub on `localhost:8080`, Vite 8 / Rolldown.

Every number here came from a build or from the browser's Resource Timing API.
Where a claim in `docs/frontend-architecture.md` turned out to be wrong, the
correction is recorded below rather than quietly edited away.

---

## Bundle

| | Before | After | Δ |
|---|---|---|---|
| Shell `index.js` (gzip) | 158.7 kB | 161.2 kB | **+2.5** |
| All JS (gzip) | 425.2 kB | 513.3 kB | **+88.1** |
| CSS (gzip) | 46.2 kB | 46.2 kB | 0 |
| Build time | 1.0 s | 11–13 s | +11 s |

The +88 kB is the React Compiler emitting memoization. It is a real cost and it
is not evenly spread: the **shell grew by only 2.5 kB**, which is what gates
first paint, while the per-route chunks — which load in parallel with the
loader's fetch — absorbed the rest. The build-time cost is Babel (91% of build
time, 12.1 s across 159 files).

**Code splitting works.** This was finding 16's open question. `autoCodeSplitting`
produces a chunk per route:

```
inventory   113.5 kB │ gzip  27.0 kB
commercial  155.6 kB │ gzip  42.6 kB
hr-ho        62.2 kB │ gzip  12.2 kB
po           57.2 kB │ gzip  13.3 kB
… 14 more
```

The 1.28 MB single chunk cited in the architecture document was stale evidence —
it predated the router plugin. Splitting was never broken, only unmeasured, and
the parse error was what blocked measuring it.

Adding the route loader **shrank** the inventory chunk from 127.3 to 113.5 kB:
the route's critical part (path, search schema, loader) now splits away from
its component.

---

## 2026-08-28 — what was actually in the entry chunk

The numbers above measure the *change* the compiler and the router plugin made.
Nobody had asked the other question: what is in the shell at all. Attributing
the entry chunk's bytes back to source modules through its sourcemap answered
it, and two of the top three were mistakes rather than costs.

| | kB (minified, in entry) | |
|---|---|---|
| `react-dom` | 170.8 | inherent |
| **`components/hr/hr-store.tsx`** | **55.5** | **a bug — see below** |
| `@tanstack/router-core` | 30.6 | inherent |
| every domain's `api.ts`, summed | ~71 | inherent to loaders |
| `cmdk` + `ui/command` | 14.1 | **avoidable — see below** |

### The 55 kB screen in the shell

`routes/hr-store.tsx` imported `currentMonthBounds` — a ten-line date helper —
from `components/hr/hr-store.tsx`, and called it in its **loader**. A route's
loader is not code-split; only its `component` is. So importing that one helper
pulled the entire 2,000-line People · Store screen into the chunk every user
downloads before the first paint, including the fifteen apps that have nothing
to do with People.

The helper now lives in `components/hr/month.ts`. Rule P9 in
`docs/frontend-rules.md` generalises it: **anything a route's `loader`,
`loaderDeps` or `validateSearch` imports is eager.**

### The command palette

`cmdk` and the `ui/command` tree were in the entry chunk to render nothing on
almost every page load. The palette is now a hotkey shell around a `lazy()`
dialog (`shared/search/palette-dialog.tsx`), warmed on the first Meta/Control
keydown rather than on a timer — so a floor iPad, which has no ⌘K, never
fetches it at all.

### The People provider

`HrProvider` was mounted in `__root.tsx`, against rule S6. It now belongs to
the pathless `_people` layout route over `/hr-ho`, `/hr-store` and `/finance`.
A layout route rather than three providers, because Finance reads `netFor` and
`payroll` off the same register Head Office edits, and the layout stays mounted
across navigation between its children — so the store survives the jump the way
it did at the root.

### Result

| | Before | After | Δ |
|---|---|---|---|
| Entry `index.js` | 588.2 kB │ gzip 185.8 | 459.8 kB │ gzip 135.0 | **−128 kB │ −50.8 gz (−27%)** |

The shared `motion` chunk (233 kB │ gzip 69 kB) is now the largest single item
on the critical path after `react-dom`. It is **not** low-hanging: `motion` is
imported by `app-rail.tsx` *and* by `sheet-shell.tsx`, which every screen uses,
so removing it from the rail would not take it off the path. Reducing it is a
design decision about how this suite animates, not a bundling one — unmeasured
and unattempted.

---

## Correction — the font finding was wrong

`docs/frontend-architecture.md` finding 21 says 117 kB of the 303 kB font
payload "is never used" and implies a transfer saving. **The transfer saving is
approximately zero.**

Fontsource emits every `@font-face` with a `unicode-range`. The browser only
downloads a subset when a glyph in that range is actually rendered, so an
Indonesian user never fetches the Cyrillic, Greek or Vietnamese files. They sit
in `dist/` and on the CDN; they do not cross the wire.

Actual first-paint font transfer: `inter-latin` (48.3 kB) + `jetbrains-mono-latin`
(40.4 kB) ≈ **89 kB**, not 303 kB.

What is still worth doing, and is not done yet:

- **Preload** those two faces. They are discovered only after the stylesheet
  parses, which costs a round trip before text swaps from the fallback.
- Trimming the unused subsets is build hygiene and CDN storage, not user-visible
  latency. Low priority; do not sell it as a performance win.

---

## Request waterfall — the real find

`fetchInventory` awaited `balances` alone, then ran the other five requests in
parallel. None of the five reads anything out of the balance rows; the split
existed only to make a balances failure fatal and the rest degraded — a
difference in how results are *handled*, not in when they are *asked for*.

Measured before, against a local hub:

```
balances    437 → 608 ms
locations   610 → 675 ms      ← waited on balances for nothing
```

After moving all six into one `Promise.allSettled` and rethrowing the balance
rejection:

```
balances          263 → 303 ms
locations         263 → 302 ms
bins              263 → 317 ms
movements         263 → 326 ms
problem-inventory 263 → 334 ms
pool-status       264 → 323 ms
```

All six start within 1 ms of each other. The snapshot completes in **71 ms**
instead of a serial chain. Against a real network, where a round trip is 10× a
localhost hop, the saving scales with it.

The fatal-vs-degraded contract is unchanged.

**The same shape exists elsewhere and is not yet fixed.** These files each hold
more than one top-level serial `await` on an API call; some are genuine
dependencies and some are not, so each needs reading rather than a blanket
change:

| File | Serial awaits |
|---|---|
| `hr/api.ts` | 11 |
| `accounting/api.ts` | 7 |
| `chat-app/api.ts` | 6 |
| `po/api.ts` | 5 |
| `inventory/api.ts` | 5 (one fixed) |
| `articles/`, `forum/`, `sourcing/` | 3 each |
| `customers/`, `system/` | 2 each |

---

## Route loader — inventory

The inventory route now starts its fetch during navigation instead of on mount:

```ts
loader: async ({ context: { queryClient } }) => {
  void queryClient.query(inventoryQueries.operations()).catch(() => {})
  await queryClient.query({ ...inventoryQueries.snapshot(), staleTime: "static" })
}
```

Backed by `pendingComponent` rendering the screen's own frame — rail, header
strip, table rows — rather than a spinner, and `errorComponent` that reads
`ApiError.kind` / `.status` / `.retryable` so a 403 offers "ask an
administrator" and a transport fault offers "try again".

Navigating back to a visited inventory screen now resolves from cache with no
request at all, because `staleTime: "static"` in the loader accepts a warm
cache. That is the intended behaviour, not a missing fetch.

---

## Lint debt

`bunx eslint .` — **0 errors, 107 warnings**. The warnings are deliberate and
documented in `eslint.config.js`:

| Rule | Count | Why a warning |
|---|---|---|
| `react-refresh/only-export-components` | 76 | HMR ergonomics, zero production impact. The fix is the file split Phase 3 performs. |
| `react-hooks/set-state-in-effect` | 15 | Almost all of it is a hand-rolled query or a form draft seeded from loaded data — code Phase 2 and Phase 4 delete outright. |
| `react-hooks/refs` · `immutability` · `use-memo` | 16 | Mostly `motion/` and `agents/`, where a ref callback writes in a phase the compiler cannot prove safe. Correct React; conservative analysis. |

These are the components the compiler skipped. The count is the number to watch,
and both groups have a phase that retires them.

---

## Budgets — status

| Budget | Target | Now |
|---|---|---|
| Initial JS (shell + first route) | < 300 kB gzip | **≈ 188 kB** (161 shell + 27 inventory) ✅ |
| Per-app chunk | < 150 kB gzip | **max 42.6 kB** (commercial) ✅ |
| Fonts on first paint | < 90 kB | **≈ 89 kB** ✅ (already, via `unicode-range`) |
| CSS | < 80 kB gzip | **46.2 kB** ✅ |
| Rows in the DOM | viewport + overscan | ❌ not started — no virtualization |
| Route transition → first paint | skeleton immediate | ✅ inventory only; 17 apps to go |

Four of six budgets are already met. The two that are not are the two that need
the remaining phases.
