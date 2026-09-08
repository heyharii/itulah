import { ArrowRight, Check } from "lucide-react"
import { useState } from "react"

import { BarSeries } from "@/components/ui/chart"
import { Button } from "@/components/ui/button"
import { count, day, money } from "@/lib/format"
import {
  chartSeries,
  measuresOf,
  plottedRows,
  plottedSeries,
} from "@/lib/report-chart"
import { useAppNavigate } from "@/lib/navigate"
import {
  useSaveReport,
  type ReportResult,
  type ReportSpec,
  type ResultColumn,
} from "@/lib/queries/reports"
import { useAssistantCapabilities } from "@/lib/queries/assistant"
import { cn } from "@/lib/utils"

/// A report the assistant has composed, before anybody has decided to keep it.
///
/// The preview is real rows from the real query — not a description of what the
/// report would show. That is the whole reason this card exists rather than a
/// paragraph: deciding whether a definition is worth keeping is a judgement
/// nobody can make from prose, and the cost of being wrong is a menu filling up
/// with reports that were never opened twice.
///
/// Saving is the only thing on this card that writes, and it is a person
/// pressing a button. The assistant proposes; it does not keep.
interface Composed {
  readonly name: string
  readonly spec: ReportSpec
}

type Payload = ReportResult & Composed

function isComposed(data: unknown): data is Payload {
  if (typeof data !== "object" || data === null) return false
  const value = data as Record<string, unknown>
  return typeof value.name === "string" && typeof value.spec === "object"
}

export function ReportCard({
  data,
  question,
}: {
  data: unknown
  /// The sentence this came from. Kept with the report when it is saved — six
  /// months on it is the best account of what the report is *for* that anybody
  /// will have written down.
  question: string
}) {
  const save = useSaveReport()
  const navigate = useAppNavigate()
  const capabilities = useAssistantCapabilities()
  const [saved, setSaved] = useState<string | null>(null)

  if (!isComposed(data)) return null

  const measures = measuresOf(data.columns)
  const kpis = data.spec.present?.kpis ?? []
  const rows = data.rows.slice(0, 8)
  // The same chart the Reports screen will draw once this is kept, from the
  // same rules — see `lib/report-chart.ts`. Drawing it here is not decoration:
  // a spec whose chart only appears after somebody presses "keep" is a spec
  // they are being asked to judge without seeing what it makes, and the model
  // had to be told to avoid composing reports whenever a chart was asked for.
  const series = plottedSeries(data.spec, measures)
  const plotted = plottedRows(data, series)

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-hairline bg-soft px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-meta font-semibold text-ink">
          {data.name}
        </span>
        <span className="shrink-0 rounded-full border border-hairline-2 bg-canvas px-1.5 py-px font-mono text-[0.625rem] text-body">
          {data.spec.dataset}
        </span>
      </div>

      {kpis.length > 0 && data.totals && (
        <div
          className="grid gap-px bg-hairline"
          // Columns from how many figures there are, so two KPIs are two
          // cards and not two cards beside an empty third.
          style={{
            gridTemplateColumns: `repeat(${Math.min(kpis.length, 3)}, minmax(0, 1fr))`,
          }}
        >
          {kpis.slice(0, 3).map((key) => (
            <div key={key} className="bg-canvas px-3 py-2.5">
              <div className="text-eyebrow font-semibold text-mute uppercase">
                {measures.get(key)?.label ?? key}
              </div>
              <div className="mt-1 text-[0.9375rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
                {figure(data.totals?.[key] ?? null, measures.get(key))}
              </div>
            </div>
          ))}
        </div>
      )}

      {plotted.length > 0 && (
        <div className="border-b border-hairline px-3 pt-3 pb-1">
          <BarSeries
            className="h-[9.5rem] w-full text-eyebrow"
            rows={plotted}
            series={chartSeries(series, measures)}
            format={(value) =>
              measures.get(series[0])?.format === "money"
                ? money(value)
                : count(value)
            }
            titleOf={day}
            labelOf={(bucket) => bucket.slice(5).replace("-", "/")}
          />
        </div>
      )}

      {rows.length > 0 ? (
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr>
              {data.columns.map((column, index) => (
                <th
                  key={column.key}
                  className={cn(
                    "border-b border-hairline px-3 py-1.5 text-eyebrow font-semibold text-mute uppercase",
                    index === 0 ? "text-left" : "text-right"
                  )}
                >
                  {column.label}
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
                {data.columns.map((column, cell) => (
                  <td
                    key={column.key}
                    className={cn(
                      "truncate px-3 py-[0.4375rem] text-cell",
                      cell === 0
                        ? "text-left text-ink"
                        : "text-right text-body tabular-nums"
                    )}
                  >
                    {column.role === "bucket"
                      ? day(String(row[column.key] ?? ""))
                      : column.role === "measure"
                        ? figure(row[column.key], column)
                        : (row[column.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="px-3 py-3 text-meta text-body">
          The definition is valid; there is no trade in that window.
        </p>
      )}

      <div className="flex items-center gap-2 border-t border-hairline px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-mute">
          {count(data.row_count)} row{data.row_count === 1 ? "" : "s"}
          {data.period &&
            ` · ${day(data.period.from)} – ${day(data.period.to)}`}
          {data.rows.length > rows.length && " · first 8 shown"}
        </span>
        {saved ? (
          <Button
            variant="soft"
            className="gap-1.5"
            onClick={() =>
              navigate("/reports", { key: "report", value: saved })
            }
          >
            Open
            <ArrowRight className="size-3.5" />
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={save.isPending}
            className="gap-1.5"
            onClick={() =>
              save.mutate(
                {
                  name: data.name,
                  spec: data.spec,
                  prompt: question,
                  model: capabilities.data?.model,
                },
                { onSuccess: (report) => setSaved(report.report_id) }
              )
            }
          >
            {save.isPending ? (
              "Saving…"
            ) : (
              <>
                <Check className="size-3.5" />
                Keep this report
              </>
            )}
          </Button>
        )}
      </div>

      {save.isError && (
        <p className="border-t border-hairline px-3 py-2 text-meta text-bad">
          {save.error instanceof Error ? save.error.message : "Could not save."}
        </p>
      )}
    </div>
  )
}

function figure(
  value: string | number | null,
  column: ResultColumn | undefined
): string {
  if (value === null || value === undefined) return "—"
  const numeric = Number(value)
  if (Number.isNaN(numeric)) return String(value)
  if (column?.format === "money") return money(numeric)
  if (column?.format === "percent") return `${numeric}%`
  return count(numeric)
}
