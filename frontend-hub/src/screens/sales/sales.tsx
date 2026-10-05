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
import { count, money } from "@/lib/format"
import { analyticsKeys, salesSeries } from "@/lib/queries/analytics"
import { queryState } from "@/lib/query-state"
import { useSheet, type SheetSearch } from "@/lib/sheets"
import { SalesChart } from "@/screens/sales/chart"
import { ComparisonPicker } from "@/screens/sales/comparison"
import { buildMatrix, type SalesKind } from "@/screens/sales/matrix"
import { usePeriod } from "@/screens/sales/period"
import { SaleSheet } from "@/screens/sales/sale-sheet"
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

/// What the shops sold, day by day, and which of them sold it.
///
/// Until this screen existed here the centre could publish a price and had no
/// way to ask what it earned. The day report answered that for one shop on one
/// day — a report you had to already know to ask for — and the receipts list
/// answered it for the last few hundred sales regardless of when or where.
/// Neither is the question head office actually has, which is **"how did the
/// fleet trade this month, and which branch is the reason"**.
///
/// So the screen is two halves of one answer, and both are read down the same
/// axis: a trading period. The chart is the fleet's line over those periods
/// with the span before it as a ghost; the table is one row per period carrying
/// every metric at once, unfolding into the shops that made it. They are the
/// same numbers, built from one index (`matrix.ts`) so they cannot disagree,
/// and one granularity drives both — two controls that could differ would put
/// two answers to one question on one screen.
///
/// **Everything a reader chooses is in the URL.** A span somebody narrowed
/// down, the shop they focused, the Ramadan they are comparing against and the
/// cell they opened are all things you send to a colleague, and a reload should
/// not throw any of them away. Two things are deliberately not: which measure
/// the line is drawn in, and which days are unfolded. Both are flipped several
/// times while reading one span, and neither is the question.
const BUCKETS: readonly { value: SalesBucket; label: string }[] =
  SALES_BUCKETS.map((bucket) => ({ value: bucket, label: bucket }))

export function Sales() {
  const period = usePeriod()
  // The shop the whole screen is narrowed to. `store` and not a second name
  // for a site id — see the note on it in `lib/sheets.ts`.
  const focus = useSheet("store")
  const cell = useCellSheet()
  /// One receipt, opened by `?sale=`. Mounted here since the register screen
  /// was removed (2026-09-13): a sale is still a record somebody links to from
  /// a return, from ⌘K and from the day sheet's own list, and a record with no
  /// screen to open on is a dangling link. It sits on Sales rather than on
  /// Shop floor because this is where the figure that prompted the question
  /// was read.
  const sale = useSheet("sale")
  const { comparison, setComparison } = useComparison(
    period.range,
    period.buckets
  )

  // Which of the five measures the line is drawn in. Deliberately NOT in the
  // URL: it changes what the chart *is* rather than what it is about, and a
  // reader flips it several times while reading one span. The span is the thing
  // worth sending.
  const [kind, setKind] = useState<SalesKind>("gross_minor")

  // The periods showing their shops. A set rather than one open row: comparing
  // last Saturday against this one means having both unfolded at once, and a
  // table that closed one to open the other would make that impossible.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const toggle = (start: string) =>
    setExpanded((open) => {
      const next = new Set(open)
      if (!next.delete(start)) next.add(start)
      return next
    })

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
            : `${period.range.from} → ${period.range.to} · ${money(matrix.grandTotal("gross_minor"))} over ${count(matrix.grandTotal("sales_count"))} transactions`
        }
      />

      {/* Which shop, then how wide a column, then how many of them, then what
          it is all measured against. Reading order matches the dependency: the
          span's options are decided by the bucket beside it. */}
      <Toolbar>
        <PickOne
          label="Shop"
          choices={fleet.rows.map((site) => ({
            value: site.site_id,
            label: site.site_name,
          }))}
          value={focused?.site_id ?? null}
          onChange={(next) =>
            next === null ? focus.close() : focus.open(next)
          }
          // Toolbar height, not form height — `<Segmented>` beside it is `h-8`,
          // and the picker's own default is the `h-9` a `<Field>` wants.
          className="min-h-8 w-44 px-2.5 text-[0.875rem]"
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
                  expanded={expanded}
                  onToggle={toggle}
                  onOpen={cell.open}
                  onFocus={(siteId) =>
                    siteId === focus.value ? focus.close() : focus.open(siteId)
                  }
                />
              </Card>
            </>
          ),
      })}

      <SaleSheet id={sale.value ?? null} onClose={sale.close} />

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
