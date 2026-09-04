import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { ArrowLeft, Download, Share2, Sparkles } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useAssistant } from "@/components/assistant/state"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { BarSeries, ChartLegend } from "@/components/ui/chart"
import {
  chartSeries,
  measuresOf,
  plottedRows,
  plottedSeries,
} from "@/lib/report-chart"
import { DataTable } from "@/components/ui/data-table"
import { FilterBar } from "@/components/ui/filter-bar"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import {
  useFilterState,
  type Filter,
  type FilterField,
  type FilterModel,
} from "@/lib/filters"
import { count, day, money, moment } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import {
  toCsv,
  toServerFilters,
  useAmendReport,
  useReport,
  useReportRun,
  useReviseReport,
  useCatalogue,
  useSavedReports,
  type ResultColumn,
  type ResultRow,
  type ReportResult,
  type SavedReport,
  type SpecFilter,
} from "@/lib/queries/reports"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"

/// Reports somebody kept, and the one they are reading.
///
/// One screen with two states rather than two routes, because which report is
/// open is a URL parameter — so a report is a link, and a link is how a report
/// actually reaches the person who needs it.
///
/// Nothing on this screen involves a model. The assistant composed the spec
/// once; from then on this is an ordinary read, and it answers the same way
/// every time it is opened.
export function Reports() {
  const open = useSheet("report")
  return open.value ? (
    <OneReport id={open.value} onBack={open.close} />
  ) : (
    <SavedList onOpen={open.open} />
  )
}

// ---- The list ----------------------------------------------------------

