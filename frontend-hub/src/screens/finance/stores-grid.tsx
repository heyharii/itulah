import { useTable, type ColumnDef } from "@tanstack/react-table"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useMemo } from "react"

import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { CellMoney } from "@/components/ui/rows-switch"
import { weekday, day } from "@/lib/format"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"

/// The table every Finance › Stores page draws: columns as plain words and
/// cells, the way the prototype lists them, over the hub's DataTable.
export interface Col<T> {
  readonly id: string
  readonly header: string
  readonly size?: number
  /// A figure: right-aligned.
  readonly num?: boolean
  readonly cell: (row: T) => React.ReactNode
  /// The value a footer total or a search reads; defaults to nothing.
  readonly sort?: (row: T) => unknown
}

export function GridTable<T>({
  rows,
  cols,
  id,
  onRow,
  foot,
  empty,
  selected,
}: {
  rows: readonly T[]
  cols: readonly Col<T>[]
  id: (row: T, index: number) => string
  onRow?: (row: T) => void
  /// Keyed by column id; drawn as the table's footer row.
  foot?: Readonly<Record<string, React.ReactNode>>
  empty: string
  selected?: (row: T) => boolean
}) {
  const columns = useMemo<ColumnDef<TableSetup, T>[]>(
    () =>
      cols.map((col, index) => ({
        id: col.id,
        header: col.header,
        size: col.size ?? 160,
        accessorFn: (row: T) => (col.sort ? col.sort(row) : ""),
        enableSorting: false,
        meta: {
          align: col.num ? ("right" as const) : undefined,
          card:
            index === 0
              ? ("title" as const)
              : col.num
                ? ("metric" as const)
                : undefined,
          grow: col.size === undefined ? 200 : undefined,
          priority: index === 0 ? undefined : col.num ? undefined : 2,
        },
        cell: ({ row }) => col.cell(row.original),
      })),
    [cols]
  )
  const table = useTable({
    features: tableSetup,
    data: rows as T[],
    columns,
    getRowId: (row: T, index: number) => id(row, index),
  })
  return (
    <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
      <DataTable<T>
        table={table}
        onRowClick={onRow}
        isSelected={selected}
        summary={foot}
        empty={<div className="p-8 text-center text-mute">{empty}</div>}
        pageScroll
        cardSort={false}
        cardsApart
      />
    </Card>
  )
}

/// A figure that is a problem (red), a surprise (amber) or nothing (quiet 0).
export function Diff({ minor }: { minor: number | null }) {
  if (minor === null) return <span className="text-faint">—</span>
  if (minor === 0) return <span className="text-mute">0</span>
  return (
    <span className={minor < 0 ? "text-bad-fg" : "text-warn-fg"}>
      {minor < 0 ? "−" : "+"}
      <CellMoney minor={Math.abs(minor)} />
    </span>
  )
}

export function Dash() {
  return <span className="text-faint">—</span>
}

/// The shop in a cell: its code, then its name quietly.
export function ShopCell({ code, name }: { code: string; name: string }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="font-medium text-ink">{code}</span>
      <span className="truncate text-mute">{name}</span>
    </span>
  )
}

export function addDays(iso: string, n: number): string {
  const date = new Date(`${iso}T12:00:00`)
  date.setDate(date.getDate() + n)
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${m}-${d}`
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T12:00:00`).getTime() -
      new Date(`${from}T12:00:00`).getTime()) /
      86_400_000
  )
}

export function plural(n: number, word: string): string {
  return `${n.toLocaleString("id-ID")} ${word}${n === 1 ? "" : "s"}`
}

/// The day picker of the prototype: ‹ Tue 27 Oct ›. The day after the last
/// is not offered.
export function DayPick({
  value,
  last,
  onChange,
  className,
}: {
  value: string
  last: string
  onChange: (next: string) => void
  className?: string
}) {
  const button =
    "inline-flex size-9 items-center justify-center rounded-full text-ink transition-[scale,background-color] duration-(--t-press) ease-(--ease-out) hover:bg-soft-2 active:scale-[0.97] disabled:opacity-40 pointer-coarse:size-11"
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-inner border border-hairline-2 bg-canvas px-1 shadow-soft",
        className
      )}
    >
      <button
        type="button"
        aria-label="Day before"
        className={button}
        onClick={() => onChange(addDays(value, -1))}
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-28 text-center text-[0.9375rem] font-medium text-ink">
        {weekday(value)} {day(value)}
      </span>
      <button
        type="button"
        aria-label="Day after"
        className={button}
        disabled={value >= last}
        onClick={() => onChange(addDays(value, 1))}
      >
        <ChevronRight className="size-4" />
      </button>
    </span>
  )
}
