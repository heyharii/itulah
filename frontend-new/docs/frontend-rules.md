# RetailOS Frontend Rules

Status: **proposed**
Date: 2026-08-27
Companion to `docs/frontend-architecture.md` — that document says what the
layers are; this one says how to write code inside them.

Every rule has a **why**. A rule without a reason gets cargo-culted, and then
misapplied the first time it doesn't fit.

Verified on 2026-08-27 against the installed packages, not just the docs:
`@tanstack/query-core@5.102.7`, `@tanstack/react-form@1.33.5`,
`@tanstack/react-table@9.1.2`, `@tanstack/react-router@1.170`.

> **API correction.** `ensureQueryData`, `fetchQuery`, `prefetchQuery` and their
> infinite variants are **deprecated in the installed version** and marked for
> removal in the next major. The type declarations say so directly:
> `@deprecated Use queryClient.query({ ...options, staleTime: 'static' })`.
> All rules below use **`queryClient.query()`**. Do not write the deprecated
> forms into new code.

---

## Part 1 — Query rules

### Q1. A query key is created in exactly one place

Every key comes from a `queryOptions` factory in `domains/<d>/queries/`. No
component, loader, mutation or test writes a raw array.

```ts
// domains/inventory/queries/index.ts
export const inventoryQueries = {
  all:       ()                   => ["inventory"] as const,
  snapshots: ()                   => [...inventoryQueries.all(), "snapshot"] as const,
  snapshot:  (locationId: string) => queryOptions({
    queryKey: [...inventoryQueries.snapshots(), locationId],
    queryFn:  ({ signal }) => fetchInventorySnapshot(locationId, signal),
    staleTime: STALE.operational,
  }),
}
```

**Why:** `queryOptions` is the only thing that keeps a key and its fetcher typed
together. Once they are paired, the same object feeds `useQuery`,
`useSuspenseQuery`, `queryClient.query`, `setQueryData` and `invalidateQueries`
with one shared type — which is what makes route loaders and optimistic updates
possible at all. Today's `useApiQuery` takes the key as a loose argument and
throws that pairing away.

### Q2. Keys are hierarchical, narrow to broad, and prefix-invalidatable

`["inventory"] → ["inventory","snapshot"] → ["inventory","snapshot",locationId]`

**Why:** `invalidateQueries` matches by prefix. A hierarchy means one write can
invalidate exactly the blast radius it caused — `inventoryQueries.snapshots()`
for all locations, or one location — without a hand-maintained list of keys that
goes stale the moment someone adds a screen.

### Q3. The key contains every input the fetcher closes over

If the request reads `locationId`, `from`, `to` or a filter, all of them are in
the key.

**Why:** two screens with different filters otherwise share one cache entry and
silently show each other's data. This is the single most common Query bug.

### Q4. Serialisable inputs only — no objects with unstable identity

Flatten. `["ledger", locationId, from, to]`, not `["ledger", { filters }]` built
inline.

**Why:** keys are hashed structurally, so a fresh object literal each render is
fine *if* its contents are stable — but a `Date`, a function or a `Set` inside
one is not, and the query refetches forever. Flat scalars make that impossible
by construction. It also makes the key readable in devtools.

### Q5. Shape data with `select`, not in the component

```ts
useQuery({ ...inventoryQueries.snapshot(loc), select: (s) => s.rows })
```

**Why:** `select` runs after the cache, is memoised per observer, and narrows
what the component re-renders on. Deriving in the body re-runs on every render
and subscribes the component to the whole object.

### Q6. `enabled` guards dependencies; it does not hide loading

A query that needs an id waits with `enabled: Boolean(id)`. The screen must then
render a *waiting* state, not a spinner — the request has not been made.

**Why:** `enabled: false` leaves the query `pending` forever. Treating pending as
"loading" produces a spinner that never resolves.

### Q7. `placeholderData: keepPreviousData` is opt-in, not global

Use it on **paged and filtered lists**. Do **not** use it on detail views.

**Why:** on a list it prevents the flash between pages. On a detail view it shows
*the previous record's data* under the new record's heading — briefly, and
convincingly. Today's `useApiQuery` applies it to every query unconditionally;
that is a bug waiting for a detail screen.

