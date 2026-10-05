# TanStack in the five frontends

`frontend-cloud`, `frontend-hub`, `frontend-store-new`, `frontend-employee` and
`frontend-customer` share a wire contract (`frontend-contract`) and nothing
else. There is deliberately no shared React package: the contract stays
framework-free, and each app keeps its own copy of the patterns below.

That makes this file the only thing keeping the five apps in one shape. It
records what was decided, so a sixth screen in any of them is written the same
way as the first.

## Which library, and when

| Library | Rule |
|---|---|
| **Query** | Every read from the server. No `useEffect` + `fetch` anywhere. |
| **Router** | Every app, even a three-screen one. A device left running all shift gets reloaded; `useState` puts the person back at the start and cannot be linked to. |
| **Table** | Only when a list is sorted, filtered, or has many columns. A short list of one kind of thing stays plain markup. |
| **Virtual** | Only when a list has no ceiling. Never `slice()` a list to cap it — that hides rows and calls it fast. |
| **Form** | Only for values that are typed and then submitted. UI state stays `useState`. |

The last three are limits, not targets. Converting a four-row summary table to
react-table buys nothing and costs a column model somebody has to read.

## Reads

Query keys live beside the client function that fetches them: `lib/finance.ts`
exports `financeKeys`, `lib/sales.ts` exports `salesKeys`. In a small app the
rule collapses to one file — `frontend-store-new/src/lib/queries.ts` is the
whole set, and that is the same rule, not an exception. The first element of
every key is a domain namespace (`["dc", …]`, `["hr", …]`, `["inventory", …]`)
so sign-out can drop a whole app's answers by prefix.

One key per endpoint, in one place. Two modules keying `/auth/me` differently
means fetching it twice and never noticing.

## The session

`lib/session.tsx` in every app exports `useIdentity()`, `useNodeIdentity()`,
`useSignOut()`, plus the `SessionProvider` / `useSession` context that carries
the answer down to screens that may assume it. `App.tsx` only assembles them.
`frontend-employee/src/lib/session.tsx` is the reference copy.

**The session has three states, and they must stay distinguishable:**

- `isPending` — not asked yet. Do **not** show a login box; that makes somebody
  already signed in type their password for nothing.
- `null` — sign in. `ApiError.needsSignIn` resolves to `null` inside the
  `queryFn` rather than throwing: it is an answer, and dressing it as a failure
  puts an error message on the login box about the very thing the box fixes.
- error — the node could not be reached at all. Login box *and* the server's
  message.

`retry: false`: a second attempt with the same cookie cannot answer differently.

Naming the node (`node.identity`) is a courtesy shown under the login box, so
its failure resolves to `null` and is never reported as a sign-in problem.

## Writes

Every write is a `useMutation`. No hand-rolled `pending` / `error` pair — the
removed DC app's `useAction()` kept both and could not invalidate anything, so
sealing a box left the row on screen reading "open" until somebody reloaded.

Each mutation invalidates the keys that actually change, named explicitly.
Invalidate a whole prefix only when the action genuinely touches everything
(submitting an official count, departing a truck) and say so in a comment.

Sign-out is `onSettled`, not `onSuccess` — if the request failed because the
network went away, this browser is still done with the session. It writes
`setQueryData(sessionKey, null)` and then `removeQueries` on the app's domain
prefix. **Never `queryClient.clear()`**: it evicts the `null` just written, so
the login screen immediately refetches `/auth/me`.

## Forms

A field belongs to `useForm` when it is typed and then sent. Everything else —
which tab is open, which sheet is showing, what a request answered, a search box
that filters a list or writes to the URL — stays `useState`.

Per-row edits get a row subcomponent with its own form. A shared
`Record<string, string>` of every row's value is the wrong shape: a line is
submitted and cleared on its own.

`useForm` re-applies `defaultValues` on every render while the form is
untouched, so a computed default must be memoised. `poNumber:
suggestPoNumber()` re-rolled the suggested number on every render until it
became `useMemo(() => suggestPoNumber(), [])`. Write the inline arrow, not the
bare reference: `react-hooks/use-memo` rejects `useMemo(suggestPoNumber, [])`
because it cannot see through the reference to check what the function closes
over.

## Tables (react-table v9)

