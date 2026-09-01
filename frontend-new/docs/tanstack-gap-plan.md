# Maximising Router, Query and Start

Status: **proposed**
Date: 2026-08-27
Researched against the current docs, then measured against the codebase.

The read path is essentially maximal. The write path, the guard path, and the
URL path are not. This document is what is left, and — more usefully — three
things the research says we would have got *wrong* by proceeding on memory.

---

## 0. What the research corrected

### `useSuspenseQuery` would have broken request cancellation

`docs/frontend-rules.md` §P1 and `docs/recipe-domain-conversion.md` both say the
screen should read with `useSuspenseQuery`. The Query docs are explicit:

> Cancellation does not work when working with Suspense hooks:
> `useSuspenseQuery`, `useSuspenseQueries` and `useSuspenseInfiniteQuery`.

This estate's `ApiClient` threads an `AbortSignal` into **every** fetcher, and
`fetchInventory` alone fans out into six concurrent requests that a navigation
away must be able to abort. Adopting Suspense would have silently retired that.

**So the current `useDomainQuery` (built on `useQuery`) is not a compatibility
shim to be replaced later — it is the correct choice**, and the rules that say
otherwise are wrong. Corrected below.

### Optimistic updates have two shapes, and we documented only one

Rule M3 documents the cache approach — `onMutate`, `cancelQueries`, snapshot,
rollback. The docs describe a second, simpler one and say when each fits:

| Approach | Use when |
|---|---|
| **Variables-based** — read `variables` off `useMutation` and render the pending row inline | the optimistic result shows in **one** place. Less code, no rollback to get wrong. |
| **Cache-based** — `onMutate` + snapshot + rollback | **several** places on screen need to know |

Most of this app's writes are a sheet that closes on success. That is the
one-place case, and M3 sends it down the harder road for no gain.

Also note the newer signature: the client arrives via `context`, not a closure —
`onMutate: async (input, context) => { await context.client.cancelQueries(…) }`.

### `useBlocker` guards the browser, not just the router

Two screens hand-roll a `dirty` flag to warn before closing a sheet.
`useBlocker` covers route navigation **and**, via `enableBeforeUnload`, tab
close and reload — which a hand-rolled flag never did. `withResolver: true`
gives a real dialog instead of `window.confirm`.

---

## 1. Router — what is used, what is not

| Feature | Files | Verdict |
|---|---|---|
| `loader` | **14 / 14** | done |
| `pendingComponent`, `errorComponent` | **14** each | done |
| `loaderDeps` | 10 | done where needed |
| `defaultPreload: "intent"` | ✓ | done |
| **`notFoundComponent`** | **0** | **gap — my own Phase 2 required one at the root** |
| **`beforeLoad` guards** | **1** (an index redirect) | **gap — `AuthUser.permissions` is still read by nothing** |
| **`useBlocker` / `Block`** | **0** | **gap — rule F8, and three form conversions are landing now** |
| **`retainSearchParams`** | **0** | **gap — cross-app links drop context** |
| `stripSearchParams` | 2 | partial — rule S2 wants defaults out of every URL |
| Route masking | 0 | **not needed.** Considered: many screens use `?open=<id>` for a detail sheet, and masking would hide it. But that param is the reason those sheets are linkable at all, and the mask is lost when the URL is shared — which is exactly when it matters. Deliberately declined. |

## 2. Query — what is used, what is not

| Feature | Files | Verdict |
|---|---|---|
| `queryOptions` | 15 | done |
| `queryClient.query` in loaders | 15 | done |
| `useDomainQuery` (`useQuery`) | 20 | done — and correct, see §0 |
| `keepPreviousData` | 5 | done, deliberately narrow |
| **`onMutate` / optimistic** | **0** | **gap** |
| **`mutations.ts` per domain** | **0** | **gap — rule M1** |
| `setQueryData` after a write | 1 | **gap — rule M7** |
| `useApiWrite` (the old wrapper) | **31 call sites** | the thing to replace |
| `persistQueryClient` | 0 | **candidate, not a gap** — see §4 |
| `useSuspenseQuery` | 0 | **correct as-is.** Do not adopt. |

## 3. Start

**Release Candidate.** Feature-complete, API stable, still not 1.0. It adds
server functions, full-document SSR, streaming and server routes — and the docs
present it as a framework, not modular additions to an existing Vite SPA.

The rejection stands, and the measurement behind it has not moved: warm
navigation on inventory is **48 ms with zero requests**. Start changes nothing
about that number, because after the first document it *is* Router + Query.

The one fact that would reopen it is unchanged too: how often a floor iPad cold-
loads after iOS evicts the tab. Nobody has measured it.

---

## 4. The plan

Ordered by what a user feels, not by feature count.

### Wave 1 — the three Router gaps *(small, and two are self-inflicted)*

1. **Root `notFoundComponent`** in `__root.tsx`. A mistyped URL currently
   produces whatever the router does by default, which nobody has looked at.
