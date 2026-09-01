# TanStack coverage: what we use, what we don't, what we should

Status: **proposed**
Date: 2026-08-27
Researched against the current docs for all six libraries, then measured against
the codebase.

The headline: **we use the read path well and almost nothing else.** Router and
Query are at 14/14 on loaders and zero on writes. Virtual is at **2 of ~18
options**. Table is at **3 of 18 features**. Two holes below are things this
project opened and left open.

---

## The scoreboard

| Library | Status | Used | Verdict |
|---|---|---|---|
| **Router** | 1.170 | loaders 14/14, pending 14, error 14, preload:intent | read path done, guard path empty |
| **Query** | 5.102 | queryOptions 15, `queryClient.query` 15, keepPreviousData 5 | read path done, **write path empty** |
| **Table** | v9.1 | 3 of 18 features | large unused surface, some of it hand-rolled instead |
| **Form** | 1.33 | basics, landing now | **field arrays unused — and they are the answer to `po-draft`** |
| **Virtual** | 3.14 | **2 of ~18 options** | **a 1,551-card grid is still unvirtualized** |
| **Charts** | **alpha, v0** | — | **reject.** Keep recharts. |
| **Start** | **RC** | — | reject, see `docs/tanstack-gap-plan.md` §3 |

---

## 1. Charts — reject

*"A typed, tree-shakable chart grammar for SVG and Canvas"*, grammar-of-graphics
in the Observable Plot lineage. Genuinely interesting, and **alpha at v0**.

`recharts` 3.8 is stable and used on a handful of finance and accounting
screens. Swapping a stable dependency for an alpha one, on the screens that draw
money, is the trade this estate least wants. Revisit at 1.0.

---

## 2. Virtual — the biggest measured gap

`VirtualRows` passes `estimateSize` and `overscan`. That is two options. The
ones we should be using:

### `lanes` — and the hole this project left open

The commercial catalogue has two layouts. The **table** view was virtualized —
1,551 rows down to 25 in the DOM. The **grid** view was not, and still renders
**1,551 cards at once**. Same screen, same data, one toggle apart.

`lanes` exists for exactly this: it divides the list into columns and assigns
each item to the shortest lane — a masonry/grid virtualizer. `laneAssignmentMode`
trades `'estimate'` (fast) against `'measured'` (optimal after measuring).

This is the single largest remaining render cost in the app, and it is one I
introduced by fixing half a screen.

### `getDistanceFromEnd` / `isAtEnd` — replaces code I hand-rolled

`VirtualRows` decides when to fetch the next page with:

```ts
if (lastIndex >= rows.length - loadMoreThreshold) infinite.fetchNextPage()
```

The virtualizer answers this itself. Hand-rolled arithmetic against a threshold
is exactly the kind of thing that is subtly wrong at the boundaries.

### `rangeExtractor` — sticky section headings

> receives visible range indexes and should return array of indexes to render —
> enables rendering non-contiguous items, sticky headers, footers, or custom
> overlays regardless of visibility.

The audit feed and the chart of accounts are sectioned lists: a day heading, its
rows, the next heading. Right now a heading scrolls away with its section.
`rangeExtractor` is how the current section's heading stays pinned.

### `scrollMargin` — a correctness risk we have not checked

> specifies where scroll offset originates — useful for headers preceding lists.

Every `VirtualRows` renders a sticky header **inside** the scroll container,
before the rows. If the virtualizer is measuring from the container top rather
than from the first row, every offset is off by the header's height. It looks
right today; that is not the same as being right. **Verify before assuming.**

### Also unused

`getItemKey` (memoized keys — we key the React element, the virtualizer does not
know), `takeSnapshot` (restore scroll position across navigation — the router
restores scroll, but not inside a virtualizer), `gap`, `paddingStart/End`,
`scrollToIndex` (jump to a searched row), `horizontal`.

---

## 3. Form — field arrays are the answer to `po-draft`

`po-draft.tsx` has been **excluded from every conversion pass** — tables, forms,
all of them — because it holds an editable line-items grid the user types into,
and virtualizing or re-rendering it would drop keystrokes and focus.

TanStack Form's field arrays are built for that shape:

```tsx
<form.Field name="lines" mode="array">
  {(field) => field.state.value.map((_, i) => (
    <form.Field name={`lines[${i}].quantity`}>…</form.Field>
  ))}
</form.Field>
```

`pushValue`, `removeValue`, `moveValue`, and each row's fields update
independently — which is precisely what a hand-rolled `useState` array of lines
cannot do without re-rendering the whole draft.