function SavedList({ onOpen }: { onOpen: (id: string) => void }) {
  const saved = useSavedReports()
  const assistant = useAssistant()

  return (
    <PageContent>
      <PageHeader
        title="Reports"
        sub="Definitions somebody kept. Each one runs against today's data, not the day it was written."
        actions={
          <Button
            variant="dark"
            onClick={() => assistant.setOpen(true)}
            className="gap-1.5"
          >
            <Sparkles className="size-3.5" />
            Compose one
          </Button>
        }
      />

      {queryState(saved, {
        loading: "Reading what has been kept…",
        render: (page) =>
          page.items.length === 0 ? (
            <EmptyState
              action={
                <Button variant="dark" onClick={() => assistant.setOpen(true)}>
                  Ask the assistant
                </Button>
              }
            >
              Nothing kept yet. Describe the report you want — “penjualan per
              warna bulan ini, per toko” — and save the answer. It becomes a
              report anybody can open, and it never has to be asked for again.
            </EmptyState>
          ) : (
            <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {page.items.map((report) => (
                <button
                  key={report.report_id}
                  type="button"
                  onClick={() => onOpen(report.report_id)}
                  className="rounded-card border border-hairline bg-canvas p-4 text-left shadow-soft transition-colors hover:border-hairline-strong hover:bg-soft"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-card-title font-semibold text-ink">
                      {report.name}
                    </span>
                    {report.shared && <Tag tone="info">Shared</Tag>}
                  </div>
                  {report.prompt && (
                    // The sentence it came from, kept as the description. It
                    // is the best account of what the report is *for* that
                    // anybody will ever write down.
                    <p className="mt-1.5 line-clamp-2 text-meta text-body">
                      “{report.prompt}”
                    </p>
                  )}
                  <div className="mt-3 flex items-center gap-2 text-[0.6875rem] text-mute">
                    <span className="font-mono">{report.dataset}</span>
                    <span aria-hidden>·</span>
                    <span>v{report.version}</span>
                    <span aria-hidden>·</span>
                    <span>{moment(report.updated_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          ),
      })}
    </PageContent>
  )
}

// ---- One report --------------------------------------------------------

function OneReport({ id, onBack }: { id: string; onBack: () => void }) {
  const report = useReport(id)
  const catalogue = useCatalogue()
  const amend = useAmendReport(id)

  // What may be filtered, derived from the report's definition and the
  // catalogue — not from the rows that came back.
  //
  // It has to be this way round. The server needs the narrowing in order to
  // build the query, so the filter bar cannot wait for a row model that does
  // not exist yet. Deriving from the catalogue is also better than deriving
  // from the result: `site_id` is an option and `article_name` is prose, and
  // only the catalogue knows which — a table of strings does not.
  const fields = useMemo<FilterField[]>(() => {
    const dataset = catalogue.data?.datasets.find(
      (one) => one.name === report.data?.spec.dataset
    )
    if (!dataset || !report.data) return []
    const spec = report.data.spec
    return [
      ...(spec.group_by ?? []).flatMap((key) => {
        const dimension = dataset.dimensions.find((one) => one.key === key)
        return dimension
          ? [
              {
                column: key,
                label: dimension.label,
                spec: { kind: dimension.kind },
              },
            ]
          : []
      }),
      ...spec.measures.flatMap((key) => {
        const measure = dataset.measures.find((one) => one.key === key)
        return measure
          ? [
              {
                column: key,
                label: measure.label,
                // Money is stored as whole rupiah here, so no `scale`: a
                // reader filtering for over ten million types 10000000 and
                // means it.
                spec: {
                  kind: "number" as const,
                  unit: measure.format === "money" ? "Rp" : undefined,
                },
              },
            ]
          : []
      }),
    ]
  }, [catalogue.data, report.data])

  const state = useFilterState(fields)
  const { filters, untranslated } = useMemo(
    () => toServerFilters(state.filters),
    [state.filters]
  )
  const result = useReportRun(id, filters)

  return (
    <PageContent>
      {queryState(report, {
        loading: "Opening…",
        render: (saved) => (
          <>
            <PageHeader
              crumb={
                <button
                  type="button"
                  onClick={onBack}
                  className="inline-flex items-center gap-1 text-mute transition-colors hover:text-ink"
                >
                  <ArrowLeft className="size-3" />
                  Reports
                </button>
              }
              title={saved.name}
              sub={
                saved.prompt
                  ? `“${saved.prompt}” · v${saved.version}`
                  : `Version ${saved.version}, edited by hand`
              }
              actions={
                <>
                  {saved.editable && (
                    <Button
                      onClick={() => amend.mutate({ shared: !saved.shared })}
                      className="gap-1.5"
                    >
                      <Share2 className="size-3.5" />
                      {saved.shared ? "Shared" : "Share"}
                    </Button>
                  )}
                  <Button
                    onClick={() => result.data && download(saved, result.data)}
                    disabled={!result.data}
                    className="gap-1.5"
                  >
                    <Download className="size-3.5" />
                    CSV
                  </Button>
                </>
              }
            />

            {queryState(result, {
              loading: "Running…",
              render: (answer) => (
                <Answer
                  saved={saved}
                  answer={answer}
                  state={state}
                  overlay={filters}
                  untranslated={untranslated}
                />
              ),
            })}
          </>
        ),
      })}
    </PageContent>
  )
}

function Answer({
  saved,
  answer,
  state,
  overlay,
  untranslated,
}: {
  saved: SavedReport
  answer: ReportResult
  state: ReturnType<typeof useFilterState>
  /// The narrowing the server already applied, in its own vocabulary.
  overlay: readonly SpecFilter[]
  /// Clauses the server could not carry. Structurally empty today — every
  /// operator a report column offers has a server equivalent — and drawn
  /// anyway, because the failure it guards against is silent.
  untranslated: readonly Filter[]
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const revise = useReviseReport(saved.report_id)

  const columns = useMemo(() => columnsOf(answer.columns), [answer.columns])
  const rows = useMemo(() => answer.rows as ResultRow[], [answer.rows])

  // No `columnFilters`. The rows arriving here are already the narrowed set —
  // filtering them a second time in the browser would mean two implementations
  // of "contains" deciding what somebody sees, and the day they disagree the
  // table hides a row the server sent.
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [rows, columns, sorting]
    )
  )

  /// What `<FilterBar>` needs: the URL-backed clauses, plus the columns it
  /// reads facet counts from. `columnFilters` is empty for the reason above.
  const model = useMemo<FilterModel<ResultRow>>(
    () => ({ ...state, add: state.addColumn, columns, columnFilters: [] }),
    [state, columns]
  )

  const kpis = saved.spec.present?.kpis ?? []
  const measures = useMemo(() => measuresOf(answer.columns), [answer.columns])

  // Both of these are shared with the assistant's card, which proposes the
  // same report before anybody keeps it — see `lib/report-chart.ts`. A chart
  // that changes shape when you press "keep" is a chart nobody trusts.
  const series = useMemo(
    () => plottedSeries(saved.spec, measures),
    [saved.spec, measures]
  )
  const plotted = useMemo(() => plottedRows(answer, series), [answer, series])

  return (
    <>
      {kpis.length > 0 && answer.totals && (
        <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
          {kpis.map((key) => (
            <Kpi
              key={key}
              label={measures.get(key)?.label ?? key}
              value={figure(answer.totals?.[key] ?? null, measures.get(key))}
            />
          ))}
        </KpiStrip>
      )}

      {plotted.length > 0 && (
        <Card className="mb-4 px-4 pt-3.5 pb-3">
          <ChartLegend series={chartSeries(series, measures)} />
          <BarSeries
            className="h-[13.75rem] w-full text-eyebrow"
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
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {count(answer.row_count)} row{answer.row_count === 1 ? "" : "s"}
          </CardTitle>
          <span className="text-[0.6875rem] text-mute">
            {answer.period
              ? `${day(answer.period.from)} – ${day(answer.period.to)}`
              : "Sepanjang catatan"}
          </span>
        </CardHeader>

        {/* The same filter bar every other list on this app uses. That is the
            point of the spec carrying keys rather than SQL: what the assistant
            composed is a starting position, and narrowing it further is a
            gesture somebody already knows. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 pb-3">
          <FilterBar model={model} table={table} />
          {/* Narrowing is a reading position, not a change to the report —
              until somebody says otherwise. This is the one button that turns
              one into the other, and it writes a version rather than editing
              the one that is there. */}
          {overlay.length > 0 && saved.editable && (
            <Button
              variant="soft"
              disabled={revise.isPending}
              onClick={() =>
                revise.mutate(
                  {
                    spec: {
                      ...saved.spec,
                      filters: [...(saved.spec.filters ?? []), ...overlay],
                    },
                  },
                  { onSuccess: () => state.clear() }
                )
              }
            >
              {revise.isPending
                ? "Keeping…"
                : `Keep ${overlay.length === 1 ? "this filter" : "these filters"} in the report`}
            </Button>
          )}
        </div>

        {untranslated.length > 0 && (
          <Banner tone="warn">
            {untranslated.length} filter this node cannot answer{" "}
            {untranslated.length === 1 ? "is" : "are"} being ignored:{" "}
            {untranslated.map((clause) => clause.column).join(", ")}.
          </Banner>
        )}

        {answer.truncated && (
          <Banner tone="warn">
            Only the first {count(answer.row_count)} rows are shown. Narrow the
            period or group by less to see the rest — the figures above are the
            whole period regardless.
          </Banner>
        )}

        <DataTable
          table={table}
          empty={
            <EmptyState>
              Nothing matched. The report ran; there is simply no trade in that
              window.
            </EmptyState>
          }
        />
      </Card>
    </>
  )
}

// ---- Drawing what the server sent --------------------------------------

/// Build the table's columns from the result's own description of itself.
///
/// Written at run time rather than declared, because the whole feature exists
/// so that a report nobody anticipated can be drawn. What is fixed is how each
/// *kind* of column is drawn — money right-aligned and formatted, a bucket as a
/// date, everything else as text.
function columnsOf(
  described: readonly ResultColumn[]
): ColumnDef<TableSetup, ResultRow>[] {
  return described.map((column) => ({
    accessorKey: column.key,
    header: column.label,
    size: column.role === "measure" ? 130 : 180,
    meta: {
      align: column.role === "measure" ? "right" : undefined,
      filter: {
        kind: column.role === "measure" ? "number" : "text",
      },
    },
    cell: ({ row }: { row: { original: ResultRow } }) => {
      const value = row.original[column.key]
      if (column.role === "bucket") {
        return <span className="text-body">{day(String(value ?? ""))}</span>
      }
      if (column.role === "measure") {
        return figure(value, column)
      }
      return value === null || value === "" ? (
        <span className="text-mute">—</span>
      ) : (
        String(value)
      )
    },
  }))
}

/// A measure, formatted the way the catalogue said it should be.
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

/// The rows as a file, built from what is already on the screen.
function download(saved: SavedReport, answer: ReportResult) {
  const blob = new Blob([toCsv(answer)], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  // Punctuation out, then runs of space collapsed: stripping the ampersand
  // from "Bruto & Unit" otherwise leaves a double space in the filename.
  const name = saved.name
    .replace(/[^\w -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  link.download = `${name || "report"}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
