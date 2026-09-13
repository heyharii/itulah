import { Code2, Table2 } from "lucide-react"
import { useState } from "react"

import { QueryChart, type ChartSpec } from "@/components/assistant/query-chart"
import { count, day, money, moment } from "@/lib/format"
import { cn } from "@/lib/utils"

/// What a query answered: a chart when one was asked for, and always the rows.
///
/// This is the card the assistant's reach depends on. The other renderers in
/// `artifact.tsx` each know the shape of one tool's payload and draw it the way
/// the screen that owns it does. This one knows nothing: it is handed columns
/// and rows the model chose, from a query the model wrote, and has to make a
/// readable table out of whatever comes back.
///
/// Three things make that work rather than producing a grid of raw JSON:
///
///   * **The column name says how to print the value.** `_minor` is rupiah,
///     `_at` is a moment, `_date` is a day, a count is a count. The server
///     names its columns consistently enough that this is right far more often
///     than a type check would be — a bigint is money or a quantity and only
///     the name knows which.
///   * **The query is on the card.** Not because anybody wants to read SQL,
///     but because a figure nobody can check is a figure nobody should act on,
///     and this one was written by a model thirty seconds ago.
///   * **Nothing is hidden.** A truncated result says so. A cut-off table is
///     the one failure that looks exactly like an answer.

interface Payload {
  readonly title: string | null
  readonly sql: string
  readonly columns: readonly string[]
  readonly rows: readonly (readonly unknown[])[]
  readonly truncated: boolean
  readonly chart: ChartSpec | null
}

/// Read the server's payload defensively. Everything here is `json!()` on the
/// far side and a model's arguments before that, so a missing field must leave
/// a gap in a card rather than a blank panel with an exception behind it.
function read(data: unknown): Payload | null {
  if (typeof data !== "object" || data === null) return null
  const value = data as Record<string, unknown>
  const columns = Array.isArray(value.columns)
    ? value.columns.map((column) => String(column))
    : []
  const rows = Array.isArray(value.rows)
    ? value.rows.filter(Array.isArray).map((row) => row as unknown[])
    : []
  if (columns.length === 0) return null
  return {
    title: typeof value.title === "string" ? value.title : null,
    sql: typeof value.sql === "string" ? value.sql : "",
    columns,
    rows,
    truncated: value.truncated === true,
    chart: readChartSpec(value.chart),
  }
}

/// A chart spec out of a model's arguments, or nothing.
///
/// Here rather than beside the chart it configures, because a module that
/// exports both a component and a function cannot be hot reloaded — and this
/// file is the only caller.
function readChartSpec(value: unknown): ChartSpec | null {
  if (typeof value !== "object" || value === null) return null
  const spec = value as Record<string, unknown>
  const kind = spec.kind
  if (kind !== "bar" && kind !== "line" && kind !== "area" && kind !== "pie") {
    return null
  }
  const x = typeof spec.x === "string" ? spec.x : null
  const y = Array.isArray(spec.y)
    ? spec.y.filter((key): key is string => typeof key === "string")
    : []
  if (!x || y.length === 0) return null
  return {
    kind,
    x,
    y,
    stacked: spec.stacked === true,
    money: spec.money === true,
  }
}

export function QueryCard({ data }: { data: unknown }) {
  const [showSql, setShowSql] = useState(false)
  const payload = read(data)

  if (!payload) {
    return (
      <p className="px-3 py-3 text-meta text-body">
        That query answered nothing this can draw.
      </p>
    )
  }

  const { columns, rows, chart } = payload

  return (
    <div>
      <header className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <Table2 className="size-3.5 shrink-0 text-line-ico" />
        <span className="min-w-0 flex-1 truncate text-meta font-medium text-ink">
          {payload.title ?? "Query"}
        </span>
        <span className="shrink-0 text-eyebrow text-mute tabular-nums">
          {count(rows.length)}
          {payload.truncated ? "+" : ""} {rows.length === 1 ? "row" : "rows"}
        </span>
        {payload.sql && (
          <button
            type="button"
            onClick={() => setShowSql((on) => !on)}
            aria-label="Show the query"
            aria-pressed={showSql}
            title="The query behind this"
            className={cn(
              "grid size-6 shrink-0 place-items-center rounded-inner transition-colors hover:bg-soft-2",
              showSql ? "bg-soft-2 text-ink" : "text-line-ico hover:text-ink"
            )}
          >
            <Code2 className="size-3.5" />
          </button>
        )}
      </header>

      {showSql && (
        <pre className="overflow-x-auto border-b border-hairline bg-soft px-3 py-2.5 font-mono text-id leading-relaxed whitespace-pre-wrap text-body">
          {payload.sql}
        </pre>
      )}

      {chart && <QueryChart spec={chart} columns={columns} rows={rows} />}

      {rows.length === 0 ? (
        <p className="px-3 py-3 text-meta text-body">Nothing matched.</p>
      ) : (
        <div className="max-h-[22rem] overflow-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-1 bg-canvas">
              <tr>
                {columns.map((column, index) => (
                  <th
                    key={column + index}
                    className={cn(
                      "border-b border-hairline bg-canvas px-3 py-1.5 text-eyebrow font-semibold whitespace-nowrap text-mute uppercase",
                      numeric(column) ? "text-right" : "text-left"
                    )}
                  >
                    {heading(column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={index}
                  className="border-b border-hairline last:border-0"
                >
                  {columns.map((column, cell) => (
                    <td
                      key={column + cell}
                      title={plain(row[cell])}
                      className={cn(
                        "max-w-[18rem] truncate px-3 py-[0.4375rem] text-cell",
                        numeric(column)
                          ? "text-right text-body tabular-nums"
                          : cell === 0
                            ? "text-ink"
                            : "text-body"
                      )}
                    >
                      {format(column, row[cell])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {payload.truncated && (
        <p className="border-t border-hairline px-3 py-2 text-eyebrow text-warn-fg">
          Cut off at {count(rows.length)} rows. Ask for a narrower window or a
          total.
        </p>
      )}
    </div>
  )
}

/// `gross_minor` reads as "Gross" — the suffix is an instruction to this file,
/// not a word anybody wants in a heading.
function heading(column: string): string {
  return column
    .replace(/_minor$/, "")
    .replace(/_/g, " ")
    .replace(/^./, (first) => first.toUpperCase())
}

/// Whether a column stands on the right. By name, because the value can be
/// null on the row that decides the alignment for the whole column.
function numeric(column: string): boolean {
  return /(_minor|_count|count|qty|quantity|total|amount|units|pieces|_sum|_avg|percent|pct)$/i.test(
    column
  )
}

/// One cell, printed the way its column says.
function format(column: string, value: unknown): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-faint">—</span>
  }
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number") {
    if (/_minor$/.test(column)) return money(value)
    return count(value)
  }
  if (typeof value === "string") {
    // Postgres hands back a timestamp as text; the column name says whether
    // the time of day is part of the fact or noise beside it.
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return moment(value)
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return day(value)
    // A numeric column arriving as text is Postgres `numeric`, which is exact
    // and therefore not a JSON number. It is still a figure.
    if (/_minor$/.test(column) && /^-?\d+$/.test(value)) {
      return money(Number(value))
    }
    return value
  }
  return JSON.stringify(value)
}

/// The whole value, for the title attribute of a cell that had to truncate.
function plain(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  return typeof value === "string" ? value : JSON.stringify(value)
}