### Q8. Never call `useQuery` inside a loop, a condition, or a table cell

Fan-out belongs in `useQueries`.

**Why:** hook order, and 500 rows means 500 observers.

### Q9. `getQueryData` is for callbacks only

Never in a component body.

**Why:** it is a non-reactive read. In a body it silently stops updating — the
type declaration says exactly this.

---

## Part 2 — Cache policy

### C1. Nothing sets `staleTime` by hand — it comes from a named class

`shared/api/stale.ts` owns the table. A query picks a class; it does not invent
a number.

| Class | What it covers | `staleTime` | `gcTime` | refetch on focus / reconnect |
|---|---|---|---|---|
| `STALE.reference` | masterdata locations, divisions, tags, roles, chart of accounts, permission catalogue | **30 min** | 60 min | no / no |
| `STALE.catalogue` | articles, price lists, campaigns, supplier records | **5 min** | 30 min | no / yes |
| `STALE.operational` | inventory balances, PO list, receiving batches, roster | **30 s** | 5 min | no / yes |
| `STALE.ledger` | movements, journal, GL, audit, anything money- or stock-bearing | **0** | 5 min | **yes** / yes |
| `STALE.session` | `/me`, permissions | **`'static'`** | ∞ | no / no — invalidated explicitly on login, logout and role change |
| `STALE.document` | a sealed `docartifact` artifact, by id | **`'static'`** | 30 min | no / no |

**Why each boundary:**

- **Reference data changes on a change-request, not on a shift.** Refetching a
  location list every 30 seconds across 18 apps is pure noise.
- **Ledger data is what someone acts on.** A stale stock figure or a stale
  balance is not a slow UI, it is a wrong decision. `staleTime: 0` plus
  refetch-on-focus means coming back to the tab reconciles it.
- **A sealed document is immutable by construction** — `docartifact` hashes it.
  `'static'` says "never consider this stale", which is the literal truth, and
  it is the correct use of the new `StaleTime = number | 'static'` type.
- **The session is invalidated by events, not by time.** A permission that
  expires on a timer is worse than one that expires on logout.

### C2. `staleTime` may be a function of the query when the server tells us

```ts
staleTime: (query) => query.state.data?.projection.ready ? 30_000 : 0
```

**Why:** the installed type is
`StaleTime | ((query) => StaleTime)`. Where a response reports its own readiness
— and the inventory pool projection literally does — freshness should follow
that, not a guess.

### C3. `gcTime` ≥ `staleTime`, always, and ≥ the time a user spends away from a tab

**Why:** `gcTime` is how long an *inactive* query survives. Set below
`staleTime` it evicts data that was still considered fresh, and every tab
switch becomes a cold load.

### C4. `refetchOnWindowFocus` is off globally and turned on per class

It is currently off globally. Keep that, and turn it on for `STALE.ledger`.

**Why:** an ERP user has fifteen tabs. Refetching all of them on every focus is
a self-inflicted load test. But the money screens are exactly where the user
expects returning to the tab to mean "show me now".

### C5. Retry only what a retry can fix

Already correct in `query-client.ts`: no retry below HTTP 500, two attempts
otherwise.

**Why:** a 403 does not become a 200 on attempt two; it just delays the error
state by two round trips.

### C6. Only `ApiError` reaches a boundary

The adapter normalises; the boundary reads `kind` / `status` / `retryable`.

**Why:** an error boundary that renders `error.message` cannot tell "offline"
from "you may not see this", and offers the wrong action for both.

---

## Part 3 — Prefetch rules

### P1. The route loader starts the fetch — the component never does

```ts
// routes/inventory.tsx
export const Route = createFileRoute("/inventory")({
  validateSearch: zodValidator(searchSchema),
  loader: ({ context, deps }) =>
    context.queryClient.query({
      ...inventoryQueries.snapshot(deps.location),
      staleTime: "static",          // ← replaces the deprecated ensureQueryData
    }),
  component: Inventory,
})
```

```ts
// the screen
const { data } = useDomainQuery(inventoryQueries.snapshot(location))
```

