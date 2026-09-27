import { useInfiniteQuery, useQueries } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import {
  EmptyState,
  ErrorState,
  LoadMore,
  LoadingState,
} from "@/components/ui/states"
import { clock, count, day, money } from "@/lib/format"
import {
  analyticsKeys,
  dailyReport,
  salesWindow,
  type ReturnTotals,
  type SaleTenderTotal,
  type SalesTotals,
} from "@/lib/queries/analytics"
import { siteChoices, useUnits } from "@/lib/queries/organisation"
import {
  CardRow,
  Grid,
  Note,
  NumberCard,
  Td,
  Th,
  TotalRow,
} from "@/screens/finance-final/parts"
import { useWindow } from "@/screens/finance/hooks"
import { SiteName, SiteSelect, WindowControl } from "@/screens/finance/parts"
import type { PaymentMethod } from "@itulah/contract"

/// What each shop took, day by day, and how it was paid.
///
/// There is already a Sales screen in this hub — `screens/sales` — and this is
/// deliberately not a copy of it. That one answers merchandising's question:
/// how did the fleet trade this month and which branch is the reason. It draws
/// a stacked chart of gross takings and never mentions a tender, because a
/// merchandiser does not care whether a jacket was paid for with a card.
///
/// Finance cares about almost nothing else. One gross figure is three facts to
/// the book — net revenue, the tax inside it, and the money itself — and
/// **which tender** decides where the money half lands and how long it takes
/// to get there. Cash goes into a drawer somebody has to count. A card goes to
/// an acquirer who pays the bank a day later, less a fee, so the amount that
/// arrives is not the amount that was taken. A voucher is not money arriving
/// at all; it is a liability being settled. So the tender split is the spine
/// of this screen, and it is the thing Sales reconciliation is handed.
///
/// ## Why this screen asks the server once per row
///
/// No endpoint splits takings by tender for more than one shop, or more than
/// one day, at a time. `/reports/sales/series` buckets the whole fleet but
/// carries no tender at all; `/reports/sales/window` carries the split and
/// takes exactly one `site_id`; `/reports/sales/daily` carries it for one shop
/// on one date. The backend says so itself, in the doc comment on
/// `SalesSeriesQuery`: the fleet's answer "cannot be assembled from the first
/// without one request per shop per day".
///
/// So the screen fans out, and which way it fans depends on what is being
/// asked:
///
/// - **No site chosen** — one `window` per site; a row is a shop.
/// - **A site chosen** — one `daily` per date in the span; a row is a day.
///
/// That is a fan-out, not a slice. Every figure here is the server's own
/// answer for one site over one span, which is the rule this module is built
/// on: the filter is one the server applies, never a wider answer narrowed
/// in the browser. A sale happens at a site, so the filter is a site.
export function Sales() {
  const range = useWindow()
  // Every site, in the register's order — head office's first, then the
  // stores' — which is the order the fleet rows are drawn in.
  const register = useUnits()
  const sites = useMemo(
    () => siteChoices(register.data ?? []).map((choice) => choice.siteId),
    [register.data]
  )
  const [site, setSite] = useState("")

  const dates = useMemo(() => datesIn(range.from, range.to), [range])
  // Past this, a day-by-day view is more requests than it is worth and the
  // reader wanted a total, not a calendar. Refused out loud rather than
  // quietly truncated: half a span drawn as a whole one is the lie.
  const tooWide = dates.length > DAY_LIMIT

  // Exactly one of these two fans out; the other is handed an empty list, so
  // `useQueries` makes no request and answers `[]`. Both hooks are still
  // called on every render, which is what the rules of hooks require.
  const fleet = useTakingsBySite(site === "" ? sites : [], {
    from: range.from,
    to: range.to,
  })
  const byDay = useTakingsByDay(site, site === "" || tooWide ? [] : dates)

  const rows = site === "" ? fleet.rows : byDay.rows
  const pending =
    site === "" ? register.isPending || fleet.pending : byDay.pending
  const failure = site === "" ? (register.error ?? fleet.error) : byDay.error

  const total = useMemo(() => sum(rows), [rows])

  return (
    <PageContent>
      <PageHeader
        crumb="Finance final · Store"
        title="Sales"
        sub="What each shop took, day by day, and how it was paid — the figures that have to end up in the book."
      />

      <Toolbar>
        <SiteSelect value={site} onChange={setSite} className="h-8 w-44" />
        <WindowControl range={range} />
        <Toolbar.Spacer />
        <span className="text-[0.875rem] text-mute">{range.chip}</span>
      </Toolbar>

      {failure !== null && failure !== undefined ? (
        <ErrorState error={failure} />
      ) : pending ? (
        <LoadingState>
          {site === ""
            ? "Asking every site what it took…"
            : "Adding up the tills, one day at a time…"}
        </LoadingState>
      ) : rows.length === 0 && !tooWide ? (
        <EmptyState>
          No site is registered yet, so there is nothing that could have sold
          anything. Sites come from the units in Organisation.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-5">
          <CardRow columns={4}>
            <NumberCard
              label="Gross takings"
              value={total.gross}
              note={`${count(total.sales)} sales${
                total.voided === 0 ? "" : ` · ${count(total.voided)} voided`
              }`}
            />
            {/* "What the income accounts take" is what this card used to say,
                and it was not true. A `SALE_DAY` entry credits the GROSS to
                `4010110001 Penjualan Barang Dagangan` and posts no output-tax
                line at all, because no tax liability meaning is mapped — so
                the books recognise the gross as revenue and never recognise
                the PPN as a debt. Until a poster splits it, this figure is the
                till's arithmetic and not the ledger's, and the card says so
                rather than describing a posting nobody makes. */}
            <NumberCard
              label="Net of tax"
              value={total.net}
              note="The till's split — not what the ledger books"
            />
            <NumberCard
              label="Output tax"
              value={total.tax}
              note="Inside the price; no entry recognises it yet"
            />
            <NumberCard
              label="Refunds"
              value={total.refunds}
              note={`${count(total.returnCount)} returns`}
            />
          </CardRow>

          {/* The tender split twice over, and on purpose. Here it is one row
              per kind of money, because the question is *what sort of money is
              this and where does it go* — and the answer to that is the whole
              handover to Sales reconciliation. Below, the same split is one
              column per kind, because the question there is *who took it and
              when*. Two questions, two shapes, one set of figures. */}
          <section className="flex flex-col gap-2">
            <h2 className="text-[0.875rem] font-semibold text-ink">
              How it was paid
            </h2>
            <Grid>
              <thead>
                <tr>
                  <Th width="7rem">Tender</Th>
                  <Th align="right" width="5rem">
                    Sales
                  </Th>
                  <Th align="right" width="9rem">
                    Taken
                  </Th>
                  <Th align="right" width="9rem">
                    Refunded
                  </Th>
                  <Th align="right" width="5rem">
                    Share
                  </Th>
                  <Th>Where it settles</Th>
                </tr>
              </thead>
              <tbody>
                {TENDERS.map((tender) => (
                  <tr key={tender.method}>
                    <Td>
                      <span className="font-medium text-ink">
                        {tender.label}
                      </span>
                    </Td>
                    <Td align="right">
                      {count(total.tenderCount[tender.method] ?? 0)}
                    </Td>
                    <Td align="right">
                      <Figure minor={total.taken[tender.method] ?? 0} />
                    </Td>
                    <Td align="right">
                      <Figure minor={total.refunded[tender.method] ?? 0} />
                    </Td>
                    <Td align="right">
                      {share(total.taken[tender.method] ?? 0, total.tendered)}
                    </Td>
                    <Td className="text-[0.875rem] text-body">
                      {tender.settles}
                    </Td>
                  </tr>
                ))}
                <TotalRow>
                  <Td>Tendered</Td>
                  <Td align="right">{count(total.tenderSales)}</Td>
                  <Td align="right">{money(total.tendered)}</Td>
                  <Td align="right">{money(total.refunds)}</Td>
                  <Td align="right">100.0%</Td>
                  <Td />
                </TotalRow>
              </tbody>
            </Grid>
            <Note>
              <b>Taken</b> is what was handed over, so it exceeds gross by
              whatever change was given back —{" "}
              <b>gross = tendered &minus; change</b>, and change is only ever
              cash. Refunds are not deducted from either: a return is its own
              movement on its own day, and netting it into a day&rsquo;s takings
              would hide both. The till has no <i>transfer</i> tender; anything
              that is not one of the four named kinds is recorded as{" "}
              <b>Other</b>, which is a closed list in{" "}
              <code className="font-mono text-[0.875rem]">tender.rs</code> and
              not a free-text field.
            </Note>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-[0.875rem] font-semibold text-ink">
              {site === "" ? "By site" : "Day by day"}
            </h2>
            {tooWide ? (
              <Note>
                This span is {count(dates.length)} days. A day-by-day split
                costs one request per day, so it is drawn for spans up to{" "}
                {DAY_LIMIT} days — narrow the window, or leave the site on{" "}
                <b>Every site</b> to see the same span one row per shop.
              </Note>
            ) : (
              <Grid>
                <thead>
                  <tr>
                    <Th width="9rem">{site === "" ? "Site" : "Date"}</Th>
                    <Th align="right" width="4.5rem">
                      Sales
                    </Th>
                    <Th align="right" width="8.5rem">
                      Net
                    </Th>
                    <Th align="right" width="8rem">
                      Tax
                    </Th>
                    <Th align="right" width="8.5rem">
                      Gross
                    </Th>
                    {TENDERS.map((tender) => (
                      <Th key={tender.method} align="right" width="8.5rem">
                        {tender.label}
                      </Th>
                    ))}
                    <Th align="right" width="7rem">
                      Change
                    </Th>
                    <Th align="right" width="8rem">
                      Refunds
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <Td>
                        {row.siteId === null ? (
                          day(row.date)
                        ) : (
                          <SiteName id={row.siteId} className="text-ink" />
                        )}
                      </Td>
                      <Td align="right">{count(row.sales)}</Td>
                      <Td align="right">
                        <Figure minor={row.net} />
                      </Td>
                      <Td align="right">
                        <Figure minor={row.tax} />
                      </Td>
                      <Td align="right">
                        <span className="font-medium text-ink">
                          <Figure minor={row.gross} />
                        </span>
                      </Td>
                      {TENDERS.map((tender) => (
                        <Td key={tender.method} align="right">
                          <Figure minor={row.taken[tender.method] ?? 0} />
                        </Td>
                      ))}
                      <Td align="right">
                        <Figure minor={row.change} />
                      </Td>
                      <Td align="right">
                        <Figure minor={row.refunds} />
                      </Td>
                    </tr>
                  ))}
                  <TotalRow>
                    <Td>{site === "" ? "All sites" : "Whole span"}</Td>
                    <Td align="right">{count(total.sales)}</Td>
                    <Td align="right">{money(total.net)}</Td>
                    <Td align="right">{money(total.tax)}</Td>
                    <Td align="right">{money(total.gross)}</Td>
                    {TENDERS.map((tender) => (
                      <Td key={tender.method} align="right">
                        {money(total.taken[tender.method] ?? 0)}
                      </Td>
                    ))}
                    <Td align="right">{money(total.change)}</Td>
                    <Td align="right">{money(total.refunds)}</Td>
                  </TotalRow>
                </tbody>
              </Grid>
            )}
          </section>

          {site !== "" && (
            <Receipts site={site} from={range.from} to={range.to} />
          )}

          <Note>
            Every figure above is the server&rsquo;s own answer for one site
            over one span — one{" "}
            <code className="font-mono text-[0.875rem]">
              {site === "" ? "/reports/sales/window" : "/reports/sales/daily"}
            </code>{" "}
            per {site === "" ? "site" : "date"}, added together here only to
            make the total row. Nothing on this page is a fleet answer sliced by
            the browser. The business day boundary is the shop&rsquo;s, not the
            server&rsquo;s: WIB, UTC+7, as the report endpoints default to.
          </Note>
        </div>
      )}
    </PageContent>
  )
}

