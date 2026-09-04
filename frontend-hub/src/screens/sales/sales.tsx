import { useQuery } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PickOne } from "@/components/ui/pick"
import { PageHeader } from "@/components/ui/page-header"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { ButtonGroup } from "@/components/ui/segmented"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/states"
import { money } from "@/lib/format"
import { analyticsKeys, salesSeries } from "@/lib/queries/analytics"
import { queryState } from "@/lib/query-state"
import { useSheet, type SheetSearch } from "@/lib/sheets"
import { SalesChart } from "@/screens/sales/chart"
import { ComparisonPicker } from "@/screens/sales/comparison"
import { buildMatrix, type SalesKind } from "@/screens/sales/matrix"
import { usePeriod } from "@/screens/sales/period"
import { SalesTable } from "@/screens/sales/table"
import { WindowSheet } from "@/screens/sales/window-sheet"
import {
  bucketTitle,
  comparisonOf,
  SALES_BUCKETS,
  type Comparison,
  type ComparisonMode,
  type SalesBucket,
  type SalesRange,
} from "@itulah/contract/reporting"

/// What the shops sold, and which of them sold it.
///
/// Until this screen existed here the centre could publish a price and had no
/// way to ask what it earned. The day report answered that for one shop on one
/// day — a report you had to already know to ask for — and the receipts list
/// answered it for the last few hundred sales regardless of when or where.
/// Neither is the question head office actually has, which is **"how did the
/// fleet trade this month, and which branch is the reason"**.
///
/// So the screen is two halves of one answer. The chart is the fleet, stacked
/// by shop; the table is every shop against every period, with the periods
/// scrolling under a shop column that stays. They are the same numbers, built
/// from one index (`matrix.ts`) so they cannot disagree, and one granularity
/// drives both — two controls that could differ would put two answers to one
/// question on one screen.
///
/// **Everything a reader chooses is in the URL.** A span somebody narrowed
/// down, the shop they focused, the Ramadan they are comparing against and the
/// cell they opened are all things you send to a colleague, and a reload should
/// not throw any of them away.
const BUCKETS: readonly { value: SalesBucket; label: string }[] =
  SALES_BUCKETS.map((bucket) => ({ value: bucket, label: bucket }))