**This does not make it safe to virtualize.** It makes it safe to *convert*.
Those are different, and the line-items grid should stay fully rendered.

### Linked fields — cross-field validation we cannot express today

`onChangeListenTo: ['password']` makes one field revalidate when another
changes. The commercial sheets have rules of exactly this shape — a discount
that must not exceed a price, an end date after a start date — and today they
live in a form-level `issues` array precisely because a field could not depend
on another field.

### Also unused

`onDynamic` validators, `onServer` (we read server field errors in
`useSheetForm` but do not feed them through the validator), field groups.

---

## 4. Table — 3 of 18 features, and some of the other 15 are hand-rolled

Used: `sortingFeature`, `filteringFeature`, `globalFilteringFeature`.

### Column faceting — the app hand-rolls this on nearly every screen

Faceting derives *"unique values, ranges, and counts for filtering UIs"*.
`getFacetedUniqueValues` powers a filter dropdown with a count beside each
value; `getFacetedMinMaxValues` powers a range slider.

Every screen in this app computes its own filter chip counts by hand — the
division counts in articles, the tier counts in customers, the module counts in
system permissions, the movement-kind counts in the ledger. That is the same
computation, written a dozen times, none of it sharing the table's row model.

### Column sizing / resizing — already hand-rolled once

`dashboard/records-table.tsx` implements resizable columns by hand; the agent
that converted it called it "the hardest one". Table has this as a feature.

### Unused and worth having

Row Selection (bulk actions — approve several claims, retire several rules),
Column Visibility and Ordering (dense ERP tables where users want their own
columns), Row Pinning (keep a total or a watched row in view), Row Expanding
(articles hand-rolls this today), Grouping and Aggregation.

### Unused and not wanted

Row Pagination — the decision is infinite scroll (yours, stated). Cell Selection
and Cell Spanning have no use here yet.

---

## 5. Query and Router

Covered in detail in `docs/tanstack-gap-plan.md`. In brief:

**Query** — 31 `useApiWrite` call sites, zero `mutations.ts`, zero `onMutate`,
one `setQueryData`. The write path is the gap. `useSuspenseQuery` is
**correctly** unused: Suspense hooks cannot be cancelled, and this estate
threads `AbortSignal` everywhere.

**Router** — `notFoundComponent` 0, `beforeLoad` guards 1, `useBlocker` 0,
`retainSearchParams` 0, `stripSearchParams` 2 of 14. Route masking declined.

---

## 6. The plan

Ordered by cost of leaving it, not by feature count.

| Wave | Work | Why here |
|---|---|---|
| **1** | `lanes` on the commercial grid view | 1,551 cards rendered at once, on a screen whose other half we already fixed. This is our own hole. |
| **1** | Verify `scrollMargin` against the sticky header | A silent measurement error in the component all 29 converted files depend on. |
| **2** | Write path: `mutations.ts` per domain, both optimistic shapes | 31 call sites on the old wrapper. See gap-plan §4 wave 2. |
| **2** | `useBlocker` on the forms landing now | Guards browser unload too, which the hand-rolled dirty flags never did. |
| **3** | `notFoundComponent`, `beforeLoad` capability guards | `permissions` has been fetched and ignored since the first audit. |
| **3** | `getDistanceFromEnd` replaces the hand-rolled infinite trigger | Deletes arithmetic that is subtly wrong at boundaries. |
| **4** | `po-draft` onto field arrays | The one screen every pass has skipped. Convert, do not virtualize. |
| **4** | Column faceting → one shared filter-count primitive | Replaces a dozen hand-written count computations. |
| **5** | `rangeExtractor` sticky section headings | UX polish on sectioned lists. |
| **5** | Linked-field validators | Retires the form-level `issues` arrays that only exist because fields could not depend on each other. |
| — | Charts, Start, route masking, `useSuspenseQuery`, pagination | **Declined**, each for a stated reason. |
| — | Table row selection / column visibility / persistQueryClient | **Not yet justified.** Real features, no measured need. Revisit on request, not on availability. |

---

## 7. The rule this document is really about

Every gap above falls into one of three kinds, and only one of them is a bug:

1. **We hand-rolled what the library already does** — faceted counts, column
   resizing, the infinite-scroll trigger, dirty-form flags. This is the
   expensive kind: the code exists, works, and must now be deleted.
2. **We stopped halfway** — the catalogue's table view virtualized, its grid
   view not. This is the embarrassing kind.
3. **We have not needed it yet** — row selection, column visibility,
   persistence. This is not debt. Adopting a feature because it exists is how a
   dependency list becomes an architecture.