/// How wide a span may be before the day-by-day table stops being drawn.
///
/// Two months. A finance reader working a period looks at a month; anybody
/// asking for a year wants the location table, which costs fourteen requests
/// whatever the span.
const DAY_LIMIT = 62

/// The kinds of money a till can take, and what happens to each one next.
///
/// Closed on purpose, and it is the server's own list: `PaymentMethod` in
/// `backend/src/tender.rs` has exactly these five and `FromStr` refuses
/// anything else, so a column per kind cannot silently drop a tender. Note
/// what is NOT here — there is no transfer, no e-wallet, no split-by-bank.
/// A bank transfer taken at a counter is `OTHER`, which is why the sentence
/// beside it says so rather than pretending it settles somewhere.
const TENDERS: readonly {
  readonly method: PaymentMethod
  readonly label: string
  readonly settles: string
}[] = [
  {
    method: "CASH",
    label: "Cash",
    settles: "Into the drawer, then a deposit to the bank",
  },
  {
    method: "CARD",
    label: "Card",
    settles: "Acquirer, then the bank the next day, less a fee",
  },
  {
    method: "QRIS",
    label: "QRIS",
    settles: "Acquirer, then the bank the next day, less a fee",
  },
  {
    method: "EWALLET",
    label: "E-wallet",
    settles: "The wallet provider, then the bank, less a fee",
  },
  {
    method: "VOUCHER",
    label: "Voucher",
    settles: "No money arrives — a liability settled",
  },
  {
    method: "OTHER",
    label: "Other",
    settles: "Unsaid. Anything the till could not name one of the four",
  },
]

