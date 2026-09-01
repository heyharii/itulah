# Server-side tables: filter, search, sort, paging

Status: **proposed — one decision needed before ~18 of 34 files can be migrated**
Date: 2026-08-27
Companion to `docs/frontend-rules.md` §T (tables) and §Q (queries).

Measured against `retail/internal/cloud`, not assumed.

---

## 0. What the backend actually supports

Counted by grepping every `Query().Get("…")` in `internal/cloud`:

| Param | Handlers | Verdict |
|---|---|---|
| `limit` | 66 | **Paging is universal.** |
| `offset` | 29 | Offset paging on most list routes. |
| `after` | 7 | Cursor paging on procurement, masterdata, customer, command, router. |
| `location_id` | 41 | **Dimension filters are well supported.** |
| `status` | 38 | |
| `store_id` | 26 | |
| `period` | 26 | |
| `entity_id` | 14 | |
| `sku` | 11 | |
| `from` / `to` | 6 each | Date ranges. |
| `employee_id`, `active`, `severity`, `module`, `resource_type`, `type`, `code` | 3–7 each | |
| **`q`** | **4 handlers** | `sales`, `search`, `masterdata/lookup`, `customer`. **Free text is thin.** |
| **`sort` / `order` / `order_by` / `dir`** | **0** | **No server-side sorting exists anywhere.** |

Two things follow, and they are the whole plan.

---

## 1. Client-side filtering over a paged list is a correctness bug

Twelve screens filter with `toLowerCase().includes(…)` after the fetch. That is
fine over a list the client fully holds. It is **wrong** over one the server
truncated — and four lists are truncated today:

| Screen | Cap | What the user sees when they search |
|---|---|---|
| `inventory/ledger.tsx:92` | `.slice(0, 200)` | searches 200 rows, reports a confident count |
| `inventory/missing.tsx:101` | `.slice(0, 120)` | same |
| `customers.tsx:460` | `.slice(0, 150)` | same |
| `system/audit.tsx` | 500, **stated** | correct — it names the cap and the total |

A user searching a 4,300-row article catalogue for "dress" gets "12 results"
from the 200 rows that happened to load. The real answer might be 300. This is
not a slow answer, it is a wrong one, and it is invisible.

**Rule:** a client-side filter may only run over a list the client fully holds.
If the list is paged, the filter goes to the server or it does not exist.

---

## 2. There is no server-side sort — and that breaks infinite scroll

Zero handlers read a sort parameter. So a sorted list can only be sorted in the
browser, over whatever has loaded.

Combine that with infinite scroll and it fails in a way users notice: you sort
by price, read down the list, and the next page arrives carrying a cheaper item
that belongs **above** where you are reading. Rows insert themselves behind your
eye. Scroll further and it happens again.

Sort and infinite scroll are compatible only when the sort happens where the
whole dataset is — the server.

**18 of 34 table files sort.** They cannot become infinite until this is settled.
The 16 that do not sort are unaffected and can migrate immediately.

### The fork

| Option | What it costs | What it gives |
|---|---|---|
| **A. Add `sort`/`order` to Go list handlers** | Backend work, ~40 routes, plus indexes for the sort columns | Correct sorting over the full dataset, infinite everywhere. The only option that is actually right. |
| **B. Sorted views are not infinite** | Nothing new; they load fully, or cap visibly with a stated total (the `audit.tsx` pattern) | Honest today, no backend work. Caps the dataset size a sorted view can serve. |
| **C. Sort only what has loaded** | Nothing | **Do not.** It is option B while telling the user it is option A. |

Recommendation: **B now, A when the Go side has capacity.** B is shippable this
week and is not thrown away by A — the same `VirtualRows` and `useInfiniteRows`
serve both; only the fetcher gains a parameter.

---

## 3. Global search already exists, and the frontend has never called it

`internal/cloud/search` is a dedicated service backed by a `search_index`
projection (migration 511):

