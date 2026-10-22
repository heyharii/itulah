import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import type { ChartRow } from "@/components/ui/chart"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import type { ListColumn } from "@/components/ui/list-table"
import { OpenButton } from "@/components/ui/open-rows"
import { Pill } from "@/components/ui/pill"
import { KeyValue, TotalsLadder } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { articleId, count, moment, sku } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { useParam } from "@/lib/params"
import { queryState } from "@/lib/query-state"
import {
  fetchSeries,
  fetchWindow,
  lastDays,
  seriesKey,
  windowKey,
  type Bucket,
  type Receipt,
  type SalesSeries,
  type SalesWindow,
} from "@/lib/queries"
import { useReceipt } from "@/lib/till"
import { RunBars } from "@/screens/money/chart"
import {
  bucketTick,
  bucketTitle,
  spanWords,
  tenderOf,
} from "@/screens/money/format"
import {
  ChartCard,
  DeskBar,
  MoneyScreen,
  Rows,
  SheetSection,
  SpanPicker,
  SPANS,
  spanChoices,
} from "@/screens/money/parts"
import { money, units } from "@itulah/contract/money"

const BUCKETS: readonly { value: Bucket; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
]

/// How many receipts a phone draws before somebody asks for more — a thousand
/// cards in one list is a phone that stops scrolling.
const PAGE = 48

/// What this shop took, down to the receipt.
///
/// Read out of the shop's own SQLite, so it answers with the line to head
/// office down — which is the whole reason an edge node exists. A manager
/// closing up does not stop needing today's takings because a tunnel dropped.
///
/// Laid out as the hub reads a span: the figures, the run of the span beside
/// how it was paid, and the receipts under both — each of which opens in a
/// sheet with its lines and its approval codes, because that is the list a card
/// or QRIS match is done from. On a phone the span is the dock's status chip
/// and the grouping a row of its ⚙ sheet.
///
/// Thinner than the centre's report, and deliberately so: the edge `sale` row
/// has `total_minor`, `paid_minor` and `change_minor` and no tax to split them
/// into, and the node leaves voided sales out — so there are no returns and no
/// voids in these figures, and inventing either would be worse than saying so.
export function Reports() {
  const span = useParam("span")
  const bucket = useParam("bucket")
  // Any span the URL carries is honoured, not only the three buttons: a
  // manager who read ninety days on Sales and crossed over here is still
  // asking about ninety days.
  const days = Number(span.value ?? "1")
  const grouping: Bucket = bucket.value ?? "day"
  const range = lastDays(days)

  const takings = useQuery({
    queryKey: windowKey(range.from, range.to),
    queryFn: ({ signal }) => fetchWindow(range, signal),
    // A new range or grouping keeps the old figures up until its own arrive.
    placeholderData: keepPreviousData,
  })
  const series = useQuery({
    queryKey: seriesKey(range.from, range.to, grouping),
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      fetchSeries({ ...range, bucket: grouping }, signal),
    // A single day has one bar and nothing to compare it against.
    enabled: days > 1,
  })

  return (
    <MoneyScreen>
      <DockTools
        status={{
          value: String(days),
          options: spanChoices(String(days)),
          onChange: (next) => span.set(next),
        }}
        views={
          days > 1
            ? [
                {
                  title: "Group by",
                  value: grouping,
                  options: BUCKETS,
                  onChange: (next) => bucket.set(next as Bucket),
                },
              ]
            : undefined
        }
      />
      <DeskBar>
        <SpanPicker
          options={SPANS}
          value={(span.value ?? "1") as (typeof SPANS)[number]["value"]}
          onChange={(next) => span.set(next)}
        />
        <span className="text-meta text-mute tabular-nums">
          {days === 1
            ? `Today, ${spanWords(range.from, range.to)}`
            : `Last ${units(days)} days · ${spanWords(range.from, range.to)}`}
        </span>
      </DeskBar>

      {queryState(takings, {
        loading: "Reading the takings…",
        render: (report) => (
          <Report
            report={report}
            days={days}
            run={
              days > 1
                ? queryState(series, {
                    loading: "Reading the run…",
                    render: (answer) => (
                      <Run
                        run={answer}
                        grouping={grouping}
                        from={range.from}
                        to={range.to}
                        onGroup={(next) => bucket.set(next)}
                      />
                    ),
                  })
                : null
            }
          />
        ),
      })}
    </MoneyScreen>
  )
}

