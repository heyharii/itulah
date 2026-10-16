import { useSuspenseQueries } from "@tanstack/react-query"
import { useHydrated, useNavigate } from "@tanstack/react-router"
import { Clock } from "lucide-react"
import { Suspense, useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { ExceptionQueue, type Exception } from "@/components/ui/exception-queue"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, money, moment } from "@/lib/format"
import {
  recentReturnsQuery,
  recentSalesQuery,
  type ReturnRow,
} from "@/lib/queries/storeops"
import { useSheet } from "@/lib/sheets"
import {
  CardTable,
  field,
  type CardShape,
} from "@/screens/executive/card-table"
import { SaleSheet } from "@/screens/sales/sale-sheet"
import { rollUp, type StoreRow } from "@/screens/sales/roll-up"

/// The counter, opened on what is wrong with it.
///
/// DESIGN.md is blunt that an overview leads with a queue of exceptions rather
/// than with vanity KPIs, and for a till the exception is unambiguous: a sale
/// still OPEN is a basket nobody finished. Either a shopper walked away, or a
/// cashier is standing at it right now — and the difference is how long it has
/// been open, which is why the queue is ordered by age rather than by value.
///
/// Everything here is derived from the two lists this module already reads.
/// There is deliberately no "today": the business day has a boundary the server
/// owns (`utc_offset_minutes`, WIB by default) and reinventing it in a browser
/// would give this screen a different Tuesday from the reports. What the
/// numbers are over is said out loud instead.

/// How long a basket has been sitting there, in the coarsest unit that is still
/// informative.
function ageOf(iso: string): { minutes: number; text: string } {
  const opened = new Date(iso).getTime()
  if (Number.isNaN(opened)) return { minutes: 0, text: "—" }
  const minutes = Math.max(0, Math.round((Date.now() - opened) / 60_000))
  if (minutes < 60) return { minutes, text: `${minutes}m open` }
  const hours = Math.round(minutes / 60)
  if (hours < 48) return { minutes, text: `${hours}h open` }
  return { minutes, text: `${Math.round(hours / 24)}d open` }
}

const returnKey = (row: ReturnRow) => row.id
const storeKey = (row: StoreRow) => row.site_id

const RETURN_COLUMNS = [
  field<ReturnRow>("return", "Return", (entry) => (
    <>
      <span className="block font-mono text-[0.9375rem] text-ink">
        {entry.return_number}
      </span>
      <span className="text-[0.9375rem] text-mute">
        {moment(entry.created_at)}
      </span>
    </>
  )),
  field<ReturnRow>("store", "Store", (entry) => <Tag>{entry.site_id}</Tag>, {
    right: true,
    priority: 3,
  }),
  field<ReturnRow>(
    "refunded",
    "Refunded",
    (entry) => money(entry.refund_total_minor),
    { right: true }
  ),
]

/// A phone's card: the return, what it refunded, and where and when.
const RETURN_CARD: CardShape<ReturnRow> = {
  lead: (entry) => ({
    value: money(entry.refund_total_minor),
    caption: "refunded",
  }),
  foot: (entry) => `${entry.site_id} · ${moment(entry.created_at)}`,
}

const STORE_COLUMNS = [
  field<StoreRow>("store", "Store", (store) => (
    <span className="text-ink">{store.site_id}</span>
  )),
  field<StoreRow>(
    "tills",
    "Tills Open",
    (store) =>
      store.open_count > 0 ? (
        <span className="font-medium text-warn-fg">
          {count(store.open_count)}
        </span>
      ) : (
        <span className="text-mute">—</span>
      ),
    { right: true }
  ),
  field<StoreRow>("takings", "Takings", (store) => money(store.takings_minor), {
    right: true,
  }),
]

/// A phone's card: the shop, what it took, and how many tills are open.
const STORE_CARD: CardShape<StoreRow> = {
  lead: (store) => ({
    value: money(store.takings_minor),
    caption: "takings",
    tone: store.takings_minor === 0 ? "quiet" : undefined,
  }),
  foot: (store) =>
    store.open_count > 0
      ? `${count(store.open_count)} ${store.open_count === 1 ? "till" : "tills"} open`
      : "No till open",
}

export function Overview() {
  // The title stands at once; the counters wait for the last 500 sales and
  // returns and stream in with them (the server starts the reads too).
  return (
    <PageContent>
      <PageHeader
        crumb="Sales"
        title="Shop Floor"
        sub="The last 500 sales and returns the centre holds — not a business day, which the reports own."
      />
      <Suspense fallback={<LoadingState>Reading the counters…</LoadingState>}>
        <ShopFloor />
      </Suspense>
    </PageContent>
  )
}

