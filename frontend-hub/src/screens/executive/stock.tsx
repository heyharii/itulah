import { useSuspenseQuery } from "@tanstack/react-query"
import { Suspense, useMemo } from "react"

import { Card } from "@/components/ui/card"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { count, day, money, quantity } from "@/lib/format"
import { fleetPoolsQuery } from "@/lib/queries/inventory"
import { type PurchaseOrderRow } from "@/lib/queries/procurement"
import {
  CardTable,
  field,
  type CardShape,
} from "@/screens/executive/card-table"
import { rupiah } from "@/screens/executive/format"
import { Figure, Figures, Head, ReportPage } from "@/screens/executive/parts"
import { usePlaces } from "@/screens/executive/places"
import { ordersQuery } from "@/screens/executive/data"
import { useReportScope, type ReportScope } from "@/screens/executive/scope"
import { useTrade } from "@/screens/executive/sales"
import { SupplierName } from "@/screens/procurement/supplier-name"
import { spanDays } from "@itulah/contract/reporting"

/// Stock & Purchasing — how much the shops hold, how long it lasts, and what
/// is still coming from suppliers and the warehouse.

/// The outbound stages after the goods have left the pick face: a pallet on
/// the dock is already the store's, it just is not on its shelf.
const ON_THE_WAY = new Set(["SHIPMENT", "LOADED", "IN_TRANSIT"])

const OPEN = new Set(["ACTIVE", "PARTIALLY_RECEIVED"])

interface Shelf {
  readonly site_id: string
  readonly name: string
  readonly stock: number
  readonly sold: number
  readonly cover: number | null
  readonly coming: number
}

const shelfKey = (row: Shelf) => row.site_id
const poKey = (row: PurchaseOrderRow) => row.purchase_order_id

const SHELF_COLUMNS = [
  field<Shelf>(
    "store",
    "Store",
    (shelf) => <span className="font-medium text-ink">{shelf.name}</span>,
    { by: (shelf) => shelf.name }
  ),
  field<Shelf>("stock", "Stock", (shelf) => count(shelf.stock), {
    right: true,
    by: (shelf) => shelf.stock,
  }),
  field<Shelf>("sold", "Sold", (shelf) => count(shelf.sold), {
    right: true,
    by: (shelf) => shelf.sold,
    priority: 3,
  }),
  field<Shelf>(
    "cover",
    "Cover",
    (shelf) =>
      shelf.cover === null ? "—" : `${count(Math.round(shelf.cover))} days`,
    { right: true, by: (shelf) => shelf.cover, priority: 2 }
  ),
  field<Shelf>(
    "coming",
    "On the Way",
    (shelf) =>
      shelf.coming === 0 ? (
        <span className="text-mute">—</span>
      ) : (
        count(shelf.coming)
      ),
    { right: true, by: (shelf) => shelf.coming, priority: 2 }
  ),
]

/// A phone's card: the shop, what its shelves hold, and how long that lasts.
const SHELF_CARD: CardShape<Shelf> = {
  lead: (shelf) => ({
    value: count(shelf.stock),
    caption: "pcs in stock",
    tone: shelf.stock === 0 ? "quiet" : undefined,
  }),
  foot: (shelf) =>
    [
      `${count(shelf.sold)} sold`,
      shelf.cover === null
        ? null
        : `cover ${count(Math.round(shelf.cover))} days`,
      shelf.coming === 0 ? null : `${count(shelf.coming)} on the way`,
    ]
      .filter((part) => part !== null)
      .join(" · "),
}

