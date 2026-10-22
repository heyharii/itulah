# ReportPage

The template for reading a period's figures: the head, then the scope bar, then the figures, then the statement as an indented tree of accounts with a band totals row.

A report's scope comes before its figures. A list is the other way round: its figures count the whole list, so they come first. A report's figures answer the scope (a period, a place), so the reader meets the scope first.

## Copy this screen

- Finance › Reports › Profit and Loss, route `/finance/reports/profit-and-loss`, file `frontend-hub/src/screens/finance-final/reports/profit-and-loss.tsx`.
- Its parts: `screens/finance/report.tsx` (`ReportFilters`, `ReportSummary`, `ReportChart`) and `screens/finance-final/parts.tsx` (`Grid`, `Th`, `Td`, `TotalRow`).
- Use it for the balance sheet, cash flow, sales by division and every statement read over a period.

## Slots, top to bottom

| Slot | Component | Drawn as | Space after |
| --- | --- | --- | --- |
| Head | `PageHeader` | `title` at the left; Export at the right, a ghost with its download glyph. In Finance › Reports the head is the door's: "Reports" with `DoorTabs` on its rule. | 24px (`head-gap`) |
| Scope bar | `Toolbar` | Unit, From, to, To, Periodicity, then the report's switches ("Compare units"). Every control 36px, 8px apart. | 24px |
| Figures | `KpiStrip` | Total income · Total expense · Net profit, from the server's totals, never a sum of the rows. Exact money (`Rp 5.207.450.000`) while it fits. Net profit is `ink`; a loss is `bad-fg`. | 32px (`figures-to-tabs`) |
| Statement | a framed table | See below. | |

A chart card (`ReportChart`) may stand between the figures and the statement.

### The statement

- Framed like a list: 1px `hairline`, `r-card`. The heading row is 40px on `band`, 15px at 500 in `mute`: Account at the left, then one right-aligned column for each period and a Total.
- Rows are at least 52px (`row`) with a `row-line` between them.
- The tree: the class row first, on `band` at 600, carrying its subtotal. Groups under it at 500, accounts at 400. Each level indents 18px. The account code reads before the name in `mute`, in the same face, never mono.
- A computed row ("Gross profit") is 500, with a `hairline-strong` rule above it.
- The totals row ("Profit for the period") is a `tfoot`: 44px, 500, on `band`, a hairline above.
- Money is right-aligned and tabular, "Rp 2.612.400.000". A negative has a true minus and is `bad-fg`: "−Rp 118.250.000". No hyphen, no brackets.
- Columns: one per period (Periodicity: Monthly, Quarterly, Half-yearly, Yearly) and a Total, or one per unit and "All units" when Compare units is on. More than 24 columns shows the window as one.
- Each account opens its ledger as a layer, and each ledger line its journal. A › shows on hover. The last column keeps 36px on every row, so no figure moves.
- Nothing posted in the window says so in one sentence in place of the table.

## On a phone

- The scope is the dock's: the Toolbar becomes one "Filters" chip and a bottom sheet, which also holds Export. An Executive page has a period chip and a store chip.
- The figures are two columns with no rules.
- The statement is one column of figures, the last, under each account's name; a tap opens the others in a sheet (`PhoneStatement`). The page never scrolls sideways.

## Rules

Do:
- Put the scope bar first, then the figures, then the statement.
- Read the figures from the server's own totals, so they agree with the statement.
- Keep a statement's labels in the client's own words, as the chart of accounts has them.
- Say a loss with `bad-fg` and a true minus, a missing figure as "—".

Don't:
- Put the figures before the scope: a list does that, a report does not.
- Draw the figures as boxes, or Net profit in green: `ok` is 2.6:1 and never a word.
- Use `Grid` for a list: a list is a `DataTable`.

## Retired

Follows it in order: 12 screens draw `ReportFilters`, then `ReportSummary`, then the statement. Five are in `finance-final/reports` (P&L, P&L by unit, Balance sheet, Balance sheet 2 years, Cash flow) and seven in `screens/finance` (Changes in equity, Expenses by month, Sales by division, Supplier ledger, Withholding report, Asset disposals, Bank reconciliation summary). All twelve still draw the figures with `ReportSummary` and the statement with `Grid`.

Drifts on the reference page:
- Export is drawn quiet (no border). Every supporting action is a ghost.
- The scope bar mixes heights: the unit select is 36px, the two date boxes and Periodicity are 32px (`h-8`). Its switches say "Accumulated Values" in Title Case, and a note at the far end repeats the dates and the unit.
- `ReportSummary` is a `figure-box` of 20px figures, "Total Income" and "Net Profit" in Title Case, Net Profit in green `text-ok`. Use `KpiStrip`.
- The statement is a `Grid`: a 48px heading, 60px rows, a 56px `TotalRow`, codes in `font-mono`, and no row opens its ledger. Use the heading, row and totals sizes of `DataTable`.

Drifts elsewhere:
- About 30 Finance reports use `NumberCard`/`CardRow` (19px, toned) or `ReportSummary` for the figures. Use `KpiStrip` and `Kpi`.
- Lists that put their bar first like a report: `finance/asset-register.tsx`, `finance-final/transactions.tsx`. They are ListPages.
- `Grid` stays for statements (P&L, balance sheet, trial balance, cash flow, ledger, equity); a list in Finance is a `DataTable`.

## What you provide

| Slot | You pass |
| --- | --- |
| `PageHeader` | `title`, `actions` (a ghost `ExportButton variant="ghost"`). A door's tab takes the door's title |
| `ReportFilters` | The controls, in order: `UnitSelect`, the dates, `PeriodicitySelect`, `FilterCheck`. No `note`: the controls already say it |
| `KpiStrip` | Three `Kpi` with `label` and `value` (a node only for the loss) |
| Statement | Column `Th`s (`align="right"`), a row for each level (`level` sets the indent), `TotalRow`; the amounts through `money()` |
| Phone | `PhoneStatement` with `lines` (`kind`, `code`, `name`, `level`, `figure`, `tone`, `facts`) |

Source: `frontend-hub/src/screens/finance-final/reports/profit-and-loss.tsx`, `finance-final/parts.tsx`, `finance/report.tsx`, `finance/parts.tsx`, `finance/phone-parts.tsx`, `finance/chart.ts`; `components/ui/export-button.tsx`; the look in `styles/white.css` (tables, KPIs).