/// One row of the takings table: a shop over a span, or a day at one shop.
interface Takings {
  readonly key: string
  /// Exactly one of these is set. `siteId` makes the row a site in the fleet
  /// table; `date` makes it a day in one shop's table.
  readonly siteId: string | null
  readonly date: string | null
  readonly sales: number
  readonly voided: number
  readonly net: number
  readonly tax: number
  readonly gross: number
  readonly change: number
  readonly refunds: number
  readonly returnCount: number
  readonly taken: Readonly<Record<string, number>>
  readonly refunded: Readonly<Record<string, number>>
  readonly tenderCount: Readonly<Record<string, number>>
}

/// The shape both report endpoints share.
///
/// `/reports/sales/daily` and `/reports/sales/window` answer with the same
/// three blocks deliberately — the backend's own comment says a day is a span
/// of one — so one reader serves both and the two views cannot end up speaking
/// different vocabularies about the same figures.
interface Reported {
  readonly sales: SalesTotals
  readonly tenders: readonly SaleTenderTotal[]
  readonly returns: ReturnTotals
}

function read(
  report: Reported,
  at: { key: string; siteId: string | null; date: string | null }
): Takings {
  const taken: Record<string, number> = {}
  const tenderCount: Record<string, number> = {}
  for (const tender of report.tenders) {
    taken[tender.method] = (taken[tender.method] ?? 0) + tender.amount_minor
    tenderCount[tender.method] =
      (tenderCount[tender.method] ?? 0) + tender.count
  }
  const refunded: Record<string, number> = {}
  for (const refund of report.returns.by_method) {
    refunded[refund.method] =
      (refunded[refund.method] ?? 0) + refund.amount_minor
  }
  return {
    key: at.key,
    siteId: at.siteId,
    date: at.date,
    sales: report.sales.count,
    voided: report.sales.voided_count,
    net: report.sales.net_minor,
    tax: report.sales.tax_minor,
    gross: report.sales.gross_minor,
    change: report.sales.change_minor,
    refunds: report.returns.refund_total_minor,
    returnCount: report.returns.count,
    taken,
    refunded,
    tenderCount,
  }
}