function ShopFloor() {
  const sale = useSheet("sale")
  const navigate = useNavigate()

  const [sales, returns] = useSuspenseQueries({
    queries: [recentSalesQuery(), recentReturnsQuery()],
  })

  const rows = sales.data
  const refunds = useMemo(() => returns.data.rows, [returns.data])
  const stores = useMemo(() => rollUp(rows, refunds), [rows, refunds])

  const open = useMemo(
    () =>
      rows
        .filter((row) => row.status === "OPEN")
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        ),
    [rows]
  )

  /// The eight newest refunds, and the eight shops with the most tills open.
  const latest = useMemo(() => refunds.slice(0, 8), [refunds])
  const standing = useMemo(
    () =>
      [...stores]
        .sort(
          (a, b) =>
            b.open_count - a.open_count || b.takings_minor - a.takings_minor
        )
        .slice(0, 8),
    [stores]
  )

  // How long a till has been open is read off the clock, which differs
  // between the server's render and the browser's first: the age joins the
  // line once the page is hydrated.
  const hydrated = useHydrated()
  const exceptions: readonly Exception[] = useMemo(
    () =>
      open.map((row) => {
        const age = hydrated ? ageOf(row.created_at) : null
        const tendered = `tendered ${money(row.paid_minor)} of ${money(row.total_minor)}`
        return {
          id: row.id,
          title: `${row.site_id} — ${row.sale_number}`,
          detail: age === null ? tendered : `${age.text} · ${tendered}`,
          amount: money(Math.max(row.total_minor - row.paid_minor, 0)),
          // Two hours is the line between "a cashier is at this counter" and
          // "nobody is coming back to it".
          severity:
            age === null || age.minutes < 30
              ? "low"
              : age.minutes >= 120
                ? "high"
                : "medium",
          icon: <Clock className="size-[0.9375rem]" />,
          onOpen: () => sale.open(row.id),
        }
      }),
    [open, sale, hydrated]
  )

  const takings = rows
    .filter((row) => row.status === "COMPLETED")
    .reduce((sum, row) => sum + row.total_minor, 0)
  const owing = open.reduce(
    (sum, row) => sum + Math.max(row.total_minor - row.paid_minor, 0),
    0
  )
  const refunded = refunds.reduce(
    (sum, entry) => sum + entry.refund_total_minor,
    0
  )

  return (
    <>
      <KpiStrip>
        <Kpi label="Tills open" value={count(open.length)} />
        <Kpi label="Owing on them" value={money(owing)} />
        <Kpi label="Stores trading" value={count(stores.length)} />
        <Kpi
          label="Sales held"
          value={count(rows.filter((row) => row.status === "COMPLETED").length)}
        />
        <Kpi label="Takings" value={money(takings)} />
        <Kpi label="Refunded" value={money(refunded)} />
      </KpiStrip>

      <ExceptionQueue
        title="Tills left open"
        exceptions={exceptions}
        empty="Every till is square — nothing is sitting open."
      />

      <div className="grid gap-3 xl:grid-cols-2">
        <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          <CardHeader>
            <CardTitle>Latest back over the counter</CardTitle>
            <AppLink
              to="/sales/returns"
              className="text-[0.9375rem] font-medium text-accent hover:underline"
            >
              All returns
            </AppLink>
          </CardHeader>
          {refunds.length === 0 ? (
            <p className="py-6 text-center text-meta text-body">
              Nothing has been taken back.
            </p>
          ) : (
            <CardTable<ReturnRow>
              columns={RETURN_COLUMNS}
              rows={latest}
              getRowId={returnKey}
              card={RETURN_CARD}
              // The refund's own sheet, on the Returns screen.
              onRowClick={(entry) =>
                void navigate({
                  to: "/sales/returns",
                  search: { refund: entry.id },
                } as never)
              }
            />
          )}
        </Card>

        <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          <CardHeader>
            <CardTitle>Where the fleet stands</CardTitle>
            <AppLink
              to="/sales/analytics"
              className="text-[0.9375rem] font-medium text-accent hover:underline"
            >
              All stores
            </AppLink>
          </CardHeader>
          {stores.length === 0 ? (
            <EmptyState>
              No shop has reported a sale to the centre yet.
            </EmptyState>
          ) : (
            <CardTable<StoreRow>
              columns={STORE_COLUMNS}
              rows={standing}
              getRowId={storeKey}
              card={STORE_CARD}
              // That shop, on the Stores screen.
              onRowClick={(store) =>
                void navigate({
                  to: "/sales/analytics",
                  search: { store: store.site_id },
                } as never)
              }
            />
          )}
        </Card>
      </div>

      <SaleSheet id={sale.value ?? null} onClose={sale.close} />
    </>
  )
}
