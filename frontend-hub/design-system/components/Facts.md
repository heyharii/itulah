# Facts

Facts read a record's details as a label over its value in two columns, so a record reads as facts and never as a disabled copy of its form.

## Pick by job

| You are showing | Use |
| --- | --- |
| A record's details, read | `Facts` with a `Fact` for each, under a `SheetSection` title ("Company") or at the top of the body. 101 files use it. |
| The figures that head a sheet or a list | `KpiStrip` and `Kpi`. |
| Lines, payments, tenders | `MiniTable`. |
| What the lines come to | `TotalsLadder`. |
| Free text | A section of its own ("Notes"), not a fact. |
| The same fields, to change | The form that Edit swaps in over the facts. Read mode is never a disabled form. |

## Anatomy

| Part | Drawn as |
| --- | --- |
| Grid | Two columns on a desk and on a phone, 32px between the columns and 16px between the rows (`facts-gap-x`, `facts-gap-y`). |
| Label | 15/18 in `body`, sentence case, the full word ("Phone number"). Never `faint`: a label that reads as switched off names nothing. |
| Value | 15/22 in `ink`, tabular, 4px under its label (`fact-gap`). It wraps and is never cut to an ellipsis: an email, an address or a code stays whole (`overflow-wrap: anywhere`). |
| Wide fact | `wide` takes both columns: an address, an email, a value as long as a sentence. |
| Missing | "—" (`EMPTY`) in the value's own colour. Never "n/a", "none" or a blank. |
| Another record | Its name is a `record-link`: a word in `accent` that opens that record as a layer. Everything else in a fact is `ink`. |

## Rules

- At most eight short values per block. A long one is `wide`; free text is a section.
- Spacing is the kit's. A `gap` or a `dd` margin passed in `className` is dropped; `className` is for layout only (a top margin, a column count).
- Say a fact once. The status is the head's, a count is the figures', and a second copy of either is not a fact.
- People by their full name, dates with the year, money through `money()`, quantities with their unit ("24 pcs").
- On a phone the block is the same two columns with 16px sides. A device does not get a different set of facts.
- White.css stands a card that holds only facts on the page as a property list: no frame, no fill.

## Retired

- `KeyValue` (31 files): a term at the left and its value right-aligned at 500, as a summary row. Use `Facts`; a ladder of sums is `TotalsLadder`.
- A raw `<dl>` (28 files) with its own gaps. The 6 Oct audit found five spacings for the same grid; there is one.
- Read mode drawn as disabled inputs, in six sheets: `inventory/flows.tsx`, `master/term-form.tsx` (`CodeFact`), `system/users.tsx:797`, `procurement/composer.tsx:2305`, `finance/cash-documents.tsx:1972`, `inventory/pools.tsx:1386`. Show `Facts`, and let Edit swap to the fields.

## What you provide

| Component | Prop | Notes |
| --- | --- | --- |
| `Facts` | `className` | Layout only. It renders a `dl`. |
| `Fact` | `term` | The label. |
| | `children` | The value. |
| | `wide` | Across both columns. |

Source: `frontend-hub/src/components/ui/sheet.tsx` (`Facts`, `Fact`), and the retired `KeyValue` in `components/ui/rows.tsx`; look in `styles/white.css` (cards that hold only facts).
