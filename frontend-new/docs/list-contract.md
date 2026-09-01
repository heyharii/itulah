# The list contract

Status: **proposed** — one shape for every list endpoint and every table.
Date: 2026-08-27
Spans: `retail/internal/cloud` (Go) and `slowdown/vite-app` (React).

Every paged, filtered or searchable list in RetailOS speaks this contract. It
exists because the two sides currently disagree with each other *and with
themselves*, in a way that silently loses data.

---

## 0. What is wrong today

Counted across `internal/cloud`:

| Aspect | Today | Count |
|---|---|---|
| Array key | `items` | 221 |
| | `data`, `rows`, `entries`, `results`, `locations`, `suppliers`, `employees`, `balances`, `records`, `movements`, `customers` | 29 across 11 names |
| Row count | `count` | 158 |
| | `total` | 117 |
| Paging | `offset` | 29 |
| | `after` / `next_cursor` | 7 |
| | `page` | 2 |
| Free text | `q` | **4 handlers** |
| Sort | `sort_by` / `sort_dir`, via `_lib/listparams` | 4 packages |

### The bug this causes

`count` and `total` are not two names for one thing. They are two things, and
`total` is used for both:

```go
"count": len(items)   // rows in THIS page          ~47 sites
"total": total        // rows in the whole result    ~44 sites
"total": len(items)   // rows in THIS page           ~17 sites  ← same name, other meaning
```

The frontend's `readPage` decides whether the server withheld rows with:

```ts
truncated: total !== undefined && total > items.length
```

On the ~17 endpoints where `total` *is* `len(items)`, that is **always false**.
The client concludes "nothing was withheld" precisely where it cannot know, and
an infinite list would stop after page one without saying so. This is not a
hypothetical: it is why four screens shipped a silent cap and nobody noticed.

### Correction, 2026-08-27

An earlier draft of this document said **no server-side sorting exists**. That
was wrong, and the way it was wrong is worth recording: the claim came from
grepping `Query().Get("sort")`, which returns nothing because the estate does
not read sort off the request. It reads it through a shared library.

`internal/cloud/_lib/listparams` and `_lib/listquery` already implement most of
what this document was about to invent:

| Library | Provides |
|---|---|
| **`listparams`** | `limit` / `offset`, **`sort_by` / `sort_dir`** validated against a per-handler whitelist, `date_from` / `date_to`, comma-list IN filters, `min_<n>` / `max_<n>` ranges, an `{items, total}` envelope, and `X-Total-Count` |
| **`listquery`** | schema-driven: `q` text search across declared columns, multi-value and enum filters, `<key>_gte` / `<key>_lte` ranges, whitelisted sort, **facets**, groups, cursor |

Adopted so far by `procurement`, `accounting`, `paymententry`, `deadletter`.

**So this contract is an adoption, not an invention.** The frontend uses the
names those libraries already parse. Where the two libraries disagree with each
other — `listparams` ranges are `min_`/`max_`, `listquery` ranges are
`_gte`/`_lte` — that is a real inconsistency to settle on the Go side, and the
client passes both through `filters` until it is.

---

## 1. The request

```
GET /api/v1/<resource>
      ?limit=50
      &cursor=<opaque>
      &q=<free text>
      &sort_by=<field>&sort_dir=asc|desc
      &date_from=<iso>&date_to=<iso>
      &<filter>=<a>,<b>            comma means OR
```

| Param | Rule |
|---|---|
| `limit` | Server clamps. Default 50, max 200. A client asking for more gets the max, not an error. |
| `cursor` | **Opaque.** The client never parses, constructs or reasons about it. Absent means "from the beginning". |
| `q` | Free text over the resource's own searchable fields. Absent means no text filter — never an empty-string match. |
| `sort_by` / `sort_dir` | Field and direction, as `listparams` parses them. An unknown field falls back to the handler's `DefaultSort` — forgiving by design, so a stale client link never 400s. |
| `date_from` / `date_to` | Inclusive window, `listparams` naming. |
| filters | Typed, named for the domain: `location_id`, `status`, `store_id`, `period`. Comma-separated for OR: `status=open,held`. |

### Cursor, not offset

Offset paging is wrong for most of this estate. Ledgers, movements, audit and
journals are append-heavy and read newest-first: a row inserted at the head
while a user is on page 3 shifts every subsequent page by one, so they see a row
twice and never see another. A cursor is anchored to a position in the ordering,
so it does not drift.

`offset` stays supported for stable reference data (masterdata, chart of
accounts) where nothing is inserted mid-read. Both may not be sent at once.

---

## 2. The response

One envelope. No exceptions.

