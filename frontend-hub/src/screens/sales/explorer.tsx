import {
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { useLocation } from "@tanstack/react-router"
import type { ExplorerRow } from "@itulah/contract"
import { ChevronRight } from "lucide-react"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { ExportButton } from "@/components/ui/export-button"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { RefreshStamp } from "@/components/ui/refresh-stamp"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { today } from "@/lib/calendar"
import { fileSafe, type ExportSheet } from "@/lib/export-xlsx"
import {
  count,
  day,
  decimal,
  money,
  moneyCompact,
  percent,
  quantity,
} from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"
import {
  ExportTool,
  FilterSheet,
  PeriodBar,
  PeriodSheet,
  PhoneDock,
  Applied,
  Tools,
  type Update,
} from "@/screens/sales/explorer-controls"
import {
  explorerOptionsQuery,
  explorerRowsQuery,
  type ExplorerQuery,
  type SalesExplorer,
} from "@/screens/sales/explorer-data"
import { DetailSheet } from "@/screens/sales/explorer-detail"
import { exportSheet } from "@/screens/sales/explorer-export"
import {
  DeskGrid,
  PhoneGrid,
  type GridProps,
} from "@/screens/sales/explorer-grid"
import {
  anchorDay,
  DRILL,
  drillInto,
  groupLabel,
  groupOfPage,
  labelOf,
  marginOf,
  monthColumns,
  noun,
  pageTitle,
  perReceipt,
  periodLabel,
  receiptsOf,
  resolvePeriod,
  rangeOf,
  storeColumns,
  unwind,
  VIEW_LABEL,
  viewOf,
  viewsOf,
  type ExplorerState,
  type GroupKey,
  type MatrixColumn,
} from "@/screens/sales/explorer-model"
import { useExplorerState } from "@/screens/sales/explorer-state"

/// **Sales** — one page per grouping, each a row of the department's sidebar
/// (owner, 16 Oct 2026, `sales-sidebar-tabs-prototype.html` A · Views; before,
/// one page with the groupings as a row of pills).
///
/// The totals over the top, then the tabs — Totals · Per store · Per month —
/// and, in a card, the rows. Totals reads each row once; Per store lays every
/// store beside it and Per month every month of the period, with the Totals
/// pinned at the right and the columns tinted against each other. Summary is
/// time itself, its tabs the months and the days. A division, a tag, a store or
/// a supplier is stepped into (the way back is above the rows, on the page of
/// the rows it lands on); an article or a SKU opens its sheet; a month or a day
/// narrows the period.
///
/// `GET /api/v1/reports/sales/explorer`, a hundred rows a page as the table
/// scrolls. Every figure is the server's: the browser only divides one by
/// another for the rates, and the total row is the server's `total`, never the
/// rows added up (by tag the rows overlap).

/// The groupings whose rows say how many articles they hold. Off: on a year by
/// division the count costs the server a second pass, so a division's quiet
/// line stays empty until this is switched on.
const ARTICLE_COUNTS: ReadonlySet<GroupKey> = new Set()

export function SalesExplorer() {
  const phone = useLayout() === "phone"
  const pathname = useLocation({ select: (location) => location.pathname })
  const group = groupOfPage(pathname)
  // The title stands at once; the figures, the controls and the rows wait for
  // the days there are sales for and the first page of the default view, and
  // stream in with them (the server starts both reads too).
  return (
    <PageContent fill={!phone}>
      {/* The page head, like every list's. On a phone the top bar already says
          the page, so only the line under it stays: what period and how many
          stores are on screen, with the reload in the dock. A desk has that
          line at the foot of the results card, and the period beside the
          search in the one bar over the rows. */}
      <PageHeader title={group === null ? "Sales" : pageTitle(group)} />
      <Suspense fallback={<LoadingState>Adding up the sales…</LoadingState>}>
        <ExplorerBody />
      </Suspense>
    </PageContent>
  )
}

function ExplorerBody() {
  const layout = useLayout()
  const phone = layout === "phone"
  const tablet = layout === "tablet"
  const { state, q, update, setQuery } = useExplorerState()
  const options = useSuspenseQuery(explorerOptionsQuery())
  const [filterOpen, setFilterOpen] = useState(false)
  const [periodOpen, setPeriodOpen] = useState(false)
  const [open, setOpen] = useState<ExplorerRow | null>(null)

  // -- the question ----------------------------------------------------------
  const latest = options.data.latest_day ?? null
  const earliest = options.data.earliest_day ?? null
  const now = today()
  const range = useMemo(
    () => resolvePeriod(state.period, now, latest, earliest),
    [state.period, now, latest, earliest]
  )
  // The tab: Totals, Per store or Per month, where the page has them.
  const view = viewOf(state)
  const stores = view === "stores"
  const months = view === "months"
  const query = useMemo<ExplorerQuery>(
    () => ({
      from: range.from,
      to: range.to,
      group: state.group,
      stores: state.stores,
      divisions: state.divisions,
      suppliers: state.suppliers,
      tags: state.tags,
      colours: state.colours,
      sizes: state.sizes,
      q,
      matrix: stores,
      months,
      articles: ARTICLE_COUNTS.has(state.group),
    }),
    [range, state, q, stores, months]
  )
  // The table under a new question stays as it was until the answer comes: a
  // search typed one letter at a time must not blank the screen. The deferred
  // question keeps the rows in hand on screen while the next are read.
  const asked = useDeferredValue(query)
  const stale = asked !== query
  const rows = useSuspenseInfiniteQuery(explorerRowsQuery(asked))
  const pages = rows.data.pages
  const head = pages[0]
  const all = useMemo(() => pages.flatMap((page) => page.rows), [pages])

  // The rows still on screen came from a question that did not ask for the
  // stores or the months (the totals'), and the table beside them cannot be
  // drawn from them: say so rather than draw a grid of dashes. Asked the other
  // way (stores, now months) the cells are the wrong ones: the same.
  const laidOut = view !== "totals"
  const awaitingCells =
    stale && laidOut && (asked.matrix !== stores || asked.months !== months)
  // The stores, or the months of the period, beside the rows.
  const columns = useMemo<readonly MatrixColumn[]>(
    () =>
      months ? monthColumns(range) : stores ? storeColumns(head.stores) : [],
    [months, stores, range, head.stores]
  )

  const canCost = head.can_see_cost ?? options.data.can_see_cost ?? true
  const customRange = rangeOf(state.period) !== null

  // -- what pressing does ----------------------------------------------------
  const onOpen = (row: ExplorerRow) => {
    const filter = DRILL[state.group]
    const label = labelOf(state.group, row)
    // A row with no key (Unclassified, No supplier) has nothing to narrow to.
    if (filter !== undefined && row.key !== "")
      return update((s) => drillInto(s, filter, row.key, label), true, "")
    if (state.group === "article" || state.group === "sku") setOpen(row)
  }

  // -- drawing ---------------------------------------------------------------
  const total = head?.rows_total ?? 0
  const loaded = all.length
  const rowsText =
    loaded < total
      ? `${count(loaded)} of ${count(total)} ${noun(state.group, total)}`
      : `${count(total)} ${noun(state.group, total)}`

  const build = (): ExportSheet | null => {
    if (head === undefined || range === null) return null
    return exportSheet({
      head,
      rows: all,
      group: state.group,
      view,
      columns,
      canCost,
      subtitle: periodLabel(range),
      filename: `Sales-by-${fileSafe(groupLabel(state.group))}${
        laidOut ? `-${fileSafe(VIEW_LABEL[view])}` : ""
      }-${range.from}-${range.to}`,
    })
  }
  const nothingToExport = head === undefined || all.length === 0

  const bounds = {
    min: earliest ?? "2000-01-01",
    max: latest ?? now,
    anchor: anchorDay(now, latest),
  }
  const quiet =
    head !== undefined && range !== null ? (
      <>
        {periodLabel(range)} · {count(head.stores.length)}{" "}
        {head.stores.length === 1 ? "store" : "stores"}
        {head.pending_days > 0 && " · Updating"}
      </>
    ) : null

  const grid: GridProps = {
    head,
    rows: all,
    group: state.group,
    view,
    columns,
    heat: state.heat,
    canCost,
    more: rows,
    onOpen,
  }

  // What is under the tools: the rows, or the sentence for when there are none.
  const body = awaitingCells ? (
    <LoadingState>Adding up the sales…</LoadingState>
  ) : all.length === 0 ? (
    <EmptyState>
      {emptyText({
        searching: q.trim() !== "",
        from: range?.from ?? "",
        to: range?.to ?? "",
        latest,
        earliest: head.earliest_day,
      })}
    </EmptyState>
  ) : phone ? (
    <PhoneGrid {...grid} />
  ) : (
    <DeskGrid {...grid} />
  )

  const filterSheet = (
    <FilterSheet
      open={filterOpen}
      onOpenChange={setFilterOpen}
      state={state}
      update={update}
      options={options.data}
      total={total}
      phone={phone}
      exporter={
        <ExportButton
          build={build}
          variant="ghost"
          disabled={nothingToExport}
        />
      }
    />
  )

  return (
    <>
      {phone && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3">
          <p className="min-h-5 text-[0.9375rem] text-mute tabular-nums">
            {quiet}
          </p>
          <RefreshStamp queries={[options, rows]} />
        </div>
      )}

      {head !== undefined && (
        <Strip head={head} canCost={canCost} phone={phone} />
      )}

      <PageTabs state={state} update={update} />

      {phone ? (
        <>
          <div className="mt-1 mb-3 flex items-center gap-2">
            <b className="text-[0.9375rem] font-semibold text-ink">
              {groupLabel(state.group)}
            </b>
            <span className="text-[0.9375rem] text-mute tabular-nums">
              {head === undefined ? "" : rowsText}
            </span>
          </div>
          <Applied state={state} update={update} options={options.data} />
          <Crumbs state={state} update={update} phone />
          <div
            className={cn(
              "transition-opacity duration-150 ease-out",
              stale && "opacity-60"
            )}
          >
            {head !== undefined && all.length === 0 ? (
              <Card>{body}</Card>
            ) : (
              body
            )}
          </div>
        </>
      ) : (
        <Card className="flex min-h-[20rem] flex-1 flex-col overflow-hidden">
          <Tools
            q={q}
            setQuery={setQuery}
            state={state}
            update={update}
            onOpenFilter={() => setFilterOpen(true)}
            // The period joins the bar: one row over the rows, not one beside
            // the title and another over the card.
            refresh={
              <>
                {range !== null && (
                  <PeriodBar
                    state={state}
                    update={update}
                    range={range}
                    bounds={bounds}
                  />
                )}
                <RefreshStamp queries={[options, rows]} />
              </>
            }
            exporter={
              <ExportTool
                build={build}
                disabled={nothingToExport}
                iconOnly={tablet}
              />
            }
          />
          <Applied state={state} update={update} options={options.data} />
          <Crumbs state={state} update={update} />
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col transition-opacity duration-150 ease-out",
              stale && "opacity-60"
            )}
          >
            {body}
          </div>
          {head !== undefined && (
            <div className="flex shrink-0 items-center gap-3 border-t border-hairline px-4 py-3 text-[0.9375rem] text-mute tabular-nums">
              <span>{rowsText}</span>
              {quiet !== null && <span>{quiet}</span>}
              {laidOut && state.heat && (
                <span className="inline-flex items-center gap-1.5">
                  · Lowest {months ? "month" : "store"}
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-[4.5rem] rounded-full"
                    style={{
                      background:
                        "linear-gradient(90deg, color-mix(in srgb, var(--accent) 4%, transparent), color-mix(in srgb, var(--accent) 32%, transparent))",
                    }}
                  />
                  highest {months ? "month" : "store"}, per row
                </span>
              )}
            </div>
          )}
        </Card>
      )}

      {phone && range !== null && (
        <>
          <PhoneDock
            q={q}
            onQuery={setQuery}
            state={state}
            periodText={periodLabel(range)}
            custom={customRange}
            onOpenFilter={() => setFilterOpen(true)}
            onOpenPeriod={() => setPeriodOpen(true)}
          />
          <PeriodSheet
            open={periodOpen}
            onOpenChange={setPeriodOpen}
            state={state}
            update={update}
            range={range}
            bounds={bounds}
          />
        </>
      )}

      {filterSheet}
      {query !== null && head !== undefined && (
        <DetailSheet
          row={open}
          group={state.group}
          base={query}
          canCost={canCost}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  )
}

