import { useSuspenseQuery } from "@tanstack/react-query"
import { Suspense, useMemo } from "react"

import { Card } from "@/components/ui/card"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { count, money } from "@/lib/format"
import { type CampaignPerformance } from "@/lib/queries/commercial-performance"
import {
  memberSegmentsQuery,
  SEGMENT_ORDER,
  type SegmentKey,
  type SegmentRow,
} from "@/lib/queries/members"
import {
  CardTable,
  field,
  type CardShape,
} from "@/screens/executive/card-table"
import { rupiah } from "@/screens/executive/format"
import { Figure, Figures, Head, ReportPage } from "@/screens/executive/parts"
import { campaignsQuery, vouchersPeekQuery } from "@/screens/executive/data"
import { useReportScope, type ReportScope } from "@/screens/executive/scope"

/// Customers & Promotions — who the members are and how they are spending, what
/// the vouchers in circulation are worth, and what each campaign gave away.

const SEGMENT: Record<SegmentKey, string> = {
  NEW: "New",
  ACTIVE: "Active",
  LAPSING: "Lapsing",
  LAPSED: "Lapsed",
  NEVER: "Never bought",
  BLOCKED: "Stopped",
}

const segmentKey = (row: SegmentRow) => row.key

const SEGMENT_COLUMNS = [
  field<SegmentRow>("segment", "Segment", (row) => (
    <span className="font-medium text-ink">{SEGMENT[row.key]}</span>
  )),
  field<SegmentRow>("members", "Members", (row) => count(row.members), {
    right: true,
    by: (row) => row.members,
  }),
  field<SegmentRow>(
    "spent",
    "Spent",
    (row) => (
      <span title={money(row.spent_minor)}>{rupiah(row.spent_minor)}</span>
    ),
    { right: true, by: (row) => row.spent_minor, priority: 3 }
  ),
  field<SegmentRow>(
    "average",
    "Average",
    (row) => (row.members === 0 ? "—" : rupiah(row.average_spend_minor)),
    { right: true, by: (row) => row.average_spend_minor, priority: 2 }
  ),
]

/// A phone's card: the segment, how many members, and what they spent.
const SEGMENT_CARD: CardShape<SegmentRow> = {
  lead: (row) => ({
    value: count(row.members),
    caption: row.members === 1 ? "member" : "members",
    tone: row.members === 0 ? "quiet" : undefined,
  }),
  foot: (row) =>
    row.members === 0
      ? "Nobody"
      : `Spent ${rupiah(row.spent_minor)} · average ${rupiah(row.average_spend_minor)}`,
}

const campaignKey = (row: CampaignPerformance) => row.campaign_id

const CAMPAIGN_COLUMNS = [
  field<CampaignPerformance>("campaign", "Campaign", (row) => (
    <span className="font-medium text-ink">{row.name ?? row.campaign_id}</span>
  )),
  field<CampaignPerformance>(
    "transactions",
    "Transactions",
    (row) => count(row.sale_count),
    { right: true, by: (row) => row.sale_count, priority: 2 }
  ),
  field<CampaignPerformance>(
    "sales",
    "Sales",
    (row) => (
      <span title={money(row.basket_revenue_minor)}>
        {rupiah(row.basket_revenue_minor)}
      </span>
    ),
    { right: true, by: (row) => row.basket_revenue_minor }
  ),
  field<CampaignPerformance>(
    "discount",
    "Discount",
    (row) => (
      <span title={money(row.benefit_minor)}>{rupiah(row.benefit_minor)}</span>
    ),
    { right: true, by: (row) => row.benefit_minor }
  ),
]

/// A phone's card: the campaign, what it sold, and what it gave away.
const CAMPAIGN_CARD: CardShape<CampaignPerformance> = {
  lead: (row) => ({
    value: (
      <span title={money(row.basket_revenue_minor)}>
        {rupiah(row.basket_revenue_minor)}
      </span>
    ),
    caption: "sales",
  }),
  foot: (row) =>
    `${count(row.sale_count)} ${row.sale_count === 1 ? "transaction" : "transactions"} · discount ${rupiah(row.benefit_minor)}`,
}

