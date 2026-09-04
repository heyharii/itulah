import type { ChartRow, ChartSeries } from "@/components/ui/chart"
import type { ReportResult, ReportSpec, ResultColumn } from "@/lib/queries/reports"

/// What a report's chart is made of, in one place.
///
/// Two screens draw the same chart from the same spec: the Reports screen,
/// where a kept report is read, and the assistant's card, where one is
/// proposed. They must agree — a chart that changes shape when you press
/// "keep" is a chart nobody trusts — and the rules below are subtle enough
/// that two copies would stop agreeing within a month.

/// The measures on the axis, by key.
export function measuresOf(
  columns: readonly ResultColumn[]
): Map<string, ResultColumn> {
  return new Map(
    columns
      .filter((column) => column.role === "measure")
      .map((column) => [column.key, column])
  )
}

/// Which measures actually go on the axis.
///
/// Only those sharing the first one's unit. Bruto and units plotted together
/// means the unit bars are a hairline beside forty million rupiah — a chart
/// that is technically correct and reads as "units are zero". Two scales want
/// two charts, not two colours. Two series at most, because the second is the
/// single categorical cap this design language allows.
export function plottedSeries(
  spec: ReportSpec,
  measures: Map<string, ResultColumn>
): string[] {
  const wanted = (spec.present?.chart ?? []).filter((key) => measures.has(key))
  const first = measures.get(wanted[0] ?? "")
  return wanted
    .filter((key) => measures.get(key)?.format === first?.format)
    .slice(0, 2)
}

/// The rows, per bucket rather than per row.
///
/// A report grouped by week AND shop has thirteen rows per week, and plotting
/// the rows would draw thirteen bars for the same Monday, in whatever order
/// the table happened to be sorted.
export function plottedRows(
  answer: ReportResult,
  series: readonly string[]
): ChartRow[] {
  if (series.length === 0) return []
  const buckets = new Map<string, Record<string, number>>()
  for (const row of answer.rows) {
    const bucket = String(row.bucket ?? "")
    if (!bucket) continue
    const into = buckets.get(bucket) ?? {}
    for (const key of series) {
      into[key] = (into[key] ?? 0) + Number(row[key] ?? 0)
    }
    buckets.set(bucket, into)
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([bucket, values]) => ({ bucket, ...values }))
}

export function chartSeries(
  keys: readonly string[],
  measures: Map<string, ResultColumn>
): ChartSeries[] {
  return keys.map((key, index) => ({
    key,
    label: measures.get(key)?.label ?? key,
    tone: index === 0 ? "accent" : "cap",
  }))
}
