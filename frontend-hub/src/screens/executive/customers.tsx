import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { Card } from "@/components/ui/card"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { EmptyState } from "@/components/ui/states"
import { count, money } from "@/lib/format"
import {
  campaignPerformance,
  performanceKeys,
} from "@/lib/queries/commercial-performance"
import {
  memberKeys,
  memberSegments,
  SEGMENT_ORDER,
  type SegmentKey,
} from "@/lib/queries/members"
import { listVouchers, voucherKeys } from "@/lib/queries/vouchers"
import { queryState } from "@/lib/query-state"
import { isoDate } from "@itulah/contract/reporting"
import { rupiah } from "@/screens/executive/format"
import { Figure, Figures, Head, ReportPage } from "@/screens/executive/parts"
import { useReportScope } from "@/screens/executive/scope"

/// Pelanggan & promosi — who the members are and how they are spending, what
/// the vouchers in circulation are worth, and what each campaign gave away.

const SEGMENT: Record<SegmentKey, string> = {
  NEW: "Baru",
  ACTIVE: "Aktif",
  LAPSING: "Mulai pasif",
  LAPSED: "Pasif",
  NEVER: "Belum belanja",
  BLOCKED: "Diblokir",
}

/// A trading day as the instants the promotion report is asked in — WIB, the
/// same day boundary the sales report uses.
function instant(date: string): string {
  return `${date}T00:00:00+07:00`
}

function dayAfter(date: string): string {
  const next = new Date(`${date}T12:00:00`)
  next.setDate(next.getDate() + 1)
  return isoDate(next)
}

export function ExecutiveCustomers() {
  const scope = useReportScope()
  const segments = useQuery({
    queryKey: memberKeys.segments(),
    queryFn: ({ signal }) => memberSegments(signal),
  })
  const vouchers = useQuery({
    queryKey: voucherKeys.list({ limit: 1 }),
    queryFn: ({ signal }) => listVouchers({ limit: 1 }, signal),
  })
  const { from, to } = scope.current
  const span = useMemo(
    () => ({
      from: instant(from),
      to: instant(dayAfter(to)),
      siteId: scope.store ?? null,
    }),
    [from, to, scope.store]
  )
  const campaigns = useQuery({
    queryKey: performanceKeys.campaigns(span),
    queryFn: ({ signal }) => campaignPerformance(span, signal),
    retry: false,
  })

  const book = segments.data
  const active = book
    ? book.segments
        .filter((row) => row.key === "ACTIVE" || row.key === "NEW")
        .reduce((sum, row) => sum + row.members, 0)
    : undefined
  const running = useMemo(
    () =>
      [...(campaigns.data?.campaigns ?? [])]
        .filter((row) => row.sale_count > 0 || row.benefit_minor > 0)
        .sort((a, b) => b.basket_revenue_minor - a.basket_revenue_minor),
    [campaigns.data]
  )

  return (
    <ReportPage title="Pelanggan & promosi" scope={scope}>
      <Figures>
        <Figure
          label="Member terdaftar"
          value={book ? count(book.member_count) : "…"}
        />
        <Figure
          label="Member aktif"
          value={active === undefined ? "…" : count(active)}
          note={
            book ? `Belanja dalam ${book.active_days} hari terakhir` : undefined
          }
        />
        <Figure
          label="Voucher beredar"
          value={
            vouchers.data ? rupiah(vouchers.data.ledger.outstanding_minor) : "…"
          }
          note={
            vouchers.data
              ? `${count(vouchers.data.ledger.outstanding_count)} voucher`
              : undefined
          }
        />
        <Figure
          label="Kampanye berjalan"
          value={campaigns.data ? count(running.length) : "…"}
          note="Menghasilkan transaksi periode ini"
        />
      </Figures>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <Head
            title="Segmen member"
            to="/members/segments"
            link="Buka member"
          />
          <div className="overflow-x-auto px-[1.125rem] pb-3">
            {queryState(segments, {
              loading: "Membaca member…",
              render: (data) => {
                const rows = SEGMENT_ORDER.map((key) =>
                  data.segments.find((row) => row.key === key)
                ).filter((row) => row !== undefined)
                return data.member_count === 0 ? (
                  <EmptyState>Belum ada member yang terdaftar.</EmptyState>
                ) : (
                  <MiniTable
                    head={["Segmen", "Member", "Belanja", "Rata-rata"]}
                    style={{ minWidth: "26rem" }}
                  >
                    {rows.map((row) => (
                      <MiniRow key={row.key}>
                        <MiniCell className="font-medium text-ink">
                          {SEGMENT[row.key]}
                        </MiniCell>
                        <MiniCell align="right">{count(row.members)}</MiniCell>
                        <MiniCell align="right">
                          <span title={money(row.spent_minor)}>
                            {rupiah(row.spent_minor)}
                          </span>
                        </MiniCell>
                        <MiniCell align="right">
                          {row.members === 0
                            ? "—"
                            : rupiah(row.average_spend_minor)}
                        </MiniCell>
                      </MiniRow>
                    ))}
                  </MiniTable>
                )
              },
            })}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <Head
            title="Kampanye promosi"
            to="/commercial"
            link="Buka Marketing"
          />
          <div className="overflow-x-auto px-[1.125rem] pb-3">
            {queryState(campaigns, {
              loading: "Membaca promosi…",
              render: () =>
                running.length === 0 ? (
                  <EmptyState>
                    Tidak ada kampanye yang terpakai di periode ini.
                  </EmptyState>
                ) : (
                  <MiniTable
                    head={["Kampanye", "Transaksi", "Penjualan", "Diskon"]}
                    style={{ minWidth: "26rem" }}
                  >
                    {running.map((row) => (
                      <MiniRow key={row.campaign_id}>
                        <MiniCell className="font-medium text-ink">
                          {row.name ?? row.campaign_id}
                        </MiniCell>
                        <MiniCell align="right">
                          {count(row.sale_count)}
                        </MiniCell>
                        <MiniCell align="right">
                          <span title={money(row.basket_revenue_minor)}>
                            {rupiah(row.basket_revenue_minor)}
                          </span>
                        </MiniCell>
                        <MiniCell align="right">
                          <span title={money(row.benefit_minor)}>
                            {rupiah(row.benefit_minor)}
                          </span>
                        </MiniCell>
                      </MiniRow>
                    ))}
                  </MiniTable>
                ),
            })}
          </div>
        </Card>
      </div>
    </ReportPage>
  )
}
