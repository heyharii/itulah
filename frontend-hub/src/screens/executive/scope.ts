import {
  isoDate,
  type SalesBucket,
  type SalesRange,
} from "@itulah/contract/reporting"

import { useSheet } from "@/lib/sheets"

/// What the executive report is read over: a period, the one it is measured
/// against, and which shop — or the whole company.
///
/// Held in the URL (`?term=` and `?store=`) so a report somebody sends is the
/// report the other person opens, and so crossing from Ringkasan to Kas & laba
/// keeps the question that was being asked.
///
/// The comparison is always the SAME SHAPE one step back. Twenty-five days of
/// September are measured against the first twenty-five days of August, never
/// against the whole of it: a month in progress against a finished one is a
/// fall every month until the last day.

export type Term = "month" | "last-month" | "quarter" | "year"

export const TERMS: readonly {
  readonly value: Term
  readonly label: string
}[] = [
  { value: "month", label: "Bulan ini" },
  { value: "last-month", label: "Bulan lalu" },
  { value: "quarter", label: "Kuartal ini" },
  { value: "year", label: "Tahun ini" },
]

export interface Span {
  readonly from: string
  readonly to: string
}

export interface ReportScope {
  readonly term: Term
  /// The shop the report is narrowed to; undefined is every unit.
  readonly store: string | undefined
  readonly current: Span
  readonly before: Span
  /// How the trend chart cuts the span — days for a month, weeks for a
  /// quarter, months for a year. Thirty bars legible at a glance each time.
  readonly bucket: SalesBucket
  readonly range: SalesRange
  readonly beforeRange: SalesRange
  readonly label: string
  readonly beforeLabel: string
  /// The period's last day, which is the day every balance is read at.
  readonly asOf: string
  /// That day as a person reads it: "25 Sep 2026".
  readonly asOfLabel: string
  readonly setTerm: (term: Term) => void
  readonly setStore: (store: string | undefined) => void
}

/// Midday, so stepping by days never lands on a daylight-saving seam.
function noon(year: number, month: number, day: number): Date {
  return new Date(year, month, day, 12)
}

function lastDay(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

/// The same number of days into an earlier period, clamped to its end: the
/// 31st of a month measured against a 30-day one reads the whole 30.
function sameStretch(start: Date, days: number, end: Date): Span {
  const to = new Date(start)
  to.setDate(to.getDate() + days - 1)
  return { from: isoDate(start), to: isoDate(to > end ? end : to) }
}

function daysFrom(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1
}

export function spansOf(
  term: Term,
  today: Date
): { current: Span; before: Span } {
  const y = today.getFullYear()
  const m = today.getMonth()
  const now = noon(y, m, today.getDate())

  switch (term) {
    case "month": {
      const start = noon(y, m, 1)
      return {
        current: { from: isoDate(start), to: isoDate(now) },
        before: sameStretch(
          noon(y, m - 1, 1),
          daysFrom(start, now),
          noon(y, m - 1, lastDay(y, m - 1))
        ),
      }
    }
    case "last-month": {
      return {
        current: {
          from: isoDate(noon(y, m - 1, 1)),
          to: isoDate(noon(y, m - 1, lastDay(y, m - 1))),
        },
        before: {
          from: isoDate(noon(y, m - 2, 1)),
          to: isoDate(noon(y, m - 2, lastDay(y, m - 2))),
        },
      }
    }
    case "quarter": {
      const q = Math.floor(m / 3) * 3
      const start = noon(y, q, 1)
      return {
        current: { from: isoDate(start), to: isoDate(now) },
        before: sameStretch(
          noon(y, q - 3, 1),
          daysFrom(start, now),
          noon(y, q - 1, lastDay(y, q - 1))
        ),
      }
    }
    case "year": {
      const start = noon(y, 0, 1)
      return {
        current: { from: isoDate(start), to: isoDate(now) },
        before: sameStretch(
          noon(y - 1, 0, 1),
          daysFrom(start, now),
          noon(y - 1, 11, 31)
        ),
      }
    }
  }
}

const BUCKET: Record<Term, SalesBucket> = {
  month: "day",
  "last-month": "day",
  quarter: "week",
  year: "month",
}

const monthName = (date: Date) =>
  date.toLocaleDateString("id-ID", { month: "long" })

/// "1–25 September 2026", "1 Juli – 25 September 2026", "1 Des 2025 – 5 Jan 2026".
export function spanLabel(span: Span): string {
  const from = new Date(`${span.from}T12:00:00`)
  const to = new Date(`${span.to}T12:00:00`)
  if (from.getFullYear() !== to.getFullYear()) {
    const long = (date: Date) =>
      date.toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    return `${long(from)} – ${long(to)}`
  }
  if (from.getMonth() === to.getMonth()) {
    return from.getDate() === to.getDate()
      ? `${to.getDate()} ${monthName(to)} ${to.getFullYear()}`
      : `${from.getDate()}–${to.getDate()} ${monthName(to)} ${to.getFullYear()}`
  }
  return `${from.getDate()} ${monthName(from)} – ${to.getDate()} ${monthName(to)} ${to.getFullYear()}`
}

export function useReportScope(): ReportScope {
  const termParam = useSheet("term")
  const storeParam = useSheet("store")

  const term: Term = termParam.value ?? "month"
  const { current, before } = spansOf(term, new Date())
  const bucket = BUCKET[term]

  return {
    term,
    store: storeParam.value,
    current,
    before,
    bucket,
    range: { ...current, bucket },
    beforeRange: { ...before, bucket },
    label: spanLabel(current),
    beforeLabel: spanLabel(before),
    asOf: current.to,
    asOfLabel: new Date(`${current.to}T12:00:00`).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    // The default is left out of the URL rather than written into it, so the
    // plain address stays the plain report.
    setTerm: (next) =>
      next === "month" ? termParam.close() : termParam.replace(next),
    setStore: (next) =>
      next === undefined ? storeParam.close() : storeParam.replace(next),
  }
}