> **Not `useSuspenseQuery`.** An earlier draft of this rule recommended it. The
> Query docs are explicit that **cancellation does not work with Suspense
> hooks**, and this estate threads an `AbortSignal` into every fetcher —
> `fetchInventory` alone fans out into six concurrent requests that navigating
> away must be able to abort. `useDomainQuery` (built on `useQuery`) is
> therefore the correct long-term choice, not a shim to be replaced.

**Why:** the loader runs *during* navigation, in parallel with the route's code
chunk. The component runs *after* both. Same bytes, same requests — but the
user sees a skeleton immediately instead of a blank pane. This is the single
biggest perceived-performance win available in this codebase, and it costs no
new dependency.

### P2. `staleTime: 'static'` in a loader means "warm cache is good enough"

Use it for the loader's *critical* query. Omit it when the route must always
show a fresh number.

**Why:** `'static'` tells `query()` to accept whatever is cached and not block
navigation on a refetch. That is right for a snapshot the screen will revalidate
anyway, and wrong for a ledger the user navigated to *in order to* see the
current figure.

### P3. Critical data is awaited; secondary data is fired and forgotten

```ts
loader: async ({ context: { queryClient }, deps }) => {
  void queryClient.query(inventoryQueries.movements(deps.location)).catch(noop)   // secondary
  await queryClient.query({ ...inventoryQueries.snapshot(deps.location), staleTime: "static" })
}
```

**Why:** awaiting everything makes the slowest secondary panel gate the whole
navigation. `void … .catch(noop)` starts the request now and lets the panel's own
`useQuery` own its loading and error state. Do **not** swallow errors on the
critical one — the route's `errorComponent` needs it.

### P4. Loader dependencies are declared, or the loader will not re-run

```ts
loaderDeps: ({ search }) => ({ location: search.location }),
```

**Why:** a loader does not re-run on a search-param change unless that param is
in `loaderDeps`. Without it, changing the location filter navigates and loads
nothing.

### P5. Router preload stays `intent`, and `defaultPreloadStaleTime` stays `0`

Already correct in `main.tsx`.

**Why:** `intent` starts the loader on hover or touch-start, so the fetch is
often finished before the click lands. `defaultPreloadStaleTime: 0` stops the
router keeping a *second* copy of the loader result alongside the Query cache —
Query owns caching; the router owns navigation.

### P6. Hover-prefetch a row only when the row opens a detail view

```tsx
onMouseEnter={() => void queryClient.query({ ...articleQueries.detail(id), staleTime: 60_000 }).catch(noop)}
```

**Why:** it converts a click-then-wait into a click-then-see. Do not do it for
rows that only select — you would fetch a hundred details during a scroll.

### P7. Prime, don't fetch, when you already have the data

A list response that contains full records seeds the detail cache:

```ts
for (const row of rows) queryClient.setQueryData(articleQueries.detail(row.id).queryKey, row)
```

**Why:** a fetch you can avoid entirely beats a fetch you start early.

### P8. Never prefetch inside a virtualized row renderer

**Why:** a scroll becomes hundreds of requests. Prefetch on hover intent, which
fires once.

### P9. A route's eager half never imports a screen

`loader`, `loaderDeps` and `validateSearch` are **not code-split** — only
`component`, `errorComponent` and `notFoundComponent` are. So every module
those three touch lands in the entry chunk. Point them at `queries`, at `api`,
or at a small purpose-built helper; never at the screen.

```ts
// routes/_people/hr-store.tsx
import { HrStore } from "@/components/hr/hr-store"      // ✅ only used as `component`
import { currentMonthBounds } from "@/components/hr/month"  // ✅ a helper module
```

**Why:** this rule was written from a measurement, not a principle. That loader
imported `currentMonthBounds` — ten lines of date arithmetic — from
`hr-store.tsx`, and that one import put the whole 2,000-line People · Store
screen in the entry chunk at **55.5 kB minified**: the largest piece of
application code every user downloaded before first paint, in all eighteen
apps. Nothing about the code looked wrong, which is the point — the cost is
invisible at the call site and only shows up in a sourcemap attribution. See
`docs/perf-baseline.md`.

The same trap catches a search schema that validates against a fixture list:
`routes/_people/hr-store.tsx` still imports `LOCATIONS` from `hr/data` for its
`locationId` refinement. That one is deliberate and small; a screen is not.

---