/// The page's tabs: Totals · Per store · Per month (owner, 16 Oct 2026). A page
/// read only one way has none. On a phone they are the dock's status button
/// (`SubTabs`).
function PageTabs({ state, update }: { state: ExplorerState; update: Update }) {
  const views = viewsOf(state.group)
  if (views.length === 0) return null
  return (
    <SubTabs
      tabs={views.map((one) => ({ value: one, label: VIEW_LABEL[one] }))}
      value={viewOf(state)}
      onChange={(next) =>
        update((s) => ({ ...s, view: next as ExplorerState["view"] }), true)
      }
    />
  )
}

/// A few quiet words under a figure, in the quiet colour and not bold, cut
/// short rather than wrapped, with the whole of it as the tooltip.
function Sub({ children, title }: { children: string; title?: string }) {
  return (
    <span
      title={title ?? children}
      className="block min-w-0 truncate font-normal"
    >
      {children}
    </span>
  )
}

/// The totals, first: how many receipts, how many pieces, what they fetched,
/// what the pieces cost, what is left over and what is on the shelves. One word,
/// Sales: it is what was charged after discounts and returns. Receipts are
/// counted only while no item filter is on; with one, the figures that need
/// them are a dash.
function Strip({
  head,
  canCost,
  phone,
}: {
  head: SalesExplorer
  canCost: boolean
  phone: boolean
}) {
  const t = head.total
  const receipts = receiptsOf(t)
  const voided = t.voided_receipts ?? null
  const average = perReceipt(t)
  const margin = marginOf(t)
  const compact = (minor: number | null) =>
    minor === null ? (
      "—"
    ) : (
      <span title={money(minor)}>{moneyCompact(minor)}</span>
    )
  return (
    <KpiStrip className={cn(phone && "mb-3")}>
      <Kpi
        label="Transactions"
        value={receipts === null ? "—" : count(receipts)}
        delta={
          voided !== null && voided > 0 ? (
            <Sub
              title={
                t.voided_minor == null
                  ? undefined
                  : `${count(voided)} voided · ${money(t.voided_minor)} charged`
              }
            >
              {`${count(voided)} voided`}
            </Sub>
          ) : undefined
        }
        tone="flat"
      />
      <Kpi
        label="Sold"
        value={quantity(t.qty)}
        delta={
          receipts === null || receipts === 0 ? undefined : (
            <Sub>{`${decimal(t.qty / receipts, 1)} pcs each`}</Sub>
          )
        }
        tone="flat"
      />
      <Kpi
        label="Sales"
        value={compact(t.sales_minor)}
        delta={
          <Sub>
            {`${moneyCompact(t.discount_minor)} discount${
              average === null ? "" : ` · avg ${moneyCompact(average)}`
            }`}
          </Sub>
        }
        tone="flat"
      />
      {canCost && t.cost_minor !== null && (
        <Kpi
          label="COGS"
          value={compact(t.cost_minor)}
          delta={
            t.uncosted_qty > 0 ? (
              <Sub>{`${quantity(t.uncosted_qty)} without cost`}</Sub>
            ) : t.sales_minor === 0 ? undefined : (
              <Sub>
                {`${percent((t.cost_minor / t.sales_minor) * 100, { digits: 1 })} of sales`}
              </Sub>
            )
          }
          tone="flat"
        />
      )}
      {canCost && (
        <Kpi
          label="Gross profit"
          value={compact(t.profit_minor)}
          delta={
            margin === null ? undefined : (
              <Sub>{`${percent(margin, { digits: 1 })} margin`}</Sub>
            )
          }
          tone="flat"
        />
      )}
      <Kpi
        label="Stock"
        value={t.stock === null ? "—" : quantity(t.stock)}
        delta={
          canCost && t.stock_cost_minor !== null ? (
            <Sub>{`worth ${moneyCompact(t.stock_cost_minor)}`}</Sub>
          ) : undefined
        }
        tone="flat"
      />
    </KpiStrip>
  )
}