/// The span, laid out: figures, the run beside the tenders, the receipts.
///
/// On a desk the tenders stand in a column of their own beside the run and
/// the receipts; on anything narrower they come straight after the run, so a
/// phone reads "how much, how it moved, how it was paid" before it reaches two
/// hundred receipts.
function Report({
  report,
  days,
  run,
}: {
  report: SalesWindow
  days: number
  run: React.ReactNode
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [showing, setShowing] = useState(false)
  const sales = report.sales

  return (
    <>
      <KpiStrip>
        <Kpi
          label="Takings"
          value={money(sales.gross_minor)}
          delta={`${units(sales.count)} ${sales.count === 1 ? "sale" : "sales"}`}
        />
        <Kpi label="Average sale" value={money(sales.average_minor)} />
        <Kpi
          label="Items sold"
          value={units(sales.units_sold)}
          delta={
            sales.count === 0
              ? undefined
              : `${(sales.units_sold / sales.count).toLocaleString("id-ID", {
                  maximumFractionDigits: 1,
                })} a sale`
          }
        />
        <Kpi label="In the drawer" value={money(report.cash_expected_minor)} />
      </KpiStrip>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {run !== null && <div className="min-w-0 lg:col-start-1">{run}</div>}

        <div
          className={
            run === null
              ? "lg:col-start-2 lg:row-start-1 lg:self-start"
              : "lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start"
          }
        >
          <Tenders report={report} />
        </div>

        <div
          className={
            run === null
              ? "min-w-0 lg:col-start-1 lg:row-start-1"
              : "min-w-0 lg:col-start-1 lg:row-start-2"
          }
        >
          <Receipts
            report={report}
            days={days}
            onOpen={(id) => {
              setOpenId(id)
              setShowing(true)
            }}
          />
        </div>
      </div>

      <ReceiptSheet
        receipt={report.receipts.find((one) => one.id === openId) ?? null}
        open={showing}
        onClose={() => setShowing(false)}
      />
    </>
  )
}

/// The run of the span, as bars, with the busiest bucket written under it.
function Run({
  run,
  grouping,
  from,
  to,
  onGroup,
}: {
  run: SalesSeries
  grouping: Bucket
  from: string
  to: string
  onGroup: (next: Bucket) => void
}) {
  const cells = new Map(run.cells.map((cell) => [cell.bucket_start, cell]))
  const rows: readonly ChartRow[] = run.buckets.map((start) => ({
    bucket: start,
    takings: cells.get(start)?.gross_minor ?? 0,
  }))
  const busiest =
    run.cells.length === 0
      ? null
      : run.cells.reduce((best, cell) =>
          cell.gross_minor > best.gross_minor ? cell : best,
        )
  return (
    <ChartCard
      title={`Takings by ${grouping}`}
      sub={spanWords(from, to)}
      aside={
        <SpanPicker
          options={BUCKETS}
          value={grouping}
          onChange={onGroup}
          className="max-md:hidden"
        />
      }
      note={
        busiest === null
          ? "No sales in this period."
          : `Busiest: ${bucketTitle(busiest.bucket_start, grouping)} · ${money(busiest.gross_minor)}`
      }
    >
      <RunBars
        rows={rows}
        dataKey="takings"
        label="Takings"
        format={(value) => money(value)}
        labelOf={(start) => bucketTick(start, grouping)}
        titleOf={(start) => bucketTitle(start, grouping)}
        className="h-[13.75rem] md:h-[15rem]"
      />
    </ChartCard>
  )
}

/// How it was paid — each tender with its share of the takings, as numbers.
function Tenders({ report }: { report: SalesWindow }) {
  const taken = report.tenders.reduce(
    (sum, tender) => sum + tender.amount_minor,
    0,
  )
  const share = (amount: number) =>
    taken === 0 ? "—" : `${Math.round((amount / taken) * 100)}%`
  const columns: ListColumn<(typeof report.tenders)[number]>[] = [
    {
      id: "method",
      header: "Method",
      className: "min-w-[8rem]",
      cell: (tender) => {
        const kind = tenderOf(tender.method)
        return (
          <TwoLineTender
            icon={kind.icon}
            top={kind.word}
            under={`${units(tender.count)} ${tender.count === 1 ? "tender" : "tenders"} · ${share(tender.amount_minor)}`}
          />
        )
      },
    },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      cell: (tender) => (
        <span className="font-medium text-ink tabular-nums">
          {money(tender.amount_minor)}
        </span>
      ),
    },
  ]
  return (
    <Rows
      title="How it was paid"
      sub={`${units(report.tenders.reduce((sum, tender) => sum + tender.count, 0))} tenders`}
      aside={money(taken)}
      rows={report.tenders}
      columns={columns}
      rowKey={(tender) => tender.method}
      empty="Nothing taken."
      card={(tender) => {
        const kind = tenderOf(tender.method)
        return {
          title: kind.word,
          lead: {
            figure: money(tender.amount_minor),
            caption: share(tender.amount_minor),
          },
          foot: {
            info: `${units(tender.count)} ${tender.count === 1 ? "tender" : "tenders"}`,
          },
        }
      }}
    />
  )
}