/// Everything on the page, added up.
///
/// Adding is the only arithmetic this screen does to the server's figures, and
/// it is done once, here, so the cards, the tender table and the total row can
/// never disagree with each other.
function sum(rows: readonly Takings[]) {
  const taken: Record<string, number> = {}
  const refunded: Record<string, number> = {}
  const tenderCount: Record<string, number> = {}
  let sales = 0
  let voided = 0
  let net = 0
  let tax = 0
  let gross = 0
  let change = 0
  let refunds = 0
  let returnCount = 0
  for (const row of rows) {
    sales += row.sales
    voided += row.voided
    net += row.net
    tax += row.tax
    gross += row.gross
    change += row.change
    refunds += row.refunds
    returnCount += row.returnCount
    for (const [method, amount] of Object.entries(row.taken))
      taken[method] = (taken[method] ?? 0) + amount
    for (const [method, amount] of Object.entries(row.refunded))
      refunded[method] = (refunded[method] ?? 0) + amount
    for (const [method, seen] of Object.entries(row.tenderCount))
      tenderCount[method] = (tenderCount[method] ?? 0) + seen
  }
  return {
    sales,
    voided,
    net,
    tax,
    gross,
    change,
    refunds,
    returnCount,
    taken,
    refunded,
    tenderCount,
    /// What was handed over, across every kind. Gross plus the change given
    /// back, which is the identity the note under the tender table states.
    tendered: Object.values(taken).reduce((a, b) => a + b, 0),
    /// A tender, not a sale: one split payment is two of these. Named so
    /// nobody reads this column as a receipt count.
    tenderSales: Object.values(tenderCount).reduce((a, b) => a + b, 0),
  }
}