export function Sales() {
  const period = usePeriod()
  // The shop the whole screen is narrowed to. `store` and not a second name
  // for a site id — see the note on it in `lib/sheets.ts`.
  const focus = useSheet("store")
  const cell = useCellSheet()
  const { comparison, setComparison } = useComparison(
    period.range,
    period.buckets
  )

  // Which of the three measures is drawn. Deliberately NOT in the URL: it is
  // the one control on this screen that changes what the chart *is* rather than
  // what it is about, and a reader flips it three times a minute while reading
  // one span. The span is the thing worth sending.
  const [kind, setKind] = useState<SalesKind>("gross_minor")

  const series = useQuery({
    queryKey: analyticsKeys.series(period.range),
    queryFn: ({ signal }) => salesSeries(period.range, signal),
    // Today's column is still being written by tills that are still open.
    refetchInterval: 60_000,
  })

  // A second read rather than a wider response: a comparison is worth nothing
  // if it delays the number it qualifies, so the screen paints on the first and
  // fills the arrows in when the second lands.
  const priorRange: SalesRange = useMemo(
    () => ({
      from: comparison.from,
      to: comparison.to,
      bucket: period.bucket,
    }),
    [comparison.from, comparison.to, period.bucket]
  )
  const prior = useQuery({
    queryKey: analyticsKeys.series(priorRange),
    queryFn: ({ signal }) => salesSeries(priorRange, signal),
    // Nothing is still being written into a span that has already closed.
    staleTime: 5 * 60_000,
  })

  // Two matrices over one read. The shown one is narrowed to the chosen shop;
  // the fleet one keeps every shop, so the picker still lists the branches the
  // filter is currently hiding.
  const matrix = useMemo(
    () => buildMatrix(series.data, focus.value ?? null),
    [series.data, focus.value]
  )
  const fleet = useMemo(() => buildMatrix(series.data), [series.data])
  const before = useMemo(
    () =>
      prior.data === undefined
        ? undefined
        : buildMatrix(prior.data, focus.value ?? null),
    [prior.data, focus.value]
  )

  const focused = fleet.rows.find((site) => site.site_id === focus.value)

  /// What the open cell is called, said back to the reader — "Store 03 · Week
  /// of 24 Aug" rather than a pair of dates they have to recognise.
  ///
  /// Derived rather than carried in the URL: a title in the address bar is a
  /// caption somebody could edit into disagreeing with the figures under it.
  const cellTitle = useMemo(() => {
    if (cell.value === null) return ""
    // The whole-range cell says which range, in the same words the header
    // above it uses. "The whole span" on its own is a caption that names no
    // dates, and the sheet under it is a fortnight of somebody's takings.
    if (
      cell.value.from === matrix.buckets[0] &&
      cell.value.to >= period.range.to
    )
      return `${period.range.from} → ${period.range.to}`
    if (
      cell.value.from === comparison.from &&
      cell.value.to === comparison.to
    ) {
      return comparison.full
    }
    return bucketTitle(cell.value.from, period.bucket)
  }, [
    cell.value,
    matrix.buckets,
    period.range.from,
    period.range.to,
    period.bucket,
    comparison,
  ])

  return (
    <PageContent>
      <PageHeader
        title="Sales"
        sub={
          series.isPending
            ? "Adding up the tills…"
            : `${period.range.from} → ${period.range.to} · ${money(matrix.grandTotal("gross_minor"))}`
        }
      />

      {/* Which shop, then how wide a column, then how many of them, then what
          it is all measured against. Reading order matches the dependency: the
          span's options are decided by the bucket beside it. */}
      <Toolbar>
        <PickOne
          label="Shop"
          placeholder="All shops"
          choices={fleet.rows.map((site) => ({
            value: site.site_id,
            label: site.site_name,
          }))}
          value={focused?.site_id ?? null}
          onChange={(next) =>
            next === null ? focus.close() : focus.open(next)
          }
          className="w-44"
        />
        <Segmented
          options={BUCKETS}
          value={period.bucket}
          onChange={period.setBucket}
        />
        <ButtonGroup>
          {period.options.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === period.buckets}
              onClick={() => period.setBuckets(option)}
              className={
                option === period.buckets ? "bg-soft-2 text-ink!" : undefined
              }
            >
              {option}
            </button>
          ))}
        </ButtonGroup>
        <Toolbar.Spacer />
        <ComparisonPicker
          comparison={comparison}
          range={period.range}
          onChange={setComparison}
        />
      </Toolbar>

      {queryState(series, {
        loading: "Adding up the tills…",
        render: (fetched) =>
          fetched.sites.length === 0 ? (
            <Card>
              <EmptyState>
                No shop is registered, so there is nothing to have sold
                anything.
              </EmptyState>
            </Card>
          ) : (
            <>
              <SalesChart
                matrix={matrix}
                before={before}
                comparison={comparison}
                bucket={period.bucket}
                kind={kind}
                onKindChange={setKind}
              />
              <Card className="overflow-hidden p-0">
                <SalesTable
                  matrix={matrix}
                  before={before}
                  comparison={comparison}
                  bucket={period.bucket}
                  kind={kind}
                  onOpen={cell.open}
                  onFocus={(siteId) =>
                    siteId === focus.value ? focus.close() : focus.open(siteId)
                  }
                />
              </Card>
            </>
          ),
      })}

      <WindowSheet
        siteId={cell.value?.siteId ?? null}
        from={cell.value?.from ?? ""}
        to={cell.value?.to ?? ""}
        spanText={cellTitle}
        onClose={cell.close}
      />
    </PageContent>
  )
}

/// The cell the URL names.
///
/// One parameter carrying three things, because they are one thing: a cell is a
/// shop AND a span, and a URL that had two of the three open onto a question
/// nobody asked. Kept separate from `store` — that is the shop the screen is
/// narrowed to, and a reader looking at the whole fleet still opens one shop's
/// week.
function useCellSheet() {
  const sheet = useSheet("cell")
  const parts = sheet.value?.split("~") ?? []
  return {
    value:
      parts.length === 3
        ? { siteId: parts[0], from: parts[1], to: parts[2] }
        : null,
    open: (next: { siteId: string; from: string; to: string }) =>
      sheet.open(`${next.siteId}~${next.from}~${next.to}`),
    close: sheet.close,
  }
}

/// What the figures are measured against, held in the URL as three keys.
///
/// Written in one navigation rather than three: the mode and the two dates are
/// one decision, and setting them one at a time would put two half-made
/// comparisons in the history behind the reader.
function useComparison(range: SalesRange, buckets: number) {
  const search = useSearch({ strict: false }) as SheetSearch
  const navigate = useNavigate()

  const comparison: Comparison = useMemo(
    () =>
      comparisonOf(range, buckets, search.cmp ?? "prev", {
        from: search.cmpFrom,
        to: search.cmpTo,
      }),
    [range, buckets, search.cmp, search.cmpFrom, search.cmpTo]
  )

  return {
    comparison,
    setComparison: (next: {
      mode: ComparisonMode
      from?: string
      to?: string
    }) =>
      void navigate({
        to: ".",
        search: (prev: SheetSearch) => ({
          ...prev,
          cmp: next.mode === "prev" ? undefined : next.mode,
          cmpFrom: next.from,
          cmpTo: next.to,
        }),
        viewTransition: false,
      }),
  }
}