/// What the shops hold, how long it lasts and what is on its way, from the
/// fleet read and this period's trade. Read inside a `<Suspense>`.
function useShelves(scope: ReportScope) {
  const trade = useTrade(scope)
  const { nameOf } = usePlaces(scope)
  const fleet = useSuspenseQuery(fleetPoolsQuery())

  const days = spanDays(scope.current.from, scope.current.to)

  const shelves = useMemo<Shelf[]>(() => {
    const stock = new Map<string, number>()
    const coming = new Map<string, number>()
    // The head office site, by kind (`HO`, 0603), read from the same rows.
    // This list is the shops, so it drops head office by its kind rather than
    // by comparing the site id to a literal `dc`.
    const headOffice = new Set<string>()
    for (const pool of fleet.data.items) {
      if (!pool.authority.included_in_fleet_total) continue
      if (pool.site_kind === "HO") headOffice.add(pool.site_id)
      if (pool.group === "STORE_INVENTORY") {
        stock.set(pool.site_id, (stock.get(pool.site_id) ?? 0) + pool.on_hand)
      } else if (
        pool.group === "OUTBOUND" &&
        pool.destination_store_id !== null &&
        ON_THE_WAY.has(pool.outbound_stage ?? "")
      ) {
        coming.set(
          pool.destination_store_id,
          (coming.get(pool.destination_store_id) ?? 0) + pool.on_hand
        )
      }
    }
    const sold = new Map(
      trade.data.stores.map((store) => [store.site_id, store.units])
    )
    const sites = new Set([...stock.keys(), ...coming.keys(), ...sold.keys()])
    return [...sites]
      .filter((site) => !headOffice.has(site))
      .map((site) => {
        const held = stock.get(site) ?? 0
        const units = sold.get(site) ?? 0
        return {
          site_id: site,
          name: nameOf(site),
          stock: held,
          sold: units,
          cover: units === 0 ? null : held / (units / days),
          coming: coming.get(site) ?? 0,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name, "id"))
  }, [fleet.data, trade.data, nameOf, days])

  const mine =
    scope.store === undefined
      ? shelves
      : shelves.filter((shelf) => shelf.site_id === scope.store)
  return {
    asOf: fleet.data.as_of,
    days,
    mine,
    held: mine.reduce((sum, shelf) => sum + shelf.stock, 0),
    sold: mine.reduce((sum, shelf) => sum + shelf.sold, 0),
    coming: mine.reduce((sum, shelf) => sum + shelf.coming, 0),
  }
}

/// The purchase orders still waiting for goods, soonest arrival first, and how
/// many pieces they owe. Read inside a `<Suspense>`.
function useOpenOrders(scope: ReportScope) {
  const orders = useSuspenseQuery(ordersQuery())

  const open = useMemo(
    () =>
      orders.data
        .filter(
          (order) =>
            OPEN.has(order.lifecycle) &&
            order.outstanding_stock_units > 0 &&
            (scope.store === undefined ||
              order.destination_site_id === scope.store)
        )
        .sort((a, b) =>
          (a.expected_arrival ?? "9999").localeCompare(
            b.expected_arrival ?? "9999"
          )
        ),
    [orders.data, scope.store]
  )
  const owed = open.reduce(
    (sum, order) => sum + order.outstanding_stock_units,
    0
  )
  return { open, owed }
}

export function ExecutiveStock() {
  const scope = useReportScope()

  return (
    <ReportPage title="Stock & Purchasing" scope={scope}>
      <Figures>
        <Suspense
          fallback={
            <>
              <Figure label="Store stock" value="…" />
              <Figure label="Stock cover" value="…" />
              <Figure label="On the way to the stores" value="…" />
            </>
          }
        >
          <ShelfFigures scope={scope} />
        </Suspense>
        <Suspense fallback={<Figure label="POs not yet received" value="…" />}>
          <OrderFigure scope={scope} />
        </Suspense>
      </Figures>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          <Head title="Stock by store" />
          <Suspense fallback={<LoadingState>Reading the stock…</LoadingState>}>
            <ShelfTable scope={scope} />
          </Suspense>
        </Card>

        <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          <Head
            title="Open POs"
            to="/procurement/outstanding"
            link="Open Procurement"
          />
          <Suspense fallback={<LoadingState>Reading the POs…</LoadingState>}>
            <OrderTable scope={scope} />
          </Suspense>
        </Card>
      </div>
    </ReportPage>
  )
}

/// What the shelves hold, how long that lasts and what is on its way.
function ShelfFigures({ scope }: { scope: ReportScope }) {
  const { asOf, days, held, sold, coming } = useShelves(scope)
  return (
    <>
      <Figure
        label="Store stock"
        value={`${quantity(held)}`}
        note={`As of ${day(asOf)}`}
      />
      <Figure
        label="Stock cover"
        value={
          sold === 0 ? "—" : `${count(Math.round(held / (sold / days)))} days`
        }
        note={`${quantity(sold)} sold this period`}
      />
      <Figure
        label="On the way to the stores"
        value={`${quantity(coming)}`}
        note="Already left the warehouse"
      />
    </>
  )
}

/// What the suppliers still owe.
function OrderFigure({ scope }: { scope: ReportScope }) {
  const { open, owed } = useOpenOrders(scope)
  return (
    <Figure
      label="POs not yet received"
      value={`${quantity(owed)}`}
      note={`${count(open.length)} open ${open.length === 1 ? "PO" : "POs"}`}
    />
  )
}

/// One row per shop: its shelves, its pace and what is on the way.
function ShelfTable({ scope }: { scope: ReportScope }) {
  const { mine } = useShelves(scope)
  return mine.length === 0 ? (
    <EmptyState>No store stock has been recorded yet.</EmptyState>
  ) : (
    <CardTable<Shelf>
      columns={SHELF_COLUMNS}
      rows={mine}
      getRowId={shelfKey}
      card={SHELF_CARD}
    />
  )
}

/// The open purchase orders, with where each one goes and when it is due.
function OrderTable({ scope }: { scope: ReportScope }) {
  const { nameOf } = usePlaces(scope)
  const { open } = useOpenOrders(scope)

  const poColumns = [
    field<PurchaseOrderRow>(
      "po",
      "PO",
      (order) => (
        <>
          <span className="block font-medium text-ink">{order.po_number}</span>
          <span className="block text-[0.9375rem] text-mute">
            <SupplierName code={order.supplier_id} name={order.supplier_name} />
          </span>
        </>
      ),
      { by: (order) => order.po_number }
    ),
    field<PurchaseOrderRow>(
      "destination",
      "Destination",
      (order) => nameOf(order.destination_site_id),
      { right: true, priority: 3 }
    ),
    field<PurchaseOrderRow>(
      "outstanding",
      "Not Received",
      (order) => count(order.outstanding_stock_units),
      { right: true, by: (order) => order.outstanding_stock_units }
    ),
    field<PurchaseOrderRow>(
      "value",
      "PO Value",
      (order) => (
        <span title={money(order.net_minor)}>{rupiah(order.net_minor)}</span>
      ),
      { right: true, by: (order) => order.net_minor, priority: 2 }
    ),
    field<PurchaseOrderRow>(
      "arrival",
      "Arrival",
      (order) => day(order.expected_arrival),
      { right: true, by: (order) => order.expected_arrival ?? "9999" }
    ),
  ]
  /// A phone's card: the PO and what it still owes, with where it goes and
  /// when it is due.
  const poCard: CardShape<PurchaseOrderRow> = {
    lead: (order) => ({
      value: count(order.outstanding_stock_units),
      caption: "pcs not received",
    }),
    foot: (order) =>
      `${nameOf(order.destination_site_id)} · ${rupiah(order.net_minor)} · arrives ${day(order.expected_arrival)}`,
  }

  return open.length === 0 ? (
    <EmptyState>No PO is still waiting for goods.</EmptyState>
  ) : (
    <CardTable<PurchaseOrderRow>
      columns={poColumns}
      rows={open}
      getRowId={poKey}
      card={poCard}
    />
  )
}