## Part 4 — Mutation and invalidation rules

### M1. Every write lives in `domains/<d>/mutations/` and declares its own cache effect

The screen calls a mutation. It never calls `invalidateQueries` itself.

**Why:** when invalidation lives at the call site, adding a second caller means
someone forgets. When it lives with the write, it cannot be forgotten.

### M2. Invalidate by the narrowest prefix that is actually affected

```ts
onSettled: () => queryClient.invalidateQueries({ queryKey: inventoryQueries.snapshots() })
```

**Why:** invalidating `["inventory"]` after a single adjustment refetches the
ledger, the movements and every location snapshot. Q2's hierarchy exists so the
blast radius can be stated precisely.

### M3. Pick the optimistic shape before writing one

There are two, and the docs are explicit about when each fits:

| Situation | Shape |
|---|---|
| A sheet that closes on success | **Neither.** Nothing is left on screen to update. `onSettled` invalidation only. |
| The result shows in **one** place still on screen — a star, a toggle, an inline edit | **Variables-based.** Read `variables` and `isPending` off the mutation and render the pending state inline. Less code, and no rollback to get wrong. |
| **Several** places must reflect it | **Cache-based** `onMutate`, below. |
| Money or stock | **Neither, ever** — see M4. |

An earlier draft of this rule documented only the cache shape, which sends the
common case (a sheet that closes) down the harder road for no gain.

### M3b. A cache-based optimistic update requires `cancelQueries` first, and a rollback

```ts
onMutate: async (input) => {
  await queryClient.cancelQueries({ queryKey: key })
  const previous = queryClient.getQueryData(key)
  queryClient.setQueryData(key, (old) => apply(old, input))
  return { previous }
},
onError: (_err, _input, ctx) => queryClient.setQueryData(key, ctx?.previous),
onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
```

**Why:** without `cancelQueries`, an in-flight refetch lands *after* the
optimistic write and overwrites it with pre-mutation data. The snapshot is the
only thing that can undo the write when the server rejects it.

### M4. Do not do optimistic updates on money or stock

Adjustments, journal postings, PO sends and payments show a pending state and
wait for the server.

**Why:** an optimistic stock figure that rolls back has already been read and
acted on. The rollback is invisible to the person who wrote the number on a
pick sheet. Optimism is for things whose worst case is a flicker.

### M5. Server-generated identity never comes from the client

Never invent an id, code, document number or timestamp optimistically.

**Why:** `article_code` is server-minted and `docartifact` mints issuance keys.
A client-guessed id is a different record than the one that gets created.

### M6. Writes carry an idempotency key where the API requires one

Several routes require `Idempotency-Key` — the articles endpoint declares it
required in the spec. Generate once per *submission attempt*, not per retry.

**Why:** that is the point. A retry with a fresh key creates a second article.

### M7. `refetchType: 'none'` when the write already returned the truth

```ts
queryClient.setQueryData(key, response)
queryClient.invalidateQueries({ queryKey: key, refetchType: "none" })
```

**Why:** it marks the cache stale without an immediate refetch, so an open
screen keeps the authoritative response instead of round-tripping to fetch what
it was just handed.

---

## Part 5 — State rules

### S1. The seven homes (repeated here because it is the rule people skip)

| Ask | Home |
|---|---|
| Would a colleague opening this link see the same screen? | **URL** — router search params |
| Does the server own the truth? | **TanStack Query** |
| Is the user typing it and hasn't committed? | **TanStack Form** |
| Is it how a table is arranged, not what it contains? | **TanStack Table**, seeded from the URL |
| Is it chrome, and would restoring it from a link be odd? | **TanStack Store** or local `useState` |
| Is it identity? | **Auth provider** |
| Is it a live push? | **SSE → `queryClient`** |

### S2. URL params: short, stable, defaulted, and flattened

`q` `tab` `open` `sort` `dir` `view` `page`. Every param has `.default()` or is
`.optional()`. Never serialise an object into one param.

**Why:** a bare `/inventory` must be valid or the first visit 404s on its own
search schema. Flat scalars keep links readable and diffable — the reason
`routes/commercial.tsx` flattens store/channel/tier instead of carrying a
`priceContext` object.

