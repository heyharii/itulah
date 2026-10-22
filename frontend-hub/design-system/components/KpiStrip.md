# KpiStrip

A KpiStrip is the one row of figures that opens a page or a sheet: each `Kpi` a label over its figure, hairlines between them, no boxes.

## Anatomy

- Label: 15px on 20px at 400 in `mute`. A short name for what is counted: Orders, Still open, Overdue, On order.
- Figure: `figure` (16px on 22px at 600) in `ink`, tabular, one line, 4px under the label (`fact-gap`).
- Cell: 24px (`figure-pad`) either side of its text, with a 1px `hairline` rule at its left edge. The strip is pulled 25px left and clipped, so the first figure of every line shows no rule and stands on the title's left edge.
- Wrapping: lines are 16px apart. On a phone the figures sit two to a row, 16px by 24px apart, with no rules.
- Under the strip: 32px (`figures-to-tabs`) to the tabs, or to the table when there are none. In a sheet the strip keeps 8px under it and the body's 24px gap does the rest.
- The optional third line (`delta`) is 15px at 600, 6px under the figure, in `mute`; `up` paints it `ok` and `down` paints it `bad`. When one cell has a delta, every cell reserves the line.

## Where it stands

| Place | Order |
| --- | --- |
| A page | Head, then figures, then tabs, then the bar and the table |
| A sheet | Head, then figures, then the main table or lines, Notes, Activity, foot |

The strip is the same size on a page and in a sheet. Never move it below the bar.

## Rules

- A figure that needs somebody turns `bad-fg` (a Delivery Date once it is late). Nothing else on a figure's line is coloured.
- Money in a strip is compact (`Rp 102,7 M`); put the exact amount (`Rp 102.718.000`) in the figure's `title` (the `title` prop). A rounded figure beats a clipped one.
- Dates carry the year (`29 Oct 2026`), quantities say pcs (`24 pcs`), a missing figure is a dash (`—`).
- A `value` that is a string or a number rolls to its next value when it changes; pass a node only for a coloured figure.
- Keep a `delta` to a few words that are facts ("12 voided"), never a sentence.
- Do not box a figure, give it a shadow or set its size: the white look strips the card from `Kpi` and sets the type.

- A written figure rolls to its next value through `FlowText` when a tab, a filter or a live read changes it. It is never swapped, and never animated on first paint (see `RefreshStamp`).

## Retired

- `KpiBox` (one user, `operations/picking/picking.tsx`), `ListHead` (no users) and `KpiRow`, the phone's older row. Use `KpiStrip`.
- Finance's own figures: `NumberCard` and `CardRow` (19px, toned), `ReportSummary` (20px, green profit) and the `.figure-box` copy. Use `KpiStrip` and `Kpi`.
- On a list the figures come before the bar. A report is the one exception: its scope (period and place) comes first, then the figures, then the statement.
- `finance/asset-register.tsx` and `finance-final/transactions.tsx` are lists that still put the bar first.

## What you provide

| Prop | Type | Notes |
| --- | --- | --- |
| `KpiStrip` `className` | `string` | A phone-only hide (`max-md:hidden`) or `mb-2!` inside a sheet. Never a layout of its own |
| `Kpi` `label` | `ReactNode` | A short name |
| `Kpi` `value` | `ReactNode` | A string or a number rolls; a node is drawn as it is |
| `Kpi` `delta` | `ReactNode` | The third line. Optional |
| `Kpi` `tone` | `"up" \| "down" \| "flat"` | The delta's colour. Default `flat` |
| `Kpi` `title` | `string` | The exact figure behind a compact one, on hover |
| `Kpi` `onClick` | `() => void` | A figure that is also its list's filter. The cell becomes a button; its label darkens under the pointer and it presses at 0.97. Contracts' Due for renewal turns the bar's switch on |

Source: `frontend-hub/src/components/ui/kpi.tsx` (`KpiStrip`, `Kpi`; `KpiBox` and `KpiRow` retired); white look in `styles/white.css` (KPIs: one row of figures, hairlines between).