2. **`useBlocker` on every converted form**, gated on the form's own dirty
   state, with `enableBeforeUnload`. Delete the two hand-rolled `dirty` flags —
   they cover strictly less. `shared/form` already exposes `<form.WhenDirty>`;
   this is the navigation half of the same fact.
3. **`retainSearchParams`** at the root for the params that should survive a
   cross-app jump. Candidates: none obvious yet — the apps do not share a
   param today. **Verify before building**: if nothing qualifies, do not add it.

### Wave 2 — the write path *(the real gap)*

`mutations.ts` per domain, replacing 31 `useApiWrite` call sites.

Per rule M1, each write owns its cache effect. Per §0, choose the shape:

- **Sheet writes that close on success** → variables-based. Nothing to roll
  back; the sheet is gone.
- **In-place row edits, toggles, stars** → cache-based `onMutate` with
  `cancelQueries` + snapshot + rollback, because the row stays on screen.
- **Money and stock** → **neither.** Rule M4: pending state, wait for the
  server. An optimistic stock figure that rolls back has already been read.

Do inventory first as the reference, exactly as the query layer was done, and
write the recipe **from** it before fanning out. That rule was broken once
already and cost four different hover implementations.

### Wave 3 — authorization *(the oldest finding in this project)*

`AuthUser.permissions` has been fetched and ignored since the first audit.

- `shared/permissions/` — `requireCapability()` for `beforeLoad`, `<Can>` for
  affordances, `useCan()` for disabled states with a reason.
- `beforeLoad` throws `redirect` on a missing capability, so an unauthorized
  user never loads the route's chunk.
- The UI gate is a courtesy. **Go remains the enforcement point.**

### Wave 4 — `stripSearchParams` everywhere

Rule S2 says a bare `/inventory` should be a valid, clean URL. Two routes do
this; fourteen should.

### Not scheduled, and why

- **`persistQueryClient`** — genuinely interesting for the floor iPad, where iOS
  evicts the tab and every return is a cold load. But it is the *same open
  question* as Start: without the cold-load frequency, adopting it is a guess
  with a 24-hour `gcTime` and a deploy-buster to maintain. Measure first.
- **Route masking** — declined, see §1.
- **`useSuspenseQuery`** — declined, see §0. It would cost cancellation.
- **TanStack Start** — declined, see §3.

---

## 4b. Status, 2026-08-28

| Wave | State |
|---|---|
| 1 — root `notFoundComponent` | **done** (`routes/__root.tsx`) |
| 1 — `useBlocker` on forms | **done** (`shared/form/use-unsaved-guard.ts`) |
| 1 — `retainSearchParams` | **declined, as §4 predicted.** Checked all fourteen search schemas: no param is shared across two apps, so there is nothing to retain. Revisit only if a cross-app scope (a store, a period) is ever introduced. |
| 2 — the write path | **done.** Eleven `mutations.ts`; `useApiWrite` and `useApiQuery` reached zero call sites and have been **deleted** from `lib/api/query.ts` — they were still exported from `@/lib/api`, which is the one place a new screen would have found them. |
| 3 — authorization | **half done.** `shared/permissions/` ships `useCan`, `<Can>` and the matching rules, with tests. `requireCapability()` for `beforeLoad` is **blocked** — see below. |
| 4 — `stripSearchParams` | **done.** 13 of 14 routes (chat has no defaulted param, so it is correctly excluded). |

### Why Wave 3 is only half done

`beforeLoad` can read `RouterContext`, and `RouterContext` holds `queryClient`
and nothing else. The session lives in React state inside `AuthProvider`, which
is mounted **below** `RouterProvider` — inside the root route's own component.
So at the moment `beforeLoad` runs there is no session to consult, and no
helper in `shared/permissions/` can change that.

Closing it means either lifting `AuthProvider` above `RouterProvider` and
putting the session on the router context, or making the session a Query so
`beforeLoad` reads it through `context.queryClient`. **The second fits better**
— `STALE.session` already exists and is described in rule C1 as invalidated by
login/logout/role-change events rather than by time, which is exactly what a
Query gives. Either is a change to how the app boots.

There is a second reason not to rush it: **no permission code appears anywhere
in this codebase.** The codes are minted by the hub's permission catalogue
(`SystemPermission.code`), and the client only ever sees them at runtime. A
route→capability map written today would be fourteen guesses, and per
`shared/permissions/capability.ts` a wrong guess silently allows. The map has
to come from the catalogue, not from a frontend author.

---

## 5. Corrections to make in the existing docs

Both of these say the wrong thing today and will be followed:

- `docs/frontend-rules.md` §P1 and `docs/recipe-domain-conversion.md` Step 4 —
  recommend `useSuspenseQuery`. They must say `useQuery` via `useDomainQuery`,
  and say why: Suspense hooks cannot be cancelled.
- `docs/frontend-rules.md` §M3 — documents only the cache-based optimistic
  update. It must carry both shapes and the rule for choosing.