### S3. Filter and tab changes use `replace: true`; opening a record pushes

**Why:** typing in a search box should not create thirty history entries that
Back has to walk through. Opening a detail *should* be undone by Back.

### S4. Always `Route.useNavigate()`, never the global `useNavigate()`

**Why:** the global one types `prev` as the union of **all 18 routes'** search
params, so `tab: "overview"` typechecks against inventory's enum. This is the
cause of 14 of the 32 current type errors.

### S5. Prefer `<Link>` over `onClick`-that-navigates

**Why:** links middle-click, hover-preload (P5), restore on Back, and are
reachable by keyboard for free. The `system.tsx` build break is a half-finished
conversion in this direction — the destination is right.

### S6. No domain provider above its own routes

`HrProvider` belongs in the `hr-*` routes, not `__root.tsx`.

**Why:** it currently mounts for all eighteen apps. A domain's context is part
of that domain's subtree, or it is a global store wearing a disguise.

### S7. The client store holds chrome only, and stays under about five keys

Rail collapsed, command palette open, AI panel open, sound preference, active
tray.

**Why:** everything larger has a better home above. A client store that grows is
how "we'll just put it in global state for now" starts.

### S8. Derived state is computed, never stored

**Why:** two sources of truth diverge. If it can be computed from URL + query
data, compute it — memoised in `model/` if it is expensive.

---

## Part 6 — Form rules

### F1. One `createFormHook` for the app; screens never call bare `useForm`

`shared/form/` binds the field components once:

```ts
// shared/form/index.ts
export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts()

export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField, NumberField, MoneyField, SelectField, DateField, SwitchField },
  formComponents: { SubmitButton, FormError },
})
```

**Why:** this is the composition API the library is built around. Bound once,
every form gets typed field components with no per-form wiring, and a field's
markup, label, error slot and disabled state are defined in one place instead of
being re-hand-rolled — which is precisely how `commercial/forms.tsx` reached
3,211 lines.

### F2. A form's schema lives in `domains/<d>/forms/` and is the **write input**, not the read model

**Why:** what the server accepts is not what it returns. Validating a draft
against the read model rejects valid drafts (missing server-minted fields) and
accepts invalid ones.

### F3. Schemas plug in directly — no adapter

Validators accept a Standard Schema, so zod 4 (or valibot, or arktype) passes
straight in:

```tsx
<form.AppField name="qty" validators={{ onChange: qtySchema }}>
```

**Why:** the installed `FieldValidateOrFn` is `FieldValidateFn | StandardSchemaV1`.
Wrapping it in an adapter adds a layer that does nothing.

### F4. Validation triggers, by field type

| Trigger | Use for |
|---|---|
| `onChange` | format and range — quantities, prices, dates, codes |
| `onBlur` | anything expensive or annoying mid-typing — cross-field consistency |
| `onChangeAsync` + `onChangeAsyncDebounceMs: 400` | server-checked uniqueness — article code, SKU, employee id |
| `onSubmit` | rules that need the whole form |
| `onServer` | field errors the backend returned |

**Why:** validating a code's uniqueness on every keystroke is a request per
character. Validating a quantity only on submit tells the user about it after
they filled in eleven other fields. And **the debounce is built in** — this is
part of why TanStack Pacer is rejected in the architecture doc.

### F5. Subscribe narrowly — `form.Subscribe`, never the whole form state

```tsx
<form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
```

**Why:** reading whole form state in the body re-renders every field on every
keystroke. On a 40-field PO sheet that is the difference between typing and
waiting.

### F6. Server-side field errors map back onto fields

A 422 sets errors on the named fields; only a genuinely form-level failure goes
to the form-level error slot.

**Why:** "Validation failed" at the top of a 40-field sheet is not an error
message, it is a scavenger hunt.

### F7. Submit disables on `isSubmitting`, and the button says what it does

`Save` → `Saving…` → toast `Saved`. Not `Submit` → `Loading`.

**Why:** double-submit is the most common way to create two POs. And a control
should name the outcome.

### F8. A dirty form warns before navigation

`shouldBlockFn` on the route, gated on the form's dirty state.

**Why:** these are long sheets. Losing one to a stray Back is a real cost.

### F9. Never mirror form state into Query, the URL, or a store

