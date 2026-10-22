# DataTable

DataTable draws every list of records: a framed table that scrolls with the page on a desk, the same rows as cards on a phone, and one row is one target that opens the record.

## When to use it

Use it for any list people scan, sort and open: orders, suppliers, employees, stock, bills. Columns are declared once, with their own `meta`, and the screen gets the desk table, the narrow table and the phone cards from them.

Keep these as they are, they are not lists: pivots and matrices, calendars, print papers, and the item tables inside a sheet (`MiniTable`, the items box).

## Anatomy

| Part | Drawn as |
| --- | --- |
| Frame | A `Card`: 1px `hairline`, `r-card` (10px), no shadow. It clips with `overflow-clip`, never `overflow-hidden`, so the heading can stick. |
| Heading row | 40px (`table-head`), on `band`, 15px 500 in `mute`, 16px a side, a 1px `hairline` under it on the cell itself. A grouped heading ("Ordered") is a second row under the first. |
| Cell | 15px in `ink`, padding 12 16 (`cell-y`, `cell-x`), a `row-line` between rows, at least 52px tall (`row`). |
| First cell | The row's name at 500; the line under it ("PO-161026-010 · 1 item") at 400 in `body` or `mute`. |
| Figures | `meta.align: "right"`, tabular, one figure per cell. A late date is `bad-fg`. |
| Status | The dot and the word (`Status`), in the column that declares `meta.swap`. |
| Totals | `summary`: a row on `band`, 44px, 500 in `ink`, a hairline above, stuck to the window's foot. |
| Foot | `LoadMore`: "Loading more…", or the server's sentence with Try again. |

## The states of a row

| State | Look |
| --- | --- |
| Rest | `canvas`. |
| Hover | `soft` under the pointer, and a › in `mute` at the row's right edge. Nothing in the row turns blue. |
| Selected | `accent-bg` and `aria-current`: the record that is open. Never a left bar. |
| Focus | Rows that open are a tab stop. Enter or Space opens, Up and Down walk the rows, and an inset 2px `accent` ring shows. |
| Fresh | An `accent-bg` wash that holds for a beat and drains over 3.2s: the order raised a moment ago. |
| Verb | `rowAction` swaps the status for the one thing to press while the pointer is on the row. |

`onRowClick` spreads `openable()` on the row, which marks it `data-opens`; white.css shows the › on a `tr[data-opens]` under the pointer, and only where the last cell holds no button or link of its own: that control is the row's action.

## Sorting

- A sortable heading is a button. The sorted column shows a 12px chevron in `ink` beside its word; the others show a `mute` hint on hover only.
- A right-aligned heading puts the arrow in front, so the word ends flush with its figures.
- A heading over two figures (`meta.sortBy`) opens a menu: "Ordered, high to low", "Ordered, low to high"; the chosen line is ticked, and choosing it again clears the sort.
- Sort the list by the decision metric, not the identifier.

## How it scrolls

- Pass `pageScroll`. The page scrolls, not the table: the heading sticks under the page head (`--page-head-h`), the totals stick to the window's foot, every row is drawn and the next page comes in as the foot nears view (`more`).
- Columns hold their `size`; the one with `meta.grow` takes what is left. Loading a page never reflows them.
- Without `pageScroll` the table owns a scroll box and virtualises past 150 rows (`virtualizeAbove`). Lists do not use it.
- `refresh={[query]}` keeps the list live: it reads again every 10s while the screen is looked at. The white look draws no "Updated" stamp; on a phone `refresh` puts a reload button in the dock.

## Columns

| `meta` | Does |
| --- | --- |
| `align` | `"right"` for figures, `"center"` rarely. |
| `card` | The column's role on a phone: `id`, `title`, `status`, `metric`, `meta`, `lead`, `foot`, `hide`. Left out, it is guessed: the first column is the title, a right-aligned one a metric. |
| `priority` | `1` never drops, `3` drops first when the card is too narrow, one column at a time, right-most first, measured on the card and not the window. |
| `grow` | The one column that takes the free width with `pageScroll`; its value is the least width. |
| `swap` | The status cell that hands over to `rowAction`. |
| `sortBy` | The figures a double heading can sort by. |
| `filter` | The question the column can be asked (`FilterPanel`). |

