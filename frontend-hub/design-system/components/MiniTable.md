# MiniTable

MiniTable draws a small table inside a sheet, under its section's heading: the lines of a document, its payments, its tenders. On a phone it stacks into blocks instead of scrolling.

## Pick by job

| In a sheet you are showing | Use |
| --- | --- |
| The lines of the record (items, payments, tenders) | `SheetSection` holding a `MiniTable` |
| What the lines come to | `TotalsLadder`, under the table |
| The details of the record | `Facts` |
| The page's list | `DataTable`, never `MiniTable` |
| A pivot or matrix read across | Its own grid, in a `table` sheet |

## Anatomy

| Part | Drawn as |
| --- | --- |
| `SheetSection` | A `SubHead` over its content, 12px apart. It sets no rule, card or margin: the sheet body puts 24px between sections. |
| `SubHead` | The heading at 15px 600 in `ink`. `aside` stands at the right end of the line in `mute`, tabular: a count ("2"), or "of Rp 8.400.000". |
| Heading row | 15px 500 words in `mute` on `band`, a hairline under them, 10px below the words. The first column reads left, the rest right; a heading can say `align`. |
| `MiniRow` | A `hairline` above each row. |
| `MiniCell` | 15px in `ink`, 12px above and below. A right cell is tabular with 12px before it. |
| Name cell | The line's name in `ink`; its code on a second line in `mute`, in the same face. |
| Totals row | A `MiniCell` with `colSpan` for its label, so no figure shifts a column. |
| `TotalsLadder` | A hairline above, then rows with the label at the left and the value at the right in `body`; only the last row is 600 in `ink`. No box. Money with a true minus ("−Rp 4.000.000"). |

## On a phone

Under 48rem every row is a block and nothing scrolls sideways.

- The heading row is hidden. The first cell stands across the top at 500 in `ink`.
- Every other cell sits in two columns, 16px apart, under its column's name in `mute`, copied from the head.
- A cell that spans columns spans the block.
- `stack={false}` is for a table of two or three short columns that still reads at 375px.
- A table drawn with raw `<tr>` and `<td>` does not stack. Draw record tables with `MiniTable`, `MiniRow` and `MiniCell` only.

## Rules

- Lines in a sheet are a `MiniTable` under a `SubHead`. No `Card` inside a sheet: the sheet is the card.
- A record's sections run lines, totals, Notes, Activity.
- A count goes in `aside`, never in the heading's words.
- Numbers go right and tabular, one figure per cell. Say the figure: "36 pcs", "Rp 3.060.000".
- The heading is sentence case and full words ("Quantity", never "Qty").
- A row of a MiniTable that opens a record is a `record-link` in its name cell.

## Retired

- `MiniTable` as a page's list: about 14 People pages. Use `DataTable`.
- A table drawn by hand in a sheet with raw `<tr>` and `<td>`: Finance's grids print one row over another on a phone.
- Uppercase mono micro-caps in the heading row, the older grammar of this component.
- A `Card` round a table inside a sheet.

## What you provide

| Component | Prop | Notes |
| --- | --- | --- |
| `MiniTable` | `head` | `string` or `{ label, align? }` for each column. |
| | `children` | `MiniRow`s. |
| | `stack` | Default `true`. |
| | `style`, `className` | For a minimum width a caller computes. |
| `MiniRow` | `children` | `MiniCell`s. |
| `MiniCell` | `align` | `"left"` (default) or `"right"`. |
| | `colSpan` | Reaches the `td`. |
| `SubHead` | `children`, `aside` | The heading and its count. |
| `SheetSection` | `title`, `aside`, `children` | A `SubHead` over its content. |
| `TotalsLadder` | `rows`, `total` | `rows` are `{ label, value }`; `total` is the one 600 line. |

Source: `frontend-hub/src/components/ui/rows.tsx` (`MiniTable`, `MiniRow`, `MiniCell`, `SubHead`, `SheetSection`, `TotalsLadder`); the stack in `styles/index.css` (`.mini-stack`); the heading row in `styles/white.css` (Tables).
