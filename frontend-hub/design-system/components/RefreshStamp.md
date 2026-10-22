# RefreshStamp

RefreshStamp keeps a table live: it reads the table's queries again every 10 seconds, quietly, and in the All white look draws nothing on a desk and only a round reload button in the phone's dock.

## The rule

Every table stays live (owner, 11 Oct 2026). Pass the queries behind it to `DataTable`:

```tsx
<DataTable table={table} refresh={[orders, suppliers]} />
```

`DataTable` mounts a `RefreshStrip`, which mounts the stamp. Draw `<RefreshStamp queries={[…]} />` yourself only for a list that is not a `DataTable`. Do not give a table's query a `refetchInterval`: the cadence comes from `refresh`.

## What a person sees

| Where | Visible |
| --- | --- |
| Desk and tablet | Nothing. White.css sets `.refresh-stamp` to `display: none` and hides the strip it stood in (`div:has(> .refresh-stamp:only-child)`), so there is no gap above the table. "A list says nothing about when it last read: it stays live on its own" |
| Phone | The reload, in the dock: a round 44px button (`tap`) on `soft-2` with a 16px arrow in `body`, first in the action slot, 6px before the Fab. The words are not drawn |
| A pressed reload | The press is `scale(0.92)` over `t-press`. The arrow turns, `spin 1s linear`, for as long as that read is on, and finishes the turn it is in rather than snapping back to 0°. Under reduced motion it does not turn: it dims to 50% |

A live read never moves the arrow, and a page of an infinite query arriving is not a reload. The button's name still carries the words: "Reload. Updated 14:05".

## What it does, whatever is drawn

| Rule | Value |
| --- | --- |
| Cadence | The first read 10s after the screen opens, then every 10s (`LIVE_MS`) |
| Looked at | Only while the tab is visible. Back in view, it catches up at once if the rows went stale |
| Online | Not while the device is offline: what is shown is all there is |
| Not twice | A query already being read is skipped, and so is one read in the last 8s (its own `refetchInterval`, a second stamp, a save that invalidated it) |
| Adaptive | The next read waits at least three times as long as the last one took, so a slow list is not hammered |
| Pressed | Reads every query now. A press while a read is on does nothing: it would cancel it and start a second round trip |
| Several queries | Their stamp is the oldest read: a screen is as fresh as its stalest query |

## The words

They are written whether or not they are drawn, and the stamp keeps them current every 30s:

- `Updated 14:05` today, `Updated 08 Oct, 14:05` earlier this year, `Updated 08 Oct 2025, 14:05` before that (the hub's date rule).
- One word may follow, never two: `· offline` when the device has no connection, `· saved` when the rows are the copy restored from this device's last visit and nothing has read them since.

## A figure that changes while you look

`Kpi` draws a written figure through `FlowText`, so a figure that changes with a tab, a filter or a live read rolls to its next value instead of being swapped (owner, 15 Oct 2026). It is the one sign, on a screen with no stamp, that a quiet read changed something.

- It reads the numbers back out of the text ("Rp 42,7 M", "18 / 18 pcs", "20 Oct 2026") and rolls only those, each as it was written: dots for thousands where the text had them, a comma and as many decimals as it had, no grouping where there was none, so a year stays 2026. The words around them stand still. The figures of one strip roll together.
- 300ms on `ease-out` (`cubic-bezier(0.23, 1, 0.32, 1)`), transform and opacity only; the opacity takes 200ms. Reduced motion is NumberFlow's own.
- Only a string or a number rolls. A figure a screen draws as a node is shown as it is.
- `04-motion` says not to animate a live table's quiet refresh. A KPI that a quiet read changes does roll; that one exception is the owner's.

## Retired

- **The visible stamp.** "Updated 14:05" and a reload arrow above every table. White.css hides it rather than removing it: the component stays mounted, so a desk has no reload button at all. A person who wants fresh rows waits for the next read.
- **A table with no `refresh`.** Counted on 17 Oct 2026: 134 of the 160 `<DataTable>` tags pass it, 26 do not, 20 of them in Finance (`finance/bank.tsx`, `finance-final/payable.tsx`, `finance/stores.tsx` …). A hand-made table or a `PhoneCards` list has no stamp and never polls.
- **A cadence of its own.** 27 screen files set a `refetchInterval` (the Ops board and its workload 30s, Receiving 10s, Quantity checks 15s). A table takes its cadence from `refresh`, not from a query option.

## What you provide

| Component | Prop | Type | Notes |
| --- | --- | --- | --- |
| `DataTable` | `refresh` | `Refreshable[]` | The queries behind the rows, as they stand. `[]` or none draws nothing and polls nothing |
| | `refreshOnPhoneOnly` | `boolean` | Draw the strip on a phone only, for a screen whose toolbar already carries a `<RefreshStamp deskOnly>` |
| `RefreshStamp` | `queries` | `Refreshable[]` | |
| | `className` | `string` | Layout only |
| | `deskOnly` | `boolean` | Draw nothing on a phone: for a bar that is mounted there but never shown, so the dock does not get a second reload |
| `RefreshStrip` | `queries`, `className` | | The stamp as a line of its own over a table: at the right on a desk, the words at the left on a phone |

A `Refreshable` is the part of a TanStack query result the stamp reads: `dataUpdatedAt`, `isFetching`, `isFetchingNextPage?`, `data?` and `refetch`. A `useQuery` and a `useInfiniteQuery` result both fit. `useLive` is internal and not exported.

Source: `frontend-hub/src/components/ui/refresh-stamp.tsx`, `flow-text.tsx` (with `kpi.tsx`), `data-table.tsx` (`refresh`), the dock's action slot in `shell/bottom-bar.tsx`; white look in `styles/white.css` ("a list says nothing about when it last read").