```
GET  /api/v1/search/global    unified search across record types
GET  /api/v1/search/suggest   lightweight typeahead for pages and actions
POST /api/v1/search/reindex   admin rebuild by record_type
```

The frontend calls none of it. `forum/api.ts:38` even carries a comment noting
`/v1/search` exists and indexes `sku` / `customer` / `po` / `employee`.

So the global search asked for is **not a build, it is a wiring**. What it needs
on this side:

- `shared/search/` — one client for `/search/global` and `/search/suggest`.
- The command palette (`cmdk`, already a dependency) as its surface, since a
  global search that lives inside one app's toolbar is not global.
- A result → route mapping, so a hit on a PO navigates to `/buying` with the
  right `section` and `open` param.
- Debounced input — 250 ms, and `useDeferredValue` for the render, so typing
  never blocks.

Its index covers four record types. It is **not** a replacement for per-list
filtering, and the plan does not treat it as one: global search answers "where
is this thing", list filters answer "narrow what I am looking at".

---

## 4. The design

### One shape for every list

```
URL search params            ← the source of truth (rule S1)
        ↓
ListQuery { filters, q, sort, pageSize }
        ↓
queryKey: [domain, resource, ListQuery]   ← every input in the key (rule Q3)
        ↓
fetchPage({ offset, limit, ...filters, q })   → Go
        ↓
useInfiniteRows  →  VirtualRows
```

Nothing new is invented: the URL already holds the filters, `readPage` already
sends `limit` and reads `total`, and `useInfiniteRows` already turns `total`
into a next page. The change is that **the filter travels with the request
instead of being applied after it.**

### Three tiers of filter, by where they can be answered

| Tier | Answered by | Examples | Status |
|---|---|---|---|
| **Server dimension** | Go, today | location, status, store, period, date range, sku, employee, module, severity | ✅ supported on 40+ routes |
| **Server free text** | `q` on 4 handlers; `/search/global` for indexed types | article, customer, PO, employee | ⚠️ thin — most lists have no `q` |
| **Client refine** | the browser | quick chips, in-page narrowing | ✅ **only over a fully-held list** |

Where a list needs free text and its endpoint has no `q`, there are two honest
answers and one dishonest one: ask Go for a `q` (honest), load the list fully
and filter locally with the count stated (honest), or filter the loaded page and
report its count as the answer (what four screens do today).

### What `VirtualRows` needs to gain

Nothing structural. The component already takes `infinite`. What changes is on
the data side:

```ts
useInfiniteRows({
  queryKey: articleQueries.list(listQuery),
  fetchPage: ({ offset, limit, signal }) =>
    fetchArticles({ ...listQuery, offset, limit, signal }),
})
```

A filter change produces a new `queryKey`, which starts a new infinite query
from offset 0 — which is correct: a different filter is a different list, not a
continuation of the old one.

### Sort, under option B

`VirtualRows` gains nothing. The screen either:

- holds the whole list (no `infinite` prop) and sorts locally, or
- is infinite and **has no sort controls**, ordered by whatever the server
  returns — which for ledgers and audit is already the only order that makes
  sense (newest first).

---

## 5. Migration order

| Wave | Files | Why first |
|---|---|---|
| **1 — no sort, no truncation** | 16 files | Pure virtualization. No behaviour change, no decision needed. |
| **2 — silent truncation** | `ledger`, `missing`, `customers` | Each is a live correctness bug. Either infinite, or a stated cap. |
| **3 — sorted lists** | 18 files | Blocked on the §2 fork. Under option B they stay fully-loaded and only gain virtualization. |
| **4 — global search** | `shared/search/` + command palette | Independent of all of the above. |

---

## 6. What this plan does not do

- It does not add client-side sorting to an infinite list.
- It does not add a `q` parameter the backend does not have and pretend it filters.
- It does not treat global search as a replacement for list filtering.
- It does not migrate a table that has neither sorting nor filtering and fits on
  one screen — those stay as they are.