v9, not v8: the hook is `useTable`, row models and sort/filter functions live on
a feature set built with `tableFeatures()` — see
`frontend-cloud/src/lib/table/features.ts`. Column definitions go in a
`columns.tsx` beside the view that uses them.

Three v9 traps, each already paid for once:

- **The options object must be memoised by the caller.** `useTable` ends in a
  `useMemo` over `[table, options, state]`, so an inline literal returns a new
  table every render — v8's `useReactTable` returned a stable instance. See the
  note in `components/data-table/data-table-infinite.tsx`.
- **Pagination is registered on the shared feature set**, so a table that says
  nothing about pagination silently draws 10 rows. Set `manualPagination` when
  the server pages, or size the page to the data.
- **Render `getRowModel()`, not `getFilteredRowModel()`.** The filtered model is
  not sorted, so clicking a column header updates state and reorders nothing.

A `tfoot` shows the server's totals, not the visible rows': filtering must never
be able to make the books look unbalanced.

## Virtualisation

`useVirtualizer` when the answer has no ceiling — thousands of chat bubbles, a
rack count of EPCs, a 7,528-account chart. Not for lists bounded by what one
warehouse works in a shift.

Virtualise the unit the reader scrolls past. The customer history virtualises
per day group, not per row, so the sticky day heading and its card stay whole.

`scrollMargin` must be measured from the real list node with a callback ref: a
mount-time effect measures the loading skeleton instead.

React Compiler emits `react-hooks/incompatible-library` at every `useVirtualizer`
and skips memoising that component. The warning is accurate and is left
unsuppressed.

## Sheets

A sheet is a thing you look at **without leaving the list that produced it**. A
route is a place you go and work. The test is what a route change would throw
away: if it is a scroll position, a set of filters, or a range somebody spent a
minute narrowing, the thing on top is a sheet.

That rule is not new here — the basket, the inbox and the sales cell were
already sheets, and each says why in its own file. What is new is that **which
sheet is open lives in the URL**.

### Why the URL and not `useState`

A sheet held in component state cannot be linked to, does not survive the
reload a shop's browser gets every morning, and can only be opened by a
descendant of the component holding the state. That last one is the expensive
part: it rules out the rail, the command palette, a floating bar over a table,
and a notification that says "somebody amended a price on PO-1183".

`nuqs` does this in other codebases. We already have the mechanism: TanStack
Router merges the validated search of every matched route, so a key claimed by
the **root** route is legal on all sixty-seven routes below it, and a route
with its own `validateSearch` — sales, discussions, the ledger — adds to it
rather than replacing it.

### The files

| File | What it holds |
|---|---|
| `lib/sheets/params.ts` | The registry. Every sheet key and its parser, once. |
| `lib/sheets/use-sheet.ts` | `useSheet(key)`, and `useSheetParams(keys)` for a sheet that takes more than one. |
| `lib/sheets/<domain>.ts` | The hook a screen calls, in the vocabulary of the domain. |
| `components/sheets/sheet-shell.tsx` | The frame: header, close, ↑/↓ between records. |
| `components/sheets/global-sheets.tsx` | The mount point for sheets that need no screen behind them. |

Opening **pushes**, closing **replaces**. The push is what makes the browser's
Back button close a sheet, which is what a person expects of something that
opened over what they were reading. The replace is what stops the X leaving an
entry Back would reopen — and, the case that decides it, what stops closing a
sheet somebody arrived on by pasted link from walking them out of the app.

### Adding one

1. **A line in the registry.** `order: id` or `basket: flag`. The key is the
   query parameter, so it is also what somebody reads in the address bar —
   `?order=`, not `?purchaseOrderId=`.
2. **A domain hook** in `lib/sheets/<domain>.ts`, naming the thing rather than
   the mechanism: `useOrderSheet()` returns `purchaseOrderId`, not `value`. It
   is a thin wrapper today and a seam tomorrow — when a domain has two sheets
   and opening one has to close the other, that rule is about the domain and
   belongs there.
3. **The component**, on `SheetShell`.
4. **One line at the mount point** — the screen that owns the list, or
   `global-sheets.tsx`. See below.

A sheet identified by more than one key uses `useSheetParams`, which writes all
of them in one navigation. `useSaleSheet` is the case: a cell in the sales
table is a shop *and* a span, and a sheet that dropped its keys one at a time
would repaint through two states that mean nothing.