/// A tender's name over what it was, with its glyph on a desk.
function TwoLineTender({
  icon: Glyph,
  top,
  under,
}: {
  icon: React.ComponentType<{ className?: string }>
  top: string
  under: string
}) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="grid size-[1.875rem] shrink-0 place-items-center rounded-inner bg-soft-2 text-body">
        <Glyph className="size-4 stroke-[1.7]" />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium text-ink">{top}</span>
        <span className="block truncate text-meta text-mute tabular-nums">
          {under}
        </span>
      </span>
    </span>
  )
}

/// The receipts, newest first — the hub's table on a desk, lead cards on a
/// phone — each one opening its sheet.
function Receipts({
  report,
  days,
  onOpen,
}: {
  report: SalesWindow
  days: number
  onOpen: (id: string) => void
}) {
  const phone = useLayout() === "phone"
  const [limit, setLimit] = useState(PAGE)
  const shown = phone ? report.receipts.slice(0, limit) : report.receipts
  return (
    <Rows
      title={
        report.receipts_truncated
          ? `Last ${units(report.receipts_limit)} receipts`
          : "Receipts"
      }
      aside={
        report.receipts.length === 0
          ? undefined
          : `${units(report.sales.count)} ${report.sales.count === 1 ? "sale" : "sales"}`
      }
      rows={shown}
      columns={RECEIPT_COLUMNS}
      rowKey={(receipt) => receipt.id}
      onOpen={(receipt) => onOpen(receipt.id)}
      empty={days === 1 ? "No sales today." : "No sales in this period."}
      card={(receipt) => ({
        title: moment(receipt.completed_at),
        code: receipt.id.slice(0, 8),
        lead: { figure: money(receipt.total_minor), caption: "total" },
        foot: { info: `${itemsWord(receipt)} · ${receipt.actor_id}` },
      })}
      foot={
        phone && report.receipts.length > limit ? (
          <div className="mt-4 flex justify-center">
            <Button onClick={() => setLimit((was) => was + PAGE)}>
              Show {count(Math.min(PAGE, report.receipts.length - limit))} more
            </Button>
          </div>
        ) : undefined
      }
    />
  )
}

const itemsWord = (receipt: Receipt) =>
  `${units(receipt.units)} ${receipt.units === 1 ? "item" : "items"} · ${units(
    receipt.line_count,
  )} ${receipt.line_count === 1 ? "line" : "lines"}`

const RECEIPT_COLUMNS: readonly ListColumn<Receipt>[] = [
  {
    id: "when",
    header: "When",
    cell: (receipt) => (
      <OpenButton
        id={receipt.id}
        label={`Receipt of ${money(receipt.total_minor)}, ${moment(receipt.completed_at)}`}
        className="font-medium text-ink tabular-nums"
      >
        {moment(receipt.completed_at)}
      </OpenButton>
    ),
  },
  {
    id: "sale",
    header: "Sale",
    className: "max-xl:hidden",
    cell: (receipt) => (
      <span className="font-mono text-id text-body">
        {receipt.id.slice(0, 8)}
      </span>
    ),
  },
  {
    id: "cashier",
    header: "Cashier",
    cell: (receipt) => receipt.actor_id,
  },
  {
    id: "items",
    header: "Items",
    className: "tabular-nums",
    cell: itemsWord,
  },
  {
    id: "change",
    header: "Change",
    align: "right",
    className: "tabular-nums max-lg:hidden",
    cell: (receipt) =>
      receipt.change_minor > 0 ? (
        money(receipt.change_minor)
      ) : (
        <span className="text-faint">—</span>
      ),
  },
  {
    id: "total",
    header: "Total",
    align: "right",
    cell: (receipt) => (
      <span className="font-medium text-ink tabular-nums">
        {money(receipt.total_minor)}
      </span>
    ),
  },
]