/// The way back up from a drill: "All divisions › Womenswear", each step a
/// button but the one you are on.
function Crumbs({
  state,
  update,
  phone = false,
}: {
  state: ExplorerState
  update: Update
  phone?: boolean
}) {
  const crumbs = state.crumbs
  if (crumbs.length === 0) return null
  const root = crumbs[0].group
  const step =
    "rounded-inner font-medium text-accent transition-[opacity,scale] duration-(--t-press) ease-(--ease-out) hover:opacity-80 active:scale-[0.97]"
  return (
    <nav
      aria-label="Where you are"
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-1.5 text-[0.9375rem] text-mute",
        phone
          ? "mb-3 rounded-card border border-hairline bg-canvas px-4 py-2.5"
          : "border-b border-hairline px-4 py-2.5"
      )}
    >
      <button
        type="button"
        onClick={() => update((s) => unwind(s, 0), true, "")}
        className={step}
      >
        All {noun(root, 2)}
      </button>
      {crumbs.map((crumb, index) => (
        <span key={index} className="inline-flex items-center gap-1.5">
          <ChevronRight aria-hidden className="size-4 text-line-ico" />
          {index < crumbs.length - 1 ? (
            <button
              type="button"
              onClick={() => update((s) => unwind(s, index + 1), true, "")}
              className={step}
            >
              {crumb.label}
            </button>
          ) : (
            <span className="text-ink">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

/// What the table says when it has no rows.
function emptyText({
  searching,
  from,
  to,
  latest,
  earliest,
}: {
  searching: boolean
  from: string
  to: string
  latest: string | null
  earliest: string | null
}): string {
  if (searching) return "No match."
  const outside =
    latest !== null && (from > latest || (earliest !== null && to < earliest))
  if (outside)
    return `Nothing sold in this period. The latest sales day is ${day(latest)}.`
  return "Nothing sold in this period."
}