The Columns menu (`ColumnsMenu`, in the Toolbar) keeps what the reader switched; the fit only decides the columns nobody touched.

## On a phone

Under 48rem the rows are cards and nothing scrolls sideways. See `PhoneCards`: `cardLead` draws the card from the `title`, `meta`, `lead`, `foot` and `status` roles; `cardsApart` stands the cards on the page; `cardsOnTablet` and `cardsTwoUp` do the same for a tablet. Sort is the dock's, so pass `cardSort={false}`.

## Rules

- A list is a `DataTable` in a `Card` with `overflow-clip`, with `pageScroll`, `refresh` and `onRowClick`, and `more` when it pages.
- The name leads and is the only 500 in the row; supporting words are quiet by colour, never by size.
- A row that opens opens a layer, through `onRowClick`; warm the sheet with `onRowIntent`.
- Say which nothing it is: "No order matches these filters." and "Nothing here yet." are different sentences.
- Never `slice()` a list to cap it.

## Retired

- Tables written by hand: `operations/stock/stock.tsx:321`, `allotment/returns.tsx:221`, `inventory/missing-list.tsx:127`, `inventory/stock-card.tsx:379`, and about 14 People pages that use `MiniTable` as the page's list.
- Seven GA lists (contracts, supplies, locations, maintenance repairs, schedule and replacements, assets) are `div` grids at `min-w-[61–78rem]`: they scroll sideways at 1440 and get no phone cards.
- `Grid` for a list in Finance. Keep it for statements (P&L, balance sheet, trial balance, cash flow, ledger, equity).
- A list in its own scroll box: Payables › Bills (`max-h-[calc(100dvh-21rem)]`), `people/directory.tsx`.
- The `Card` round a table, copied 143 times and split between `overflow-hidden`, which breaks the sticky heading, and `overflow-clip`.
- `cardSort` left at its default: the phone's list carries its own "Sort by" row at the top.
- `roomy`: the All white look sets the cell padding, so the prop does nothing.
- `meta.mono`: a code reads in the same face as the name, quieter by colour; white.css resets mono on screens.

## What you provide

| Prop | Type | Notes |
| --- | --- | --- |
| `table` | `useTable` instance | Built with `tableSetup`. |
| `onRowClick` | `(row) => void` | Makes every row one target. |
| `onRowIntent` | `(row) => void` | Pointer, focus or touch is on the row: prefetch its sheet. |
| `isSelected`, `isFresh` | `(row) => boolean` | The open record; a row that has just landed. |
| `pageScroll` | `boolean` | The page scrolls. Use it. |
| `cellsTop` | `boolean` | Every cell starts at the row's top, for rows whose cells run to several lines (Articles: a three-line name beside colours that wrap). The › moves up to the first line with them. |
| `more` | infinite query | Next page as the foot nears view. `onEndReached` only says when it is due. |
| `refresh` | `Refreshable[]` | The queries behind the rows; the list reads them every 10s. |
| `summary` | `Record<columnId, ReactNode>` | The totals row. |
| `empty` | `ReactNode` | A sentence that says which nothing it is. |
| `rowAction` | `(row) => ReactNode` | The verb that replaces the status on hover. |
| `renderSub`, `isExpanded` | | A block opened under a row. |
| `renderBefore`, `isHidden` | | A group heading before a row; a row folded away. |
| `cardLead`, `cardsApart`, `cardSort`, `cardsOnTablet`, `cardsTwoUp`, `cardFiguresBelow`, `cardTone`, `stickyBefore` | | How the phone's cards are laid out. |
| `touch`, `rowHeight`, `virtualizeAbove`, `className` | | Row height follows the pointer: 52px with a mouse, 44px under a finger. |

Source: `frontend-hub/src/components/ui/data-table.tsx`, with `lib/react-table.d.ts` (column `meta`), `lib/openable.ts`, `components/ui/phone-cards.tsx`; look in `styles/white.css` (Tables, `table.dt`, `.dt-wide`, the › on `tr[data-opens]`).