/// One `window` request per site, each narrowed by the server.
function useTakingsBySite(
  sites: readonly string[],
  range: { from: string; to: string }
) {
  return useQueries({
    queries: sites.map((siteId) => ({
      // The key the sales module already owns, so a reader who has just come
      // from Sales pays for none of this twice and the two screens can never
      // print different figures for the same shop and span.
      queryKey: analyticsKeys.window(siteId, range.from, range.to),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        salesWindow({ siteId, from: range.from, to: range.to }, signal),
      staleTime: 60_000,
    })),
    // `combine` rather than a `useMemo` over the results: `useQueries` hands
    // back a fresh array every render, so a memo over it would recompute
    // constantly. React Query memoises this against the results themselves.
    // The rows come out in the order the sites were asked in — the register's,
    // which is the order the client reads their own units in — however the
    // answers land. Never sorted by id: an id is ours and orders nothing.
    combine: (results) => ({
      rows: results.flatMap((result) =>
        result.data === undefined
          ? []
          : [
              // `site_id` became nullable when `GET /reports/sales/window`
              // stopped requiring a site — null is its answer for a
              // chain-wide read. Every request here names one, so the server
              // always echoes one back and the fallback is unreachable.
              read(result.data, {
                key: result.data.site_id ?? "",
                siteId: result.data.site_id ?? "",
                date: null,
              }),
            ]
      ),
      // A partial total is a wrong total, so nothing is drawn until every
      // location has answered.
      pending: results.some((result) => result.isPending),
      error: results.find((result) => result.isError)?.error ?? null,
    }),
  })
}

/// One `daily` request per date, each narrowed by the server.
function useTakingsByDay(siteId: string, dates: readonly string[]) {
  return useQueries({
    queries: dates.map((date) => ({
      queryKey: analyticsKeys.daily(siteId, date),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        dailyReport({ siteId, date }, signal),
      // A closed day is never rewritten; today's is, so this is short enough
      // to pick up an afternoon's trade on a revisit.
      staleTime: 60_000,
    })),
    combine: (results) => ({
      rows: results.flatMap((result) =>
        result.data === undefined
          ? []
          : [
              read(result.data, {
                key: result.data.date,
                siteId: null,
                date: result.data.date,
              }),
            ]
      ),
      pending: results.some((result) => result.isPending),
      error: results.find((result) => result.isError)?.error ?? null,
    }),
  })
}

/// The receipts behind one shop's span.
///
/// Not from `GET /api/v1/sales`, and that is worth saying because it is the
/// obvious place to look: that endpoint takes `site_id`, `status` and `limit`
/// and **no dates at all**, so it can answer "the last two hundred sales at
/// this shop" but never "the sales in this window". The window report already
/// lists exactly the right ones, with the tenders on each, and says for itself
/// when it had to stop.
/// One page of receipts. The list scrolls on — a step, not a ceiling.
const RECEIPTS_PAGE = 100