The draft lives in the form until submit.

**Why:** a draft is not shared, not linkable, and not server truth. Mirroring it
creates two writers and a sync problem that has no correct answer.

### F10. Reset from the server response, not from the local draft

On success, seed the cache with the response (M7) and reset the form from it.

**Why:** the server normalises — trims, rounds, mints ids, applies defaults. A
form still holding the pre-submit draft disagrees with what was actually saved.

---

## Part 7 — Table and list rules

### T1. Table arrangement state lives in the URL; row model state lives in the table

Sort key, sort direction, active filters, page → URL. Column sizing, visibility,
expansion, row selection → table state.

**Why:** the first set decides *what the user is looking at* and must survive a
reload and a shared link. The second is how they arranged their own window.

### T2. v9: declare `tableFeatures` explicitly; never destructure row or cell methods

```ts
const features = tableFeatures({ sortingFeature, filteringFeature })
const table = useTable({ features, columns, data })
```

**Why:** explicit features are what let the unused ones tree-shake. And v9 moved
row/cell/column methods onto shared prototypes — that is where the ~86% heap
reduction comes from, and it is also why `const { getValue } = cell` loses
`this` and breaks.

### T3. A virtualized table uses CSS grid rows, not `<table>`

**Why:** virtual rows are absolutely positioned and native table layout fights
that. This is a markup change, not a wrapper — budget it accordingly.

### T4. Fixed `estimateSize` unless rows genuinely vary

Ledger, audit and journal rows are uniform. Use a constant. Reach for
`measureElement` + `data-index` only where they are not.

**Why:** measurement forces layout reads per row.

### T5. Truncation must be visible

**Why:** `ledger.tsx:92` silently `.slice(0, 200)` after filtering, so a user
searching a large ledger sees 200 results and no indication there are more.
`audit.tsx` states its cap and its total; that is the correct pattern.

---

## Part 8 — Realtime rules

### R1. One connection, opened in `app/providers`

### R2. An event maps to a cache operation, never to component state

Targeted → `setQueryData`. Coarse → `invalidateQueries`.

**Why:** the cache is already the fan-out mechanism. Every screen reading that
key updates for free; a component-state path updates one screen and silently
diverges from the rest.

### R3. Coalesce bursts before invalidating

A receiving session emits hundreds of movement events. Debounce the invalidation.

**Why:** one invalidation per event is a refetch storm that will be slower than
having no realtime at all.

### R4. A realtime event never authenticates or authorizes

**Why:** it is data from a socket. Permission still comes from the session.

---

## Part 9 — Anti-patterns

| Don't | Do | Because |
|---|---|---|
| `queryClient.ensureQueryData(...)` | `queryClient.query({ ...opts, staleTime: "static" })` | deprecated in 5.102, removed next major |
| `queryClient.prefetchQuery(...)` | `void queryClient.query(opts).catch(noop)` | same |
| raw `["inventory", id]` in a component | `inventoryQueries.snapshot(id)` | Q1 |
| `useApiQuery(key, fn)` in new code | `useQuery(domainQueries.x())` | it erases `queryOptions` (arch §0 item 9) |
| `reload()` after a write | mutation `onSettled` invalidation | M1 |
| `useState` for a filter | search params | S1 |
| global `useNavigate()` | `Route.useNavigate()` | S4 |
| `useState` for a form draft | `useAppForm` | F1 |
| `.slice(0, N)` to keep a page alive | virtualize, or paginate server-side and say so | T5 |
| a second store for server data | the Query cache | R2 |
| a client-generated PDF | a server-sealed `docartifact` | arch §9 |
| `toLocaleString` on a currency | `formatIDR` from `shared/locale` | arch §10 |

---

## Definition of done, per screen

- Its queries come from a `queryOptions` factory and pick a named stale class.
- Its route has a `loader`, `loaderDeps`, `pendingComponent` and `errorComponent`.
- Its filters and tabs survive reload and Back.
- Its writes are mutations that own their invalidation.
- Its forms use `useAppForm` and validate a write-input schema.
- Its tables declare `tableFeatures`, and any list over ~500 rows is virtualized
  or honestly paginated.
- `tsc --noEmit`, `eslint .` and `vite build` are green.