/// One receipt, as it was printed: the lines, what the promotions took off,
/// and how it was paid — with the approval code a card or QRIS tender carries,
/// which is what a bank match is done from.
///
/// The summary from the list is drawn at once; the lines arrive from the node's
/// own receipt document, the same one the printer is handed, so what this
/// sheet says is what the customer's paper says. Nothing sits in the foot: a
/// receipt is read, not acted on.
function ReceiptSheet({
  receipt,
  open,
  onClose,
}: {
  receipt: Receipt | null
  open: boolean
  onClose: () => void
}) {
  const printed = useReceipt(receipt?.id ?? null)
  if (receipt === null) return null

  const stamp = printed.data?.stamp ?? null
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={printed.data?.receipt_no ?? receipt.id.slice(0, 8)}
      title={money(receipt.total_minor)}
      caption={`${moment(receipt.completed_at)} · rung up by ${receipt.actor_id}`}
      badge={
        stamp === null ? (
          <Pill tone="ok">Completed</Pill>
        ) : (
          <Pill tone="bad">{stamp}</Pill>
        )
      }
    >
      <Facts>
        <Fact term="Paid">{money(receipt.paid_minor)}</Fact>
        <Fact term="Change given">
          {receipt.change_minor > 0 ? money(receipt.change_minor) : "—"}
        </Fact>
        <Fact term="Items">{itemsWord(receipt)}</Fact>
        <Fact term="Cashier">{receipt.actor_id}</Fact>
      </Facts>

      <div className="mt-6">
        {queryState(printed, {
          loading: "Reading the receipt…",
          render: (paper) => (
            <>
              <SheetSection
                title="Items"
                aside={`${units(paper.lines.length)} ${paper.lines.length === 1 ? "line" : "lines"}`}
              >
                <ul className="rounded-card border border-hairline">
                  {paper.lines.map((line, index) => (
                    <li
                      key={`${line.sku_code}-${index}`}
                      className="flex items-start justify-between gap-3 border-b border-hairline px-3.5 py-2.5 text-cell last:border-b-0"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">
                          {line.name}
                        </span>
                        <span className="block text-meta text-mute tabular-nums">
                          <span className="font-mono">
                            {articleId(null, line.sku_code)} · {sku(line.sku_code)}
                          </span>{" "}
                          ·{" "}
                          {units(line.quantity)} ×{" "}
                          {line.base_unit_price_minor !== null &&
                            line.base_unit_price_minor !==
                              line.unit_price_minor && (
                              <s className="mr-1">
                                {money(line.base_unit_price_minor)}
                              </s>
                            )}
                          {money(line.unit_price_minor)}
                        </span>
                      </span>
                      <span className="shrink-0 font-medium text-ink tabular-nums">
                        {money(line.line_total_minor)}
                      </span>
                    </li>
                  ))}
                </ul>
                <TotalsLadder
                  className="mt-3 border-t-0 pt-0"
                  rows={[
                    { label: "Subtotal", value: money(paper.subtotal_minor) },
                    ...(paper.discount_minor > 0
                      ? [
                          {
                            label: "Promotions",
                            value: `−${money(paper.discount_minor)}`,
                            tone: "bad" as const,
                          },
                        ]
                      : []),
                  ]}
                  total={{ label: "Total", value: money(paper.total_minor) }}
                />
              </SheetSection>

              <SheetSection title="How it was paid">
                <div className="rounded-card border border-hairline px-3.5 py-0.5">
                  {paper.tenders.map((tender, index) => {
                    const kind = tenderOf(tender.method)
                    return (
                      <KeyValue
                        key={`${tender.method}-${index}`}
                        term={
                          <span>
                            {kind.word}
                            {tender.reference !== null && (
                              <span className="ml-1.5 font-mono text-id text-body">
                                {tender.reference}
                              </span>
                            )}
                          </span>
                        }
                      >
                        {money(tender.amount_minor)}
                      </KeyValue>
                    )
                  })}
                  <KeyValue term="Change">
                    {paper.change_minor > 0 ? money(paper.change_minor) : "—"}
                  </KeyValue>
                  {paper.points_earned > 0 && (
                    <KeyValue term="Points earned">
                      {units(paper.points_earned)}
                    </KeyValue>
                  )}
                </div>
              </SheetSection>
            </>
          ),
        })}
      </div>
    </Sheet>
  )
}
