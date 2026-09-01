# Recipe: converting a domain to the query layer

Date: 2026-08-27
Reference implementation: **inventory** — `src/components/inventory/queries.ts`,
`src/components/inventory/route-states.tsx`, `src/routes/inventory.tsx`.

Follow this. Do not invent a variant.

> **Why this document is strict.** Four agents converted tables in parallel
> without a recipe, and each solved the same missing row-hover hook a different
> way — `display: contents`, a cell-scoped fallback, an ancestor selector, and
> local hover state. Four answers to one question, none wrong, all different.
> That is the cost of fanning out before the pattern is written down.

---

## What you are changing

A domain today fetches inside its screen: the component mounts, then asks. The
cost is not throughput — the user sees nothing until the round trip returns, on
every navigation, forever.

After this, the route starts the fetch **during** navigation, in parallel with
its own code chunk, and the screen subscribes to a cache that is already warm.

Same bytes, same requests. Completely different to use.

---

## Step 1 — `queries.ts`

One file per domain, beside its `api.ts`. **The only place a cache key for that
domain exists.**

```ts
import { queryOptions } from "@tanstack/react-query"

import { STALE } from "@/lib/api/stale"
import { fetchInventory, fetchInventoryOperations } from "./api"

export const inventoryQueries = {
  all: () => ["inventory"] as const,

  snapshot: () =>
    queryOptions({
      queryKey: [...inventoryQueries.all(), "snapshot"] as const,
      queryFn: ({ signal }) => fetchInventory(signal),
      ...STALE.ledger,
    }),

  cycleCountVariance: (id: string | null) =>
    queryOptions({
      queryKey: [...inventoryQueries.all(), "cycle-count", id, "variance"] as const,
      queryFn: ({ signal }) => fetchCycleCountVariance(id ?? "", signal),
      enabled: Boolean(id),
      ...STALE.operational,
    }),
}
```

Rules, and each has a reason:

- **`all()` first, everything built from it.** Invalidation matches by prefix, so
  a hierarchy is what lets a write state its blast radius precisely instead of
  refetching the whole domain.
- **Every input the fetcher closes over goes in the key.** Two screens with
  different filters otherwise share one cache entry and silently show each
  other's data.
- **Flat scalars only.** A key is hashed structurally; a `Date` or a `Set` inside
  one makes it refetch forever.
- **Never a hand-written `staleTime`.** Pick a class from `@/lib/api/stale`.

### Picking the stale class

| Class | Use for |
|---|---|
| `STALE.reference` | masterdata, locations, divisions, roles, chart of accounts |
| `STALE.catalogue` | articles, price lists, campaigns, suppliers |
| `STALE.operational` | balances, PO lists, receiving, roster, worklists |
| `STALE.ledger` | movements, journal, GL, audit — anything money or stock bearing |
| `STALE.session` | `/me`, permissions |
| `STALE.document` | a sealed artifact by id |

When unsure between `operational` and `ledger`, ask: *would a stale number here
make someone act wrongly?* If yes, `ledger`.

---

## Step 2 — the route loader

```ts
export const Route = createFileRoute("/inventory")({
  validateSearch: zodValidator(searchSchema),

  loader: async ({ context: { queryClient } }) => {
    void queryClient.query(inventoryQueries.operations()).catch(() => {})
    await queryClient.query({
      ...inventoryQueries.snapshot(),
      staleTime: "static",
    })
  },

  component: Inventory,
  pendingComponent: InventoryPending,
  errorComponent: InventoryError,
})
```

Four things here, and three are easy to get wrong:

1. **`queryClient.query()`, not `ensureQueryData`.** The latter is deprecated in
   the installed `@tanstack/query-core@5.102.7` and slated for removal.
2. **`staleTime: "static"` on the critical query** — accept a warm cache rather
   than blocking navigation on a refetch. This is what makes a return visit
   instant.
