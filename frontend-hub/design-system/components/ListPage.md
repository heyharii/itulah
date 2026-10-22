# ListPage

The template for a screen that finds, filters and opens many records of one kind: the head, one row of figures, tabs, one bar and a framed table, in that order, copied from Procurement › Purchase Orders.

## Copy this screen

- Route `/procurement/orders`, file `frontend-hub/src/screens/procurement/purchase-orders.tsx`.
- Start from it for orders, suppliers, bills, employees and stock: keep the slots, change the words and the columns.
- The same list on a phone is the ListPhone card.

## When to use it

| The screen is for | Use |
| --- | --- |
| Finding, filtering, sorting and opening many records | ListPage |
| Reading a period's figures and a statement | ReportPage (its scope comes first) |
| Reading the state of things | DashboardPage |
| Making or changing one record | FormSheet |
| Work moving through stages | The board (Operations › Allotment) |

## Slots, top to bottom

A slot may be empty. It is never moved or restyled.

| Slot | Component | Drawn as | Space after |
| --- | --- | --- | --- |
| Head | `PageHeader` | `title` (17/24, 600) at the left, the page's one primary at the right: 36px, with its plus ("New order"). 24px above the title, 28px at the sides, 16px under it and a `hairline` under that. It sticks while the page scrolls. | 24px (`head-gap`) |
| Figures | `KpiStrip` | Orders · Still open · Overdue · On order. Label over `figure`, a `hairline` between, 24px each side. Money is compact ("Rp 102,7 M"), the exact amount in the `title`. Overdue turns `bad-fg` above 0. | 32px (`figures-to-tabs`) |
| Tabs | `SubTabs` | Active PO 18 · Completed PO 14 · Cancelled PO 13. Each tab is a dataset. The count follows the word, 6px away, in `mute`. | 16px (`tabs-to-bar`) |
| Bar | `Toolbar` | Search (280 × 36), Created at, Delivery date, the "Group by supplier" switch, the space, then Columns. Every control is 36px, 8px apart. | 12px (`bar-to-table`) |
| Table | `DataTable` in a `Card` with `overflow-clip` | Framed: 1px `hairline`, `r-card`. | |

- The page's own title is the screen's name. No subtitle, no crumb: `sub` and `crumb` are not drawn.
- No Filter button (owner, 14 Oct 2026). `ListFilters` draws every other question in the bar and one line of icon radio chips under it (owner, 20 Oct 2026: every list filters the way this one does).
- A status choice that switches the dataset is a tab. A choice that narrows one dataset is a `ListFilters` question: search, a date box, a switch or the one radio chip line.

### The table

- Columns: PO · Delivery date · Ordered · Received · Status. Date created and Invoicing wait behind Columns. Each tab names its own date: Delivery date, Received date, Cancelled date.
- The first cell is the supplier at 500 with one quiet line under it (PO number · item count). It is the only 500 in the row.
- Ordered and Received are right-aligned and tabular: the pieces over what they are worth, in `mute`.
- Received stays `ink` while an order is still coming in. Only a real problem takes colour: a late delivery date in `bad-fg`, or a remainder that is overdue. The hub's red "short" figure is retired (calm tables, 13 Oct 2026).
- A late delivery date is `bad-fg`. The Overdue figure counts them.
- Status is `Status`, from `statusWord()` and `statusTone()`: a dot in the tone and an `ink` word. Partially received is `warn-fg`.
- A row is one target. It opens the order as a layer (`?order=`), a › shows at its end on hover and nothing in it is blue.
- The page scrolls, not the table: `pageScroll`, the heading sticks under the head and the next page comes in as the foot nears (`more`). `refresh` keeps it live.
- The totals row is at least 44px on `band`, a hairline above it: "5 orders of 18" and the sums of what is loaded.
- Empty says which nothing it is: "No order matches these filters." and "Nothing here yet."

## On a phone

See ListPhone. The figures become one sentence, the tabs the dock's status chip, the bar the dock's search capsule and filter, the head's New order the Fab, and the table cards. Nothing sits at the top but the title and the sentence.

## Rules

Do:
- Keep the order: head, figures, tabs, bar, table.
- Draw tabs only for two or more datasets. A list with one tab draws none.
- Put the one primary at the right of the head, with its plus.
- Build the bar with `Toolbar` and `ExpandingSearch`, the table with `DataTable`, and warm the sheet with `onRowIntent`.
- Say "New order" in the head. The record is made in a sheet (FormSheet).

Don't:
- Put the bar above the figures. That order is a report's.
- Scroll the table in a box of its own, or cut it with `slice()`.
- Draw a state as a coloured word with no dot, or as a stamp, in a cell.
- Put the page's primary in the bar, or a status in a row of chips.

## Retired

Follows it: Suppliers (`procurement/suppliers.tsx`) in the order of its slots, and Finance › Deposits and Prepaid schedules (`finance-final/deposits.tsx`, `prepaid-schedules.tsx`) with `Toolbar` and `pageScroll`.

Drifts, on the reference page itself:
- Its bar is hand-written (`purchase-orders.tsx:1454`, a `group/bar` div with `SearchSuggest`, a `FilterRow` and a `SwitchPill`) instead of `Toolbar` and `ExpandingSearch`.
- Status is a coloured word with no dot (`STATUS_TEXT`), from its own tone map (`PO_STATUS` in `procurement/shared.ts`: Partially received is `info`, Fully received `done`; `statusTone()` says `warn` and `ok`). A finished order wears a hand-made stamp (`STAMP`) in its Status cell. Use `Status`; a finished document wears `DocStamp`.
- Overdue stays `ink` when it is above 0.
- `roomy` on `DataTable` does nothing. The Fab says "New Order".

Drifts elsewhere:
- Hand-written bars (about 50) and `DESK_BAR` (8). Suppliers draws a 34px search and its own switch, and a tab called "Non-active".
- Lists whose bar sits before the figures: `finance/asset-register.tsx`, `finance-final/transactions.tsx`.
- `Segmented` as a status filter in the bar (12 lists), and `DeskFilterChips` rows in Commercial and Sales.
- Hand-made tables, the seven GA `div` grids at `min-w-[61–78rem]`, about 14 People pages that use `MiniTable` as the list, and Payables › Bills in its own scroll box.

## What you provide

| Slot | You pass |
| --- | --- |
| `PageHeader` | `title`, `actions` (one `Button variant="primary"` with `Plus`). Not on a phone |
| `KpiStrip` | Four or five `Kpi`: `label`, `value`. A node only for a coloured figure |
| `SubTabs` | `tabs` (`value`, `label` with the count as its own element), `value`, `onChange`. Keep the tab in the URL |
| `Toolbar` | `className="group/bar"`, then `ExpandingSearch`, `DayRange`, `SwitchPill`, `BarSpacer`, `ColumnsMenu` |
| `DataTable` | `table`, `onRowClick`, `onRowIntent`, `isSelected`, `isFresh`, `more`, `refresh`, `summary`, `empty`, `pageScroll`, `cardLead`, `cardsApart`, `cardSort={false}` |
| Phone | `DockTools` (`search`, `filter`, `sort`, `status`) and `Fab` |

Source: `frontend-hub/src/screens/procurement/purchase-orders.tsx`, `components/ui/page-header.tsx`, `kpi.tsx`, `sub-tabs.tsx`, `list-chrome.tsx`, `data-table.tsx`; the look in `styles/white.css` (the page head, KPIs, tabs, tables).
