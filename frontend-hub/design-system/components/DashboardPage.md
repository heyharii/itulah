# DashboardPage

The template for reading the state of things: the head, the figures, what needs attention, then charts and short tables, each of them a door to the screen that does the work.

## Copy this screen

- Executive › Overview, route `/executive`, file `frontend-hub/src/screens/executive/overview.tsx`.
- The Needs attention list is Finance › Overview's: route `/finance/dashboard`, files `screens/finance/dashboard.tsx` and `needs-attention.tsx`.
- Close cousins: Sales › Shop Floor (`screens/sales/overview.tsx`) and People › Overview.

## When to use it

| The screen is for | Use |
| --- | --- |
| Reading the state of things and finding what to do first | DashboardPage |
| Reading a period's figures and a statement | ReportPage |
| Finding and opening many records | ListPage |

## Slots, top to bottom

| Slot | Component | Drawn as | Space after |
| --- | --- | --- | --- |
| Head | `PageHeader` | The screen's name: "Overview". A dashboard has no primary; if it has one, it stands at the right. | 24px (`head-gap`) |
| Scope bar | A period `Segmented` and a store choice, 36px | Only when the page is read over a period or a place (Executive). It stands first, as a report's scope does, with what it is measured against at the right. Finance › Overview has none. | 24px |
| Figures | `KpiStrip` | Net sales · Transactions · Gross profit · Cash & bank. A third line (`delta`) says the movement: "+5,4% vs previous period", 15px at 600, signed, `ok-fg` up, `bad-fg` down. A balance says a fact instead: "As of 17 Oct 2026". | 32px |
| Needs attention | `SubHead` over a framed list | See below. | 32px |
| Cards | Two across | See below. Finance puts the upcoming and overdue payment lists before the supporting charts, so the day's work is visible first. | |

### Needs attention

- A section title at `section` (15/20, 600), 12px over the list.
- A framed list, 1px `hairline` with `r-card`: rows of at least 48px, 16px at the sides, a `row-line` between rows, `soft` under the pointer.
- Each row is a link: the label in `ink`, the count at 600 and tabular, a › in `line-ico`. It opens the door and tab where the work is done.
- The count is `ink` while it only waits, `warn-fg` when it is late and `bad-fg` when it stops work.
- A count of zero draws no row, and nothing waiting draws no list.

### Cards

- Two across, equal, 24px apart (`section-gap`): no page-wide chart, no card smaller than its neighbour (owner, 1 Oct 2026).
- A card is 1px `hairline` with `r-card` and no shadow. Its head is padded 16 18 12: the title at 16px, 600 on the left, the link to the screen on the right (15px, 500, `accent`, a 12px arrow).
- A chart is the kit's own (`Chart`): the legend over the plot with 5px dots, axis words in `mute`, the exact figures in the tooltip. The line in `accent`, the period before as a dashed ghost.
- A short table is a `DataTable` in the card: the card is its frame and the heading row stands under the card's head. Columns drop by `meta.priority` as the card narrows (here: Store · Net sales · Change). Each row opens the record it names. A change is signed with a true minus, `ok-fg` up and `bad-fg` down.
- Every chart and every row links on. Nothing on a dashboard is a dead end.

- Finance › Overview uses `KpiStrip` on every device, compact money with exact amounts on the links, and links each figure to its supporting page. Chart headings open their reports; a payment opens its bill or journal entry, while a giro opens the board. Bank lines awaiting a match use a neutral count; overdue bills and blocked posting accounts retain their warning colours.

## On a phone

- The head is not drawn when it repeats the top bar. The scope is the dock's two chips (period, store).
- The figures are two columns with no rules. Needs attention is the same list at full width.
- The cards stack in one column. A chart card keeps its frame. A card that holds a short table stands on the page with no frame, and its rows become `PhoneCards`: the name, the one figure at the right, the change in the foot.

## Rules

Do:
- Keep the order: head, scope bar when there is one, figures, Needs attention, then the cards.
- Draw the movement with a sign and its words, and a balance with its date.
- Give every card a link to its screen.
- Use the kit's chart colours: `accent`, the ghost, and the `a-*` bands for stores.

Don't:
- Draw a figure as a box, or a progress bar in place of a number.
- Put a chart the width of the page, or two cards of different sizes in one row.
- Tint a count for existing. Colour is for what is late.
- Write a sentence under a chart or a figure to explain it.

## Retired

Follows it: Sales › Shop Floor (head, strip, a queue, two cards of `CardTable`), People › Overview, Executive › Overview and Finance › Overview, each in part.

Drifts:
- Needs attention is written twice: Finance's `NeedsAttention` (a label, a count, a ›) and `ExceptionQueue` on five overviews (`sales/overview.tsx`, `people/overview.tsx`, `system/health.tsx`, `system/nodes.tsx`, `workplace/library.tsx`), with an icon tile washed `bad-bg` or `warn-bg`, a title, a detail line and an amount. Keep one list, the first.
- Executive draws its movement with ↗ and ↘ (`executive/parts.tsx`), its legend under the chart instead of over it, and progress `Bar`s in `executive/finance.tsx:230` and `295`. Its cards are 12px apart, 2fr and 1fr, and it has no Needs attention. The page is called `ReportPage` in the code.
- `Kpi tone="up"` paints the movement `ok`, 2.6:1 on white. A word takes `ok-fg`.
- Sales › Shop Floor passes `sub`, which is no longer drawn.

## What you provide

| Slot | You pass |
| --- | --- |
| `PageHeader` | `title` |
| Scope bar | The period and the store in the URL (`?term=`, `?store=`) so a link keeps the question; `Segmented`, a store choice |
| `KpiStrip` | `Kpi` with `label`, `value`, `delta`, `tone` (`up`, `down`, `flat`) |
| Needs attention | A row for each count above zero: `label`, `n`, `to` (an `AppLink`). The tone follows lateness |
| Cards | `Card`, `CardHeader`, `CardTitle` and an `AppLink`; a chart (`LineSeries`, `BarSeries`) or a `CardTable` |
| Short table | `CardTable` with `columns` from `field(id, header, cell, { right, by, card, priority })`, `rows`, a `card` shape for the phone, `onRowClick` |

Source: `frontend-hub/src/screens/executive/overview.tsx`, `parts.tsx`, `card-table.tsx`, `scope.ts`; `screens/finance/dashboard.tsx`, `needs-attention.tsx`; `screens/sales/overview.tsx`; `components/ui/kpi.tsx`, `card.tsx`, `chart.tsx`, `exception-queue.tsx`; the look in `styles/white.css` (KPIs, cards).