3. **Secondary queries are `void … .catch(() => {})`.** Awaiting them lets the
   slower one gate the whole navigation, and the panel's own `useQuery` already
   owns its loading state. **Do not** swallow the critical one's error — the
   `errorComponent` needs it.
4. **A secondary query that depends on the critical one.** The examples above
   assume the secondary queries are independent — most are. Accounting is not:
   its reports cannot be keyed until the reference query has supplied the
   fiscal year and period. Await the critical query, read its result back out
   of the cache synchronously, then fire the dependents unawaited:

   ```ts
   loader: async ({ context: { queryClient }, deps }) => {
     await queryClient.query({ ...accountingQueries.reference(), staleTime: "static" })
     const reference = queryClient.getQueryData(accountingQueries.reference().queryKey)
     const range = rangeFor(reference, deps.periodId)
     void queryClient.query(accountingQueries.trialBalance(range)).catch(() => {})
   }
   ```

   This is the one place `getQueryData` is correct outside a callback: the
   loader is not a component, so the non-reactive read is exactly what is
   wanted. *(Found by the accounting conversion — the recipe did not cover it.)*

5. **`loaderDeps` when a search param changes what loads.** Without it the
   loader does not re-run and changing a filter navigates to stale data:
   ```ts
   loaderDeps: ({ search }) => ({ location: search.location }),
   loader: ({ context, deps }) => …deps.location…
   ```

---

## Step 3 — pending and error components

Live in `src/components/<domain>/route-states.tsx`. See inventory's.

**The pending component draws the screen's own frame** — its rail width, its
header strip, its row grid — not a spinner. A spinner says "something is
happening somewhere". A frame says "this is inventory, and the numbers are
coming", which is the same information the user was going to get, a round trip
sooner.

**The error component reads `ApiError`, not `error.message`:**

```tsx
const api = isApiError(error) ? error : undefined
const forbidden = api?.forbidden || api?.unauthorized
const retryable = api?.retryable ?? true
```

A boundary that renders a bare message cannot tell "you may not see this" from
"the network dropped", and offers the wrong action for both. Show `Try again`
only when it is genuinely retryable, and `ask an administrator` on a 403.

---

## Step 4 — the screen

Point the domain's existing hooks at the new options:

```ts
export function useInventoryData(): InventoryResource {
  return useDomainQuery(inventoryQueries.snapshot())
}
```

`useDomainQuery` returns the same `ApiResource` shape the screens already read,
so **screen code does not change**. That is deliberate: the conversion is a
mechanism change, and mixing it with a rendering change makes both harder to
review.

Where a hook took an `enabled` flag:

```ts
return useDomainQuery({ ...inventoryQueries.operations(), enabled })
```

### One thing to fix while you are in there

`useApiQuery` set `placeholderData: keepPreviousData` on **every** query.
`useDomainQuery` does not, on purpose. Add it back only on **paged or filtered
lists**, where it prevents a flash between pages. On a detail view it shows the
previous record's data under the new record's heading — briefly, and
convincingly.

---

## Step 5 — do not delete `useApiQuery`

Other domains still use it. It carries an `@deprecated` tag pointing here. It
shrinks to zero as the last domain converts, and not before.

---

## The gate

```
bunx tsc -p tsconfig.app.json --noEmit
bunx eslint .
bunx vite build
```

Whole project, no path filters. Run all three yourself.

Then verify by hand, because the gate cannot see any of this:

- Navigating to the route paints structure immediately, not a blank pane.
- Changing a filter that is in `loaderDeps` re-runs the loader.
- Returning to a visited route resolves from cache with **no new request**
  (check the network panel — this is the whole point).
- A forced fetch failure shows the route's `errorComponent`, with the app rail
  and the other apps still usable.

---

## What not to do

- Do not restructure folders. That is a later phase and it will undo this one.
- Do not convert forms or tables in the same pass. One mechanism at a time.
- Do not add sorting, filtering or paging that was not there.
- Do not invent a second pattern. **If this recipe does not cover your case,
  stop and report the gap** — that is a cheaper outcome than fourteen domains
  each solving it differently.
