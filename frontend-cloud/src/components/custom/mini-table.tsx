import { cn } from "@/lib/utils"

/// The line items inside a record card — and the *only* place the mono
/// micro-cap header belongs.
///
/// The system has two table grammars and confusing them is the loudest defect
/// available. A full-width list is a screen: sentence-case `{body}` headers,
/// generous cells, a row is a record you can open. A mini-table is a
/// paragraph inside a card: its header is a mono micro-cap legend that has to
/// disappear into the card, so it is `{faint}` at 10px and carries no header
/// band at all. Give the mini-table a filled header and the card grows a
/// second surface; give the list a mono header and every screen in the app
/// starts looking like a database console.
///
/// Column one is the thing; every other column is a number about it. That is
/// why alignment is positional rather than declared — a mini-table with a
/// left-aligned quantity has been built wrong, not configured differently.
export type MiniTableRow = {
  id: string
  cells: readonly React.ReactNode[]
  onClick?: () => void
}

export function MiniTable({
  columns,
  rows,
  emphasiseFirstColumn = true,
  className,
}: {
  columns: readonly React.ReactNode[]
  rows: readonly MiniTableRow[]
  /// The item name carries the row, so it is `{ink}`/500 while the figures
  /// beside it stay `{text}`. Turn it off for a table whose first column is
  /// itself a fact rather than a name.
  emphasiseFirstColumn?: boolean
  className?: string
}) {
  return (
    <table
      className={cn(
        "mt-1 w-full border-collapse text-[0.75rem] tabular-nums",
        // The card's own edge closes the table; a hairline under the last row
        // would draw a second one a few pixels above it.
        "[&_tbody_tr:last-child_td]:border-b-0",
        className,
      )}
    >
      <thead>
        <tr>
          {columns.map((column, index) => (
            <th
              key={index}
              scope="col"
              className={cn(
                "border-b border-[var(--os-hairline,#ececef)] p-[0.375rem]",
                "font-mono text-[0.625rem] font-medium tracking-[0.03em] uppercase",
                "whitespace-nowrap text-[var(--os-faint,#d3d3d8)]",
                index === 0 ? "text-left" : "text-right",
              )}
            >
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            onClick={row.onClick}
            className={cn(row.onClick && "cursor-pointer")}
          >
            {row.cells.map((cell, index) => (
              <td
                key={index}
                className={cn(
                  "border-b border-[var(--os-hairline,#ececef)] px-[0.375rem] py-[0.4375rem]",
                  "text-[var(--os-text,#46464d)]",
                  index === 0
                    ? cn(
                        "text-left",
                        emphasiseFirstColumn &&
                          "font-medium text-[var(--os-ink,#1d1d1f)]",
                      )
                    : "text-right",
                )}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
