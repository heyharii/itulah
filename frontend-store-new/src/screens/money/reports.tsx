import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Card } from "@/components/ui/card"
import type { ChartRow } from "@/components/ui/chart"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { Meter } from "@/components/ui/meter"
import { OpenButton, OpenRows } from "@/components/ui/open-rows"
import { Pill } from "@/components/ui/pill"
import { RecordSheet } from "@/components/ui/record-sheet"
import { KeyValue, TotalsLadder } from "@/components/ui/rows"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { EmptyState } from "@/components/ui/states"
import { moment } from "@/lib/format"
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
  CardHead,
  Fact,
  Facts,
  MoneyScreen,
  Note,
  SheetBlock,
  SpanPicker,
  Toolbar,
} from "@/screens/money/parts"
import { money, units } from "@itulah/contract/money"

const SPANS = [
  { value: "1", label: "Today" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
] as const

type SpanOption = (typeof SPANS)[number]["value"]

const BUCKETS: readonly { value: Bucket; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
]

/// What this shop took, down to the receipt.
///
/// Read out of the shop's own SQLite, so it answers with the line to head
/// office down — which is the whole reason an edge node exists. A manager
/// closing up does not stop needing today's takings because a tunnel dropped.
///
/// Laid out as the hub reads a span: the figures in a strip, the run of the
/// span as bars beside how it was paid, and the receipts under both — each of
/// which opens in a sheet with its lines and its approval codes, because that
/// is the list a card or QRIS match is done from.
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
  })
  const series = useQuery({
    queryKey: seriesKey(range.from, range.to, grouping),
    queryFn: ({ signal }) =>
      fetchSeries({ ...range, bucket: grouping }, signal),
    // A single day has one bar and nothing to compare it against.
    enabled: days > 1,
  })

  return (
    <MoneyScreen sub="What this shop took, read from its own node — so it answers with the line to head office down.">
      <Toolbar>
        <SpanPicker
          options={SPANS}
          value={(span.value ?? "1") as SpanOption}
          onChange={(next) => span.set(next)}
        />
        <span className="text-meta text-mute tabular-nums">
          {days === 1
            ? `Today, ${spanWords(range.from, range.to)}`
            : `Last ${units(days)} days · ${spanWords(range.from, range.to)}`}
        </span>
      </Toolbar>

      {queryState(takings, {
        loading: "Reading this shop's takings…",
        render: (report) => (
          <Report
            report={report}
            days={days}
            run={
              days > 1 ? (
                <Card>
                  <CardHead
                    title={`Takings by ${grouping}`}
                    sub={spanWords(range.from, range.to)}
                    aside={
                      <SpanPicker
                        options={BUCKETS}
                        value={grouping}
                        onChange={(next) => bucket.set(next)}
                      />
                    }
                  />
                  {queryState(series, {
                    loading: "Reading the run of days…",
                    render: (answer) => (
                      <Run run={answer} grouping={grouping} />
                    ),
                  })}
                </Card>
              ) : null
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
      <StatStrip>
        <Stat
          label="Takings"
          value={money(sales.gross_minor)}
          sub={`${units(sales.count)} ${sales.count === 1 ? "sale" : "sales"}`}
        />
        <Stat
          label="Average sale"
          value={money(sales.average_minor)}
          sub="takings over sales"
        />
        <Stat
          label="Items sold"
          value={units(sales.units_sold)}
          sub={
            sales.count === 0
              ? undefined
              : `${(sales.units_sold / sales.count).toLocaleString("id-ID", {
                  maximumFractionDigits: 1,
                })} a sale`
          }
        />
        <Stat
          label="In the drawer"
          value={money(report.cash_expected_minor)}
          sub="cash taken, less change"
        />
      </StatStrip>

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

/// The run of the span, as bars, with the busiest bucket named under it.
function Run({ run, grouping }: { run: SalesSeries; grouping: Bucket }) {
  const cells = new Map(run.cells.map((cell) => [cell.bucket_start, cell]))
  const rows: readonly ChartRow[] = run.buckets.map((start) => ({
    bucket: start,
    takings: cells.get(start)?.gross_minor ?? 0,
  }))
  if (run.cells.length === 0) {
    return (
      <p className="px-4 py-12 text-center text-meta text-body">
        Nothing was sold in this span, so there is no run to draw.
      </p>
    )
  }
  const busiest = run.cells.reduce((best, cell) =>
    cell.gross_minor > best.gross_minor ? cell : best,
  )
  return (
    <div className="px-3 pt-3.5 pb-2">
      <RunBars
        rows={rows}
        dataKey="takings"
        label="Takings"
        format={(value) => money(value)}
        labelOf={(start) => bucketTick(start, grouping)}
        titleOf={(start) => bucketTitle(start, grouping)}
        className="h-[13.75rem] md:h-[15rem]"
      />
      <p className="px-1 pt-2 pb-1 text-meta text-mute">
        Busiest {grouping} was {bucketTitle(busiest.bucket_start, grouping)} at{" "}
        <span className="tabular-nums">{money(busiest.gross_minor)}</span>.
      </p>
    </div>
  )
}

/// How it was paid — each tender with its share of the takings.
///
/// The drawer figure's caveat lives here, beside the tenders it is about,
/// rather than in a banner across the page: it is a footnote to one number,
/// not news.
function Tenders({ report }: { report: SalesWindow }) {
  const taken = report.tenders.reduce(
    (sum, tender) => sum + tender.amount_minor,
    0,
  )
  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft">
      <CardHead
        title="How it was paid"
        sub={`${units(report.tenders.reduce((sum, tender) => sum + tender.count, 0))} tenders`}
      />
      {report.tenders.length === 0 ? (
        <p className="px-4 py-8 text-center text-meta text-body">
          Nothing taken in this span.
        </p>
      ) : (
        <ul className="px-4 py-1">
          {report.tenders.map((tender) => {
            const kind = tenderOf(tender.method)
            const Glyph = kind.icon
            return (
              <li
                key={tender.method}
                className="border-b border-hairline py-3 last:border-b-0"
              >
                <div className="flex items-center gap-2.5 text-cell">
                  <span className="grid size-[1.875rem] shrink-0 place-items-center rounded-inner bg-soft-2 text-body">
                    <Glyph className="size-4 stroke-[1.7]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">
                      {kind.word}
                    </span>
                    <span className="block text-meta text-mute tabular-nums">
                      {units(tender.count)}{" "}
                      {tender.count === 1 ? "tender" : "tenders"} ·{" "}
                      {taken === 0
                        ? "—"
                        : `${Math.round((tender.amount_minor / taken) * 100)}%`}
                    </span>
                  </span>
                  <span className="font-medium text-ink tabular-nums">
                    {money(tender.amount_minor)}
                  </span>
                </div>
                <Meter
                  className="mt-2"
                  value={taken === 0 ? 0 : tender.amount_minor / taken}
                />
              </li>
            )
          })}
        </ul>
      )}
      <p className="border-t border-hairline bg-soft px-4 py-3 text-meta leading-relaxed text-body">
        <span className="font-medium text-ink">In the drawer</span> is cash
        only. Card and QRIS takings are settled through an acquirer and are not
        banknotes — counting them there would report a drawer short by exactly
        the day&rsquo;s card trade, every day, with the arithmetic looking
        perfect.
      </p>
    </div>
  )
}

/// The receipts, newest first — a table on a desk, card rows on a phone —
/// each one opening its sheet.
function Receipts({
  report,
  days,
  onOpen,
}: {
  report: SalesWindow
  days: number
  onOpen: (id: string) => void
}) {
  return (
    <>
      <Card>
        <CardHead
          title={
            report.receipts_truncated
              ? `Last ${units(report.receipts_limit)} receipts`
              : "Receipts"
          }
          sub={
            report.receipts.length === 0
              ? undefined
              : `${units(report.sales.count)} in this span · press one to read it`
          }
        />
        {report.receipts.length === 0 ? (
          <EmptyState>
            {days === 1
              ? "Nothing has been rung up today yet."
              : "This shop recorded no sales in that span."}
          </EmptyState>
        ) : (
          <OpenRows onOpen={onOpen}>
            <ListTable
              rows={report.receipts}
              columns={RECEIPT_COLUMNS}
              rowKey={(receipt) => receipt.id}
              empty="No receipt in this span."
            />
          </OpenRows>
        )}
      </Card>
      {report.receipts_truncated && (
        <Note>
          The figures above are computed over the whole span whatever this list
          stops at, so a truncated list never makes the summary lie.
        </Note>
      )}
    </>
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
    card: "hide",
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
    card: "hide",
    cell: (receipt) => receipt.actor_id,
  },
  {
    id: "items",
    header: "Items",
    card: "hide",
    className: "tabular-nums",
    cell: itemsWord,
  },
  {
    id: "change",
    header: "Change",
    align: "right",
    card: "hide",
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
    card: "status",
    cell: (receipt) => (
      <span className="font-medium text-ink tabular-nums">
        {money(receipt.total_minor)}
      </span>
    ),
  },
  {
    // The phone's line of context: on a desk these have columns.
    id: "summary",
    header: "",
    card: "meta",
    className: "hidden",
    cell: (receipt) =>
      `${itemsWord(receipt)} · ${receipt.actor_id}${
        receipt.change_minor > 0
          ? ` · ${money(receipt.change_minor)} change`
          : ""
      }`,
  },
]

/// One receipt, as it was printed: the lines, what the promotions took off,
/// and how it was paid — with the approval code a card or QRIS tender carries,
/// which is what a bank match is done from.
///
/// The summary from the list is drawn at once; the lines arrive from the node's
/// own receipt document, the same one the printer is handed, so what this
/// sheet says is what the customer's paper says.
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
    <RecordSheet
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
              <SheetBlock
                title="What was sold"
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
                          <span className="font-mono">{line.sku_code}</span> ·{" "}
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
              </SheetBlock>

              <SheetBlock title="How it was paid">
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
              </SheetBlock>
            </>
          ),
        })}
      </div>
    </RecordSheet>
  )
}