### Who fetches

**The sheet fetches what its header needs; the panel takes that as a prop.**
The header wants the order number before the body has anything to draw, so
asking twice for one key to avoid a prop is the worse trade. A panel keeps only
the queries the sheet has no use for — the person panel still owns its
contracts and personal-data fetches, because both are deferred until their tab
is opened and neither ever appears in a header.

Key the panel by the record (`<OrderPanel key={detail.purchase_order_id} …>`).
Moving to the next record with ↑ must not inherit the last one's sort, its
half-typed close-short reason, or — the one that matters — a personal-data tab
opened on a record you were allowed to read.

### Global or screen-mounted

`GlobalSheets` is for sheets that need no screen behind them: the basket and
the inbox, both opened in the middle of doing something else.

Every **record** sheet is mounted by the list it walks — `OrderSheet` by the
orders table, `PersonSheet` by the workforce list — because ↑/↓ have to move
through the rows that list is showing, filtered and sorted as the reader left
them, and nothing outside the screen knows what those are. `ItemSheet` has a
second reason: `GET /supplier-items` has no single-item form, so a sheet that
fetched would be asking the server again for a row three feet away in memory.

Both kinds are opened the same way and neither one knows which it is.

### Routes that became sheets

`/orders/$purchaseOrderId`, `/allotments/$allotmentId`, `/people/$employeeId`
and `/commercial/books/$publicationId` are now `beforeLoad` redirects into the
list plus the parameter. **Kept rather than deleted**: those addresses are out
in the world — in bookmarks, in conversations, in messages a warehouse sent
about a delivery — and a link that worked last week should not answer with a
blank page. The redirect resolves before anything renders, so a follower lands
on the list with the record already open, which is where the old route took
them.

Turning one into a sheet is three edits and a rename: the screen component
loses its `AppShell`, its `ScreenHeader` and its back link and becomes
`XPanel`; the sheet around it does the fetch; the route becomes the redirect.

### What stays a panel

Not every drill-down wants to be a sheet, and two in Finance are worth naming
because they look like candidates and are not.

**The chart of accounts** keeps its two-column layout. The account panel is
meant to be read *beside* the tree — an accountant matching a balance is
looking at the account and its neighbours at once — and a sheet would cover the
thing being compared against. Its real fault is that the panel is `xl:` and up
only, which is a missing column on a laptop rather than a missing sheet.

**Bank reconciliation** defaults to the first statement and always has one
selected. That is a selector, not a sheet: a sheet that opened onto nothing
until somebody clicked would make the screen start empty, and reconciling is
something you arrive at with a statement already in hand.

The rule both fail is the one at the top of this section — a sheet is for
something you look at *without leaving the list that produced it*. When the
list and the detail have to be visible together, the answer is a column.

### `SheetShell`

The frame, so that "how does a sheet behave" is written once: where the title
goes, that Escape and the X both close it, that closing puts focus back on the
row you opened — and that a sheet opened from a list walks that list with ↑ and
↓ instead of closing, scrolling and opening the next one.

That last behaviour is the difference between a panel you check one record in
and a panel you review thirty records in. Pass `rows` as ids in the order the
list is showing them, plus `current` and `onMove`; it works for a react-table, a
virtualised list or a grid of photographs, because none of that is its business.

The arrows yield to whatever has focus. A quantity box steps by one, a select
moves through its options, a menu moves through its items — stealing those to
change record would make the sheet's own controls unusable.

A sheet whose panel brings its own header keeps the raw `ui/sheet` primitive
instead. `BasketPanel` is one: the same panel is the whole of the `/basket`
route, where that header is the screen's.

## Lint

Shadcn generates files that break `react-refresh/only-export-components`. That
is silenced by a `src/components/ui/**` block in `eslint.config.js`, not by a
disable in each generated file — nobody hand-edits those, so the waiver belongs
where it can be read once.

A hand-written file may waive the rule inline, but only with the reason on the
same comment: a column module whose cells are components, a provider and the
hook that reads it, a route file that also exports the router. Splitting those
costs a file whose only purpose is to satisfy a rule about hot reloading. A
bare `/* eslint-disable */` with no reason is not acceptable — if it were worth
waiving, it is worth a sentence saying why.