```jsonc
{
  "items": [ /* … */ ],
  "page": {
    "count": 50,                 // rows in THIS response — always present
    "total": 4312,               // rows matching the filter, or null
    "next_cursor": "eyJ…",       // null when the list is exhausted
    "has_more": true
  }
}
```

### The rules that make it unambiguous

1. **`items` is always the key.** Not `data`, not `rows`, not `locations`. A
   caller that has to know the resource's name to find its array cannot be
   written once.

2. **`count` is this page. `total` is the whole result.** They are never
   interchangeable and `total` is never set to `len(items)`.

3. **A total may also arrive as `X-Total-Count`.** `listparams.ApplyInMemory`
   returns a bare array and puts the count in that header — so a client that
   only reads the body sees "here is everything" and is wrong in exactly the way
   §0 describes. A header total is unambiguous by construction and outranks a
   body `total`.

4. **`next_cursor === null` is the only end-of-list signal.** Not `total`, not
   `has_more`, not an empty `items`. This one rule retires the entire class of
   bug in §0: a client never infers exhaustion from a count whose meaning it
   cannot verify.

5. **`total` may be `null`.** Counting a filtered set is sometimes expensive.
   `null` means "not counted", which is honest; a wrong number is not. A UI
   showing `null` says "50 shown" rather than "50 of 50".

6. **`has_more` is derived, not authoritative.** It exists so a UI can render a
   footer without inspecting the cursor. Paging logic reads `next_cursor`.

---

## 3. The frontend side

### One query shape

```ts
interface ListQuery {
  q?: string
  sort?: { field: string; order: "asc" | "desc" }   // → sort_by / sort_dir
  filters?: Record<string, string | string[]>       // → comma-joined for OR
  dateFrom?: string                                 // → date_from
  dateTo?: string                                   // → date_to
  limit?: number
}
```

`ListQuery` is built from URL search params — the URL stays the source of truth
(rule S1) — and goes into the query key whole, so a filter change is a different
list rather than a continuation of the old one (rule Q3).

### One hook

`useInfiniteRows` consumes the envelope directly and hands `VirtualRows` the
three controls it needs. A screen writes no page bookkeeping.

### Compatibility while Go migrates

The client reads the standard envelope and falls back to today's shapes, so the
two sides can move independently:

| Standard | Fallback read |
|---|---|
| `items` | the first array-valued key in the object |
| `page.count` | `count`, else `items.length` |
| `page.total` | `X-Total-Count` when captured, else `total` **only when it is not equal to `items.length`** — an equal value is ambiguous and is treated as unknown |
| `page.next_cursor` | `next_cursor`, else derived from `offset + count < total` when `total` is trustworthy, else `null` |

That third row is the important one. Where the old response cannot distinguish
"this is everything" from "this is one page", the adapter reports **unknown**
rather than guessing — so the UI says "50 shown" instead of claiming a total it
cannot support. Wrong-but-confident is the failure mode we are removing; this
keeps it removed during the migration rather than after it.

---

## 4. Migration

Neither side blocks the other.

### Go

| Wave | Work |
|---|---|
| 1 | Add the `page` object beside the existing fields. Nothing breaks — old keys stay. |
| 2 | Rename bespoke array keys to `items` for the 29 endpoints that differ. |
| 3 | Adopt `listparams` / `listquery` on the remaining list handlers — the library exists and four packages already use it. This is what unblocks 18 of 34 frontend tables, and it is adoption rather than new work. |
| 4 | Declare `TextSearch` columns in each `listquery.Schema` so `q` works beyond the current four handlers, or point those lists at `search_index`. |
| 5 | Remove the legacy keys once no client reads them. |

### Frontend

| Wave | Work |
|---|---|
| 1 | `readPage` returns the normalized envelope with the §3 fallbacks. **Done once, benefits every adapter.** |
| 2 | Long lists move to `useInfiniteRows` + `VirtualRows`. |
| 3 | Filters move from post-fetch `.filter()` into `ListQuery`. |
| 3b | Settle `min_`/`max_` vs `_gte`/`_lte` with the Go side; today the client passes both through `filters`. |
| 4 | Sorted lists become infinite, once Go wave 3 lands. |

---

## 5. What this contract deliberately does not do

- It does not make every list infinite. A list that fits on one screen stays as
  it is.
- It does not replace the global search service. `/search/global` answers "where
  is this thing" across record types; `q` on a list narrows that one list.
- It does not allow client-side filtering of a paged list. That is the bug in
  §0 wearing a different hat.
- It does not let `total` be optional in *meaning*. It may be `null`. It may not
  be a different number than it claims to be.
