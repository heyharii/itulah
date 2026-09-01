import { useQuery } from "@tanstack/react-query"
import {
  Banknote,
  Coins,
  CreditCard,
  QrCode,
  ReceiptText,
  ShoppingBag,
  Shirt,
  Wallet,
} from "lucide-react"

import { RecordCard } from "@/components/ui/card"
import { Kpi, KpiGrid } from "@/components/ui/kpi"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { CardList, Screen, Section } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
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
  type SalesSeries,
} from "@/lib/queries"
import { money, units } from "@itulah/contract/money"

const SPANS = [
  { value: "1", label: "Today" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
] as const

/// What this shop took.
///
/// Read out of the shop's own SQLite, so it answers with the line to head
/// office down — which is the whole reason an edge node exists. A manager
/// closing up does not stop needing today's takings because a tunnel dropped.
///
/// Thinner than the centre's report, and deliberately so: the edge `sale` row
/// has `total_minor`, `paid_minor` and `change_minor` and no tax to split them
/// into, and its status is `CHECK (status = 'COMPLETED')` — so there are no
/// returns and no voids here, and inventing either would be worse than saying
/// so.
export function Reports() {
  const span = useParam("span")
  const bucket = useParam("bucket")
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
    <Screen>
      <div className="pt-1 pb-4">
        <Segmented
          options={SPANS}
          value={(span.value ?? "1") as (typeof SPANS)[number]["value"]}
          onChange={(next) => span.set(next)}
        />
      </div>

      {queryState(takings, {
        loading: "Reading this shop's takings…",
        render: (report) => (
          <>
            <KpiGrid className="mb-5">
              <Kpi
                icon={<Coins />}
                tone="green"
                label="Takings"
                value={money(report.sales.gross_minor)}
              />
              <Kpi
                icon={<ShoppingBag />}
                tone="accent"
                label="Sales"
                value={units(report.sales.count)}
                sub={`${money(report.sales.average_minor)} average`}
              />
              <Kpi
                icon={<Shirt />}
                tone="sky"
                label="Items"
                value={units(report.sales.units_sold)}
              />
              <Kpi
                icon={<Banknote />}
                tone="orange"
                label="In the drawer"
                value={money(report.cash_expected_minor)}
                sub="cash, less change"
              />
            </KpiGrid>

            <Banner tone="info" className="mb-5">
              The drawer figure is cash only. Card and QRIS takings are settled
              through an acquirer and are not banknotes — counting them here
              would report a drawer short by exactly the day's card trade, every
              day, with the arithmetic looking perfect.
            </Banner>

            {report.tenders.length > 0 && (
              <Section title="How it was paid">
                <div className="rounded-card border border-hairline bg-canvas px-3.5 py-1 shadow-soft">
                  {report.tenders.map((tender) => (
                    <KeyValue
                      key={tender.method}
                      term={
                        <span className="flex items-center gap-2">
                          <span className="text-line-ico [&_svg]:size-4">
                            {TENDER_GLYPH[tender.method] ?? <Wallet />}
                          </span>
                          {TENDER_WORD[tender.method] ?? tender.method}
                          <span className="text-mute">
                            ×{units(tender.count)}
                          </span>
                        </span>
                      }
                    >
                      {money(tender.amount_minor)}
                    </KeyValue>
                  ))}
                </div>
              </Section>
            )}

            {days > 1 && (
              <Section
                title="Day by day"
                action={
                  <Segmented
                    className="w-auto"
                    options={[
                      { value: "day", label: "Day" },
                      { value: "week", label: "Week" },
                      { value: "month", label: "Month" },
                    ]}
                    value={grouping}
                    onChange={(next) => bucket.set(next)}
                  />
                }
              >
                {queryState(series, {
                  loading: "Reading the run of days…",
                  render: (run) => <Bars run={run} />,
                })}
              </Section>
            )}

            <Section
              title={
                report.receipts_truncated
                  ? `Last ${units(report.receipts_limit)} receipts`
                  : "Receipts"
              }
            >
              {report.receipts.length === 0 ? (
                <EmptyState>
                  {days === 1
                    ? "Nothing has been rung up today yet."
                    : "This shop recorded no sales in that span."}
                </EmptyState>
              ) : (
                <CardList>
                  {report.receipts.map((receipt) => (
                    <RecordCard
                      key={receipt.id}
                      icon={<ReceiptText />}
                      id={money(receipt.total_minor)}
                      status={
                        receipt.change_minor > 0 ? (
                          <Pill tone="neutral">
                            {money(receipt.change_minor)} change
                          </Pill>
                        ) : undefined
                      }
                    >
                      <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-meta text-mute">
                        <span className="tabular-nums">
                          {units(receipt.units)}{" "}
                          {receipt.units === 1 ? "item" : "items"} ·{" "}
                          {units(receipt.line_count)}{" "}
                          {receipt.line_count === 1 ? "line" : "lines"}
                        </span>
                        <span className="truncate">
                          {receipt.actor_id} · {moment(receipt.completed_at)}
                        </span>
                      </div>
                    </RecordCard>
                  ))}
                </CardList>
              )}
              {report.receipts_truncated && (
                <p className="mt-3 text-meta text-mute">
                  The totals above are computed over the whole span whatever
                  this list stops at, so a truncated list never makes the
                  summary lie.
                </p>
              )}
            </Section>
          </>
        ),
      })}
    </Screen>
  )
}

/// The run of days.
///
/// Thin bars on a faint track, `{accent}` because a primary series is indigo,
/// with the busiest bucket named. The chart grammar never simplifies on a phone
/// — it only narrows — so this is the same bar chart the console draws, laid
/// out as rows because a phone is taller than it is wide.
function Bars({ run }: { run: SalesSeries }) {
  const cells = new Map(run.cells.map((cell) => [cell.bucket_start, cell]))
  const peak = Math.max(
    1,
    ...run.buckets.map((day) => cells.get(day)?.gross_minor ?? 0),
  )
  return (
    <div className="rounded-card border border-hairline bg-canvas px-3.5 py-3 shadow-soft">
      {run.buckets.map((day) => {
        const cell = cells.get(day)
        const value = cell?.gross_minor ?? 0
        const share = value / peak
        return (
          <div key={day} className="flex items-center gap-3 py-1.5">
            <span className="w-16 shrink-0 text-meta text-mute tabular-nums">
              {day.slice(5)}
            </span>
            <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-soft-2">
              <span
                className={
                  value === peak
                    ? "block h-full rounded-full bg-accent"
                    : "block h-full rounded-full bg-accent/45"
                }
                style={{
                  width: `${Math.max(share * 100, value > 0 ? 2 : 0)}%`,
                }}
              />
            </span>
            <span className="w-24 shrink-0 text-right text-meta text-ink tabular-nums">
              {value === 0 ? "—" : money(value)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

const TENDER_GLYPH: Readonly<Record<string, React.ReactNode>> = {
  CASH: <Banknote />,
  CARD: <CreditCard />,
  QRIS: <QrCode />,
  OTHER: <Wallet />,
}

const TENDER_WORD: Readonly<Record<string, string>> = {
  CASH: "Cash",
  CARD: "Card",
  QRIS: "QRIS",
  OTHER: "Other",
}
