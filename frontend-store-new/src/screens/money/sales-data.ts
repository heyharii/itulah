import { isoDay, type Receipt, type SalesSeries } from "@/lib/queries"

/// Pure arithmetic for the Sales screen: everything here is a sum over what the
/// node already answered (`sales/series` for days, `sales/window` for receipts
/// and tenders). Nothing is estimated.

export interface Figures {
  readonly sales_count: number
  readonly units_sold: number
  readonly gross_minor: number
}

export interface Day extends Figures {
  readonly day: string
}

export interface Row extends Figures {
  readonly key: string
  readonly label: string
}

export type Measure =
  "gross_minor" | "sales_count" | "average_minor" | "units_sold"

export const ZERO: Figures = { sales_count: 0, units_sold: 0, gross_minor: 0 }

export function sum(rows: readonly Figures[]): Figures {
  return rows.reduce(
    (total, row) => ({
      sales_count: total.sales_count + row.sales_count,
      units_sold: total.units_sold + row.units_sold,
      gross_minor: total.gross_minor + row.gross_minor,
    }),
    ZERO,
  )
}

export function valueOf(figures: Figures, kind: Measure): number {
  if (kind !== "average_minor") return figures[kind]
  return figures.sales_count === 0
    ? 0
    : Math.round(figures.gross_minor / figures.sales_count)
}

/// Every day on the axis, zero days included.
export function daysOfSeries(run: SalesSeries): readonly Day[] {
  const cells = new Map(run.cells.map((cell) => [cell.bucket_start, cell]))
  return run.buckets.map((day) => ({
    day,
    sales_count: cells.get(day)?.sales_count ?? 0,
    units_sold: cells.get(day)?.units_sold ?? 0,
    gross_minor: cells.get(day)?.gross_minor ?? 0,
  }))
}

const at = (iso: string) => new Date(`${iso}T00:00:00`)

function eachDay(from: string, to: string): string[] {
  const days: string[] = []
  const cursor = at(from)
  const end = at(to)
  while (cursor <= end && days.length < 1000) {
    days.push(isoDay(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

/// Days built from receipts, for when the list is narrowed to one cashier —
/// the series answer has no cashier in it.
export function daysOfReceipts(
  receipts: readonly Receipt[],
  from: string,
  to: string,
): readonly Day[] {
  const by = new Map<string, Figures>()
  for (const receipt of receipts) {
    const day = isoDay(new Date(receipt.completed_at))
    const was = by.get(day) ?? ZERO
    by.set(day, {
      sales_count: was.sales_count + 1,
      units_sold: was.units_sold + receipt.units,
      gross_minor: was.gross_minor + receipt.total_minor,
    })
  }
  return eachDay(from, to).map((day) => ({ day, ...(by.get(day) ?? ZERO) }))
}

export type Group = "day" | "week" | "month"

/// The date a day's group starts on: its Monday for a week (as the node names
/// weeks), its first for a month.
export function startOf(day: string, group: Group): string {
  if (group === "day") return day
  const date = at(day)
  if (group === "month") date.setDate(1)
  else date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return isoDay(date)
}

export function grouped(days: readonly Day[], group: Group): readonly Day[] {
  if (group === "day") return days
  const by = new Map<string, Figures>()
  for (const day of days) {
    const start = startOf(day.day, group)
    by.set(start, sum([by.get(start) ?? ZERO, day]))
  }
  return [...by.entries()].map(([day, figures]) => ({ day, ...figures }))
}

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
]

function rowsBy(
  receipts: readonly Receipt[],
  keyOf: (receipt: Receipt) => string,
): Map<string, Figures> {
  const by = new Map<string, Figures>()
  for (const receipt of receipts) {
    const key = keyOf(receipt)
    by.set(
      key,
      sum([
        by.get(key) ?? ZERO,
        {
          sales_count: 1,
          units_sold: receipt.units,
          gross_minor: receipt.total_minor,
        },
      ]),
    )
  }
  return by
}

export function weekdayRows(receipts: readonly Receipt[]): readonly Row[] {
  const by = rowsBy(receipts, (r) =>
    String((new Date(r.completed_at).getDay() + 6) % 7),
  )
  return WEEKDAYS.map((label, index) => ({
    key: String(index),
    label,
    ...(by.get(String(index)) ?? ZERO),
  }))
}

/// From the first hour anyone sold in to the last, so the bars do not carry a
/// night of empty hours either side.
export function hourRows(receipts: readonly Receipt[]): readonly Row[] {
  const by = rowsBy(receipts, (r) =>
    String(new Date(r.completed_at).getHours()),
  )
  const hours = [...by.keys()].map(Number)
  if (hours.length === 0) return []
  const first = Math.min(...hours)
  const last = Math.max(...hours)
  const rows: Row[] = []
  for (let hour = first; hour <= last; hour += 1) {
    rows.push({
      key: String(hour),
      label: `${String(hour).padStart(2, "0")}:00`,
      ...(by.get(String(hour)) ?? ZERO),
    })
  }
  return rows
}

export function cashierRows(receipts: readonly Receipt[]): readonly Row[] {
  const by = rowsBy(receipts, (r) => r.actor_id)
  return [...by.entries()]
    .map(([key, figures]) => ({ key, label: key, ...figures }))
    .sort((a, b) => b.gross_minor - a.gross_minor)
}
