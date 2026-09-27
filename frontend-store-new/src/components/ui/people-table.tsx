import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"

/// One column of a `PeopleTable`, declared once for both of its shapes.
export interface PeopleColumn<T> {
  readonly key: string
  readonly header: React.ReactNode
  /// Figures are right-aligned — the hub's rule, and how a column of numbers
  /// is read down rather than across.
  readonly align?: "left" | "right"
  /// Where this column goes when the row becomes a card on a phone.
  ///
  ///  - `title` — the row's identity, top left.
  ///  - `status` — top right; a pill.
  ///  - `meta` — one line of context under the title, joined with dots.
  ///  - `metric` — a label-over-value pair in a two-column grid.
  ///  - `action` — a full-width row at the foot of the card, for the one
  ///    thing a person does to this row.
  ///  - `hide` — not drawn on a phone at all.
  ///
  /// Left out, the first column is the title, a right-aligned column is a
  /// metric, and everything else is meta — the guess the hub's `DataTable`
  /// makes, because the conventions already say it.
  readonly card?: "title" | "status" | "meta" | "metric" | "action" | "hide"
  readonly cell: (row: T) => React.ReactNode
  /// Extra classes on this column's desk cells.
  readonly className?: string
}

/// The People module's list table: the hub's look, and the prototype's habit
/// of opening a row into a sheet.
///
/// Why not `list-table.tsx` beside it: that one opens a row *in place*, which
/// is right for comparing promotions and wrong here — a People row opens into
/// a decision (approve this leave, sanction this claim) whose form is longer
/// than the row, and the prototype (`prototypes/hr-v3/hr.html`) puts every one
/// of those in a sheet. So this one takes `onRowClick` and leaves the sheet to
/// the screen, and it carries `metric` and `action` card roles the promotions
/// list has no use for.
///
/// Row height follows the pointer, as the hub's does: 48px under a mouse, a
/// padding-grown row under a finger.
export function PeopleTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  empty,
  className,
}: {
  rows: readonly T[]
  columns: readonly PeopleColumn<T>[]
  rowKey: (row: T) => string
  /// Opening a row. The whole row is the target, on a desk and on a phone.
  onRowClick?: (row: T) => void
  /// What an empty list says. "No rows" and "nothing has happened yet" are
  /// different sentences, and the caller knows which.
  empty?: React.ReactNode
  className?: string
}) {
  const layout = useLayout()

  return (
    <div
      className={cn(
        "overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft",
        className,
      )}
    >
      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <p className="mx-auto max-w-[28em] text-meta text-body">
            {empty ?? "Nothing to show."}
          </p>
        </div>
      ) : layout === "phone" ? (
        <ul className="flex flex-col">
          {rows.map((row) => (
            <CardRow
              key={rowKey(row)}
              row={row}
              columns={columns}
              onRowClick={onRowClick}
            />
          ))}
        </ul>
      ) : (
        // Its own scroller: a wide table on a tablet scrolls inside its card,
        // and the page itself never scrolls sideways.
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-cell">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className={cn(
                      "h-10 border-b border-hairline bg-soft px-3.5 py-0 text-eyebrow font-medium whitespace-nowrap text-body",
                      column.align === "right" ? "text-right" : "text-left",
                    )}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={
                    onRowClick === undefined ? undefined : () => onRowClick(row)
                  }
                  className={cn(
                    "h-row border-b border-hairline last:border-b-0",
                    onRowClick !== undefined &&
                      "cursor-pointer hover:bg-[#f7f9fc]",
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        "px-3.5 py-2.5 align-middle text-text pointer-coarse:py-3",
                        column.align === "right" &&
                          "text-right whitespace-nowrap tabular-nums",
                        column.className,
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

type Role = NonNullable<PeopleColumn<unknown>["card"]>

function roleOf<T>(column: PeopleColumn<T>, index: number): Role {
  if (column.card !== undefined) return column.card
  if (index === 0) return "title"
  if (column.align === "right") return "metric"
  return "meta"
}

/// One row as a phone card — the hub's `DataTable` card: identity and status
/// on one line, context under it, figures in a grid.
function CardRow<T>({
  row,
  columns,
  onRowClick,
}: {
  row: T
  columns: readonly PeopleColumn<T>[]
  onRowClick?: (row: T) => void
}) {
  const parts: Record<Role, PeopleColumn<T>[]> = {
    title: [],
    status: [],
    meta: [],
    metric: [],
    action: [],
    hide: [],
  }
  columns.forEach((column, index) => parts[roleOf(column, index)].push(column))

  return (
    <li
      onClick={onRowClick === undefined ? undefined : () => onRowClick(row)}
      className={cn(
        "flex flex-col gap-1.5 border-b border-hairline px-3.5 py-3 last:border-b-0",
        // `active:` rather than `hover:` — a finger has no hover, and a row
        // left tinted by a synthesised one reads as still selected.
        onRowClick !== undefined && "cursor-pointer active:bg-soft",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {parts.title.map((column) => (
            <div key={column.key} className="min-w-0 text-cell text-ink">
              {column.cell(row)}
            </div>
          ))}
        </div>
        {parts.status.length > 0 && (
          <div className="flex shrink-0 items-center gap-1.5">
            {parts.status.map((column) => (
              <span key={column.key}>{column.cell(row)}</span>
            ))}
          </div>
        )}
      </div>

      {parts.meta.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-1.5 text-meta text-body">
          {parts.meta.map((column, index) => (
            <span key={column.key} className="flex items-center gap-x-1.5">
              {index > 0 && <span className="text-faint">·</span>}
              {column.cell(row)}
            </span>
          ))}
        </div>
      )}

      {parts.metric.length > 0 && (
        <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-2.5">
          {parts.metric.map((column) => (
            <div key={column.key} className="min-w-0">
              <dt className="text-[0.75rem] leading-4 text-mute">
                {column.header}
              </dt>
              <dd className="mt-0.5 min-w-0 text-cell text-ink tabular-nums">
                {column.cell(row)}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {parts.action.map((column) => (
        <div key={column.key} className="mt-1">
          {column.cell(row)}
        </div>
      ))}
    </li>
  )
}