function Receipts({
  site,
  from,
  to,
}: {
  site: string
  from: string
  to: string
}) {
  // The receipts a page at a time. Every page carries the whole span's
  // totals; the first page's are the ones drawn. The same key and page size
  // the Sales screen's window sheet walks, so the two share pages.
  const windowed = useInfiniteQuery({
    queryKey: analyticsKeys.windowPages(site, from, to),
    queryFn: ({ pageParam, signal }) =>
      salesWindow(
        { siteId: site, from, to, limit: RECEIPTS_PAGE, cursor: pageParam },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.transactions_next_cursor ?? undefined,
    staleTime: 60_000,
  })

  if (windowed.data === undefined) {
    if (windowed.error !== null) return <ErrorState error={windowed.error} />
    return <LoadingState>Fetching the receipts behind those days…</LoadingState>
  }

  const report = windowed.data.pages[0]
  const transactions = windowed.data.pages.flatMap((page) => page.transactions)
  if (transactions.length === 0) {
    return (
      <Note>
        No sale was completed at this site in this span, so there is no
        receipt to show.
      </Note>
    )
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[0.875rem] font-semibold text-ink">
        Receipts{" "}
        <span className="text-mute">({count(report.sales.count)})</span>
      </h2>
      <Grid>
        <thead>
          <tr>
            <Th width="14rem">Sale</Th>
            <Th width="7rem">Completed</Th>
            <Th width="9rem">Tender</Th>
            <Th align="right" width="5rem">
              Units
            </Th>
            <Th align="right" width="8.5rem">
              Net
            </Th>
            <Th align="right" width="8rem">
              Tax
            </Th>
            <Th align="right" width="8.5rem">
              Total
            </Th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((sale) => (
            <tr key={sale.id}>
              <Td>
                <span className="font-mono text-[0.875rem] text-ink">
                  {sale.sale_number}
                </span>
              </Td>
              <Td className="text-mute">{clock(sale.completed_at)}</Td>
              <Td>
                {/* More than one is a split payment, and it is the row
                    somebody opens this list to find: it is the only kind of
                    sale whose money arrives by two different routes. */}
                <span className="flex flex-wrap gap-1">
                  {sale.methods.map((method) => (
                    <Pill key={method}>{labelFor(method)}</Pill>
                  ))}
                </span>
              </Td>
              <Td align="right">{count(sale.units)}</Td>
              <Td align="right">
                <Figure minor={sale.net_minor} />
              </Td>
              <Td align="right">
                <Figure minor={sale.tax_minor} />
              </Td>
              <Td align="right">
                <span className="font-medium text-ink">
                  {money(sale.total_minor)}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </Grid>
      <LoadMore query={windowed} />
    </section>
  )
}

/// Money in a dense grid, with a zero that stays a zero.
///
/// The module's rule is that a missing figure is not zero — `—` and `Rp 0` are
/// different claims. That rule is kept literally here: a shop that took no
/// voucher money prints `Rp 0`, because it did take nothing and the server
/// said so. What changes is only the ink: eleven columns across fourteen rows
/// is a wall of figures, and dimming the zeroes lets the eye find the ones
/// that are not.
function Figure({ minor }: { minor: number | null }) {
  if (minor === null) return <span className="text-faint">—</span>
  return (
    <span className={minor === 0 ? "text-faint" : undefined}>
      {money(minor)}
    </span>
  )
}

/// A tender's share of what was handed over.
///
/// Nothing at all when nothing was taken: zero takings and a tender that
/// happens to be zero are different sentences, and dividing by the first would
/// print `NaN%` for both.
function share(part: number, whole: number): string {
  if (whole === 0) return "—"
  return `${((part / whole) * 100).toFixed(1)}%`
}

function labelFor(method: string): string {
  return TENDERS.find((tender) => tender.method === method)?.label ?? method
}

/// Every local date from one to the other, inclusive.
///
/// Built from the parts rather than by parsing the string: `new Date("2026-09-01")`
/// is midnight **UTC**, and the day these dates name is the shop's own
/// business day. The report endpoints take the same `YYYY-MM-DD` and apply
/// WIB themselves, so the string must survive the round trip unshifted.
function datesIn(from: string, to: string): readonly string[] {
  const start = local(from)
  const end = local(to)
  if (start === null || end === null || start > end) return []
  const dates: string[] = []
  for (
    const cursor = new Date(start);
    cursor <= end;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const month = String(cursor.getMonth() + 1).padStart(2, "0")
    const date = String(cursor.getDate()).padStart(2, "0")
    dates.push(`${cursor.getFullYear()}-${month}-${date}`)
  }
  return dates
}

function local(iso: string): Date | null {
  const parts = iso.split("-").map(Number)
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part)))
    return null
  return new Date(parts[0], parts[1] - 1, parts[2])
}
