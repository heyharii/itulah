import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { Card } from "@/components/ui/card"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { EmptyState } from "@/components/ui/states"
import { count, day, money, quantity } from "@/lib/format"
import { fleetPools, inventoryKeys } from "@/lib/queries/inventory"
import { listPurchaseOrders, procurementKeys } from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { rupiah } from "@/screens/executive/format"
import { Figure, Figures, Head, ReportPage } from "@/screens/executive/parts"
import { usePlaces } from "@/screens/executive/places"
import { useReportScope } from "@/screens/executive/scope"
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

export function ExecutiveStock() {
  const scope = useReportScope()
  const trade = useTrade(scope)
  const { nameOf } = usePlaces(scope)
  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })
  const orders = useQuery({
    queryKey: procurementKeys.orders(),
    queryFn: ({ signal }) => listPurchaseOrders(undefined, signal),
  })

  const days = spanDays(scope.current.from, scope.current.to)

  const shelves = useMemo<Shelf[]>(() => {
    if (!fleet.data) return []
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
      (trade.query.data?.stores ?? []).map((store) => [
        store.site_id,
        store.units,
      ])
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
  }, [fleet.data, trade.query.data, nameOf, days])

  const mine =
    scope.store === undefined
      ? shelves
      : shelves.filter((shelf) => shelf.site_id === scope.store)
  const held = mine.reduce((sum, shelf) => sum + shelf.stock, 0)
  const sold = mine.reduce((sum, shelf) => sum + shelf.sold, 0)
  const coming = mine.reduce((sum, shelf) => sum + shelf.coming, 0)

  const open = useMemo(
    () =>
      (orders.data ?? [])
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

  return (
    <ReportPage title="Stock & Purchasing" scope={scope}>
      <Figures>
        <Figure
          label="Store stock"
          value={fleet.data ? `${quantity(held)}` : "…"}
          note={`As of ${fleet.data ? day(fleet.data.as_of) : "—"}`}
        />
        <Figure
          label="Stock cover"
          value={
            fleet.data && trade.query.data
              ? sold === 0
                ? "—"
                : `${count(Math.round(held / (sold / days)))} days`
              : "…"
          }
          note={`${quantity(sold)} sold this period`}
        />
        <Figure
          label="On the way to the stores"
          value={fleet.data ? `${quantity(coming)}` : "…"}
          note="Already left the warehouse"
        />
        <Figure
          label="POs not yet received"
          value={orders.data ? `${quantity(owed)}` : "…"}
          note={`${count(open.length)} open ${open.length === 1 ? "PO" : "POs"}`}
        />
      </Figures>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <Head title="Stock by store" />
          <div className="overflow-x-auto px-[1.125rem] pb-3">
            {queryState(fleet, {
              loading: "Reading the stock…",
              render: () =>
                mine.length === 0 ? (
                  <EmptyState>No store stock has been recorded yet.</EmptyState>
                ) : (
                  <MiniTable
                    head={["Store", "Stock", "Sold", "Cover", "On the Way"]}
                    style={{ minWidth: "28rem" }}
                  >
                    {mine.map((shelf) => (
                      <MiniRow key={shelf.site_id}>
                        <MiniCell className="font-medium text-ink">
                          {shelf.name}
                        </MiniCell>
                        <MiniCell align="right">{count(shelf.stock)}</MiniCell>
                        <MiniCell align="right">{count(shelf.sold)}</MiniCell>
                        <MiniCell align="right">
                          {shelf.cover === null
                            ? "—"
                            : `${count(Math.round(shelf.cover))} days`}
                        </MiniCell>
                        <MiniCell align="right">
                          {shelf.coming === 0 ? (
                            <span className="text-mute">—</span>
                          ) : (
                            count(shelf.coming)
                          )}
                        </MiniCell>
                      </MiniRow>
                    ))}
                  </MiniTable>
                ),
            })}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <Head
            title="Open POs"
            to="/procurement/outstanding"
            link="Open Procurement"
          />
          <div className="overflow-x-auto px-[1.125rem] pb-3">
            {queryState(orders, {
              loading: "Reading the POs…",
              render: () =>
                open.length === 0 ? (
                  <EmptyState>No PO is still waiting for goods.</EmptyState>
                ) : (
                  <MiniTable
                    head={[
                      "PO",
                      "Destination",
                      "Not Received",
                      "PO Value",
                      "Arrival",
                    ]}
                    style={{ minWidth: "30rem" }}
                  >
                    {open.map((order) => (
                      <MiniRow key={order.purchase_order_id}>
                        <MiniCell>
                          <span className="block font-medium text-ink">
                            {order.po_number}
                          </span>
                          <span className="block text-[0.875rem] text-mute">
                            <SupplierName
                              code={order.supplier_id}
                              name={order.supplier_name}
                            />
                          </span>
                        </MiniCell>
                        <MiniCell align="right">
                          {nameOf(order.destination_site_id)}
                        </MiniCell>
                        <MiniCell align="right">
                          {count(order.outstanding_stock_units)}
                        </MiniCell>
                        <MiniCell align="right">
                          <span title={money(order.net_minor)}>
                            {rupiah(order.net_minor)}
                          </span>
                        </MiniCell>
                        <MiniCell align="right">
                          {day(order.expected_arrival)}
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