/// The campaigns that sold something or gave something away in the report's
/// span, biggest sales first. Read inside a `<Suspense>`.
function useRunning(scope: ReportScope) {
  const campaigns = useSuspenseQuery(campaignsQuery(scope))
  return useMemo(
    () =>
      [...campaigns.data.campaigns]
        .filter((row) => row.sale_count > 0 || row.benefit_minor > 0)
        .sort((a, b) => b.basket_revenue_minor - a.basket_revenue_minor),
    [campaigns.data]
  )
}

export function ExecutiveCustomers() {
  const scope = useReportScope()

  return (
    <ReportPage title="Customers & Promotions" scope={scope}>
      <Figures>
        <Suspense
          fallback={
            <>
              <Figure label="Registered members" value="…" />
              <Figure label="Active members" value="…" />
            </>
          }
        >
          <MemberFigures />
        </Suspense>
        <Suspense fallback={<Figure label="Vouchers outstanding" value="…" />}>
          <VoucherFigure />
        </Suspense>
        <Suspense
          fallback={
            <Figure
              label="Campaigns running"
              value="…"
              note="Producing sales this period"
            />
          }
        >
          <CampaignFigure scope={scope} />
        </Suspense>
      </Figures>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          <Head
            title="Member segments"
            to="/members/segments"
            link="Open members"
          />
          <Suspense
            fallback={<LoadingState>Reading the members…</LoadingState>}
          >
            <SegmentTable />
          </Suspense>
        </Card>

        <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          <Head
            title="Promotion campaigns"
            to="/commercial"
            link="Open Marketing"
          />
          <Suspense
            fallback={<LoadingState>Reading the promotions…</LoadingState>}
          >
            <CampaignTable scope={scope} />
          </Suspense>
        </Card>
      </div>
    </ReportPage>
  )
}

/// Everybody holding a card, and how many of them bought lately.
function MemberFigures() {
  const { data: book } = useSuspenseQuery(memberSegmentsQuery())
  const active = book.segments
    .filter((row) => row.key === "ACTIVE" || row.key === "NEW")
    .reduce((sum, row) => sum + row.members, 0)
  return (
    <>
      <Figure label="Registered members" value={count(book.member_count)} />
      <Figure
        label="Active members"
        value={count(active)}
        note={`Bought within the last ${book.active_days} days`}
      />
    </>
  )
}

/// What the vouchers in circulation are worth.
function VoucherFigure() {
  const { data: vouchers } = useSuspenseQuery(vouchersPeekQuery())
  return (
    <Figure
      label="Vouchers outstanding"
      value={rupiah(vouchers.ledger.outstanding_minor)}
      note={`${count(vouchers.ledger.outstanding_count)} ${vouchers.ledger.outstanding_count === 1 ? "voucher" : "vouchers"}`}
    />
  )
}

/// How many campaigns produced sales in the period.
function CampaignFigure({ scope }: { scope: ReportScope }) {
  const running = useRunning(scope)
  return (
    <Figure
      label="Campaigns running"
      value={count(running.length)}
      note="Producing sales this period"
    />
  )
}

/// The six segments, with their members and what they spent.
function SegmentTable() {
  const { data } = useSuspenseQuery(memberSegmentsQuery())
  const rows = SEGMENT_ORDER.map((key) =>
    data.segments.find((row) => row.key === key)
  ).filter((row) => row !== undefined)
  return data.member_count === 0 ? (
    <EmptyState>No members are registered yet.</EmptyState>
  ) : (
    <CardTable<SegmentRow>
      columns={SEGMENT_COLUMNS}
      rows={rows}
      getRowId={segmentKey}
      card={SEGMENT_CARD}
    />
  )
}

/// What each campaign sold and gave away.
function CampaignTable({ scope }: { scope: ReportScope }) {
  const running = useRunning(scope)
  return running.length === 0 ? (
    <EmptyState>No campaign was used in this period.</EmptyState>
  ) : (
    <CardTable<CampaignPerformance>
      columns={CAMPAIGN_COLUMNS}
      rows={running}
      getRowId={campaignKey}
      card={CAMPAIGN_CARD}
    />
  )
}
