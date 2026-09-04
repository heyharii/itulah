import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { FilterBar } from "@/components/ui/filter-bar"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { useFilters } from "@/lib/filters"
import { count, day, label, money, toneFor } from "@/lib/format"
import {
  listPurchaseOrders,
  procurementKeys,
  purchaseOrderDetail,
  type PurchaseOrderRow,
} from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { useAppNavigate } from "@/lib/navigate"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"

/// Purchase orders — the reference screen for this app.
///
/// Every other list is written the same way, so it is worth naming the parts:
///
///  1. One `useQuery` per read, keyed from `lib/queries/<domain>.ts`.
///  2. Columns declared outside the component (they never close over props),
///     built with `createColumnHelper` so the accessor and the cell agree.
///  3. `useTable` with the shared `tableSetup` — never a bespoke feature set.
///  4. `<DataTable>` for the grammar, and it virtualises itself past 150 rows.
///  5. Selection opens the floating `<Sheet>`; the list keeps its scroll.
///  6. `queryState` renders pending / error / data, so no screen invents its
///     own spinner or its own error sentence.
///  7. `useFilters(columns)` reads the bar out of the URL and hands back the
///     columns with the shared predicate attached; `<FilterBar>` draws the
///     chips. Which columns are filterable is declared on the columns
///     themselves, in `meta.filter` — never in a list beside the table.
///
/// The columns are the point, not the decoration. DESIGN.md is explicit that a
/// list exists to decide and to compare rows, so what is here is the buyer's
/// outstanding position — ordered, received, still owed — and not the supplier's
/// address or the internal id. Those are one click away in the sheet.

const columns: ColumnDef<TableSetup, PurchaseOrderRow>[] = [
  {
    accessorKey: "po_number",
    header: "PO",
    size: 150,
    meta: { filter: { kind: "text" } },
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.po_number}
      </span>
    ),
  },
  {
    id: "supplier",
    accessorFn: (row) => row.supplier_name ?? row.supplier_id,
    header: "Supplier",
    size: 260,
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {row.original.supplier_name ?? row.original.supplier_id}
      </span>
    ),
  },
  {
    accessorKey: "destination_site_id",
    header: "Destination",
    size: 160,
    meta: { filter: { kind: "option" } },
  },
  {
    accessorKey: "order_status",
    header: "Status",
    size: 150,
    // The picker shows the sentence, not the code: a buyer excluding cancelled
    // orders is looking for "Cancelled", not `ORDER_CANCELLED`.
    meta: { filter: { kind: "option", format: label } },
    cell: ({ row }) => (
      <Pill tone={toneFor(row.original.order_status)}>
        {label(row.original.order_status)}
      </Pill>
    ),
  },
  {
    accessorKey: "issued_at",
    header: "Issued",
    size: 130,
    meta: { filter: { kind: "date" } },
    cell: ({ row }) => day(row.original.issued_at),
  },
  {
    accessorKey: "expected_stock_units",
    header: "Expected",
    size: 110,
    meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
    cell: ({ row }) => count(row.original.expected_stock_units),
  },
  {
    accessorKey: "received_stock_units",
    header: "Received",
    size: 110,
    meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
    cell: ({ row }) => count(row.original.received_stock_units),
  },
  {
    accessorKey: "outstanding_stock_units",
    header: "Outstanding",
    size: 120,
    meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
    // The decision metric, and the reason this list sorts by it: a zero is
    // quiet, anything else is a supplier somebody may need to chase.
    cell: ({ row }) => {
      const value = row.original.outstanding_stock_units
      return (
        <span className={value > 0 ? "font-medium text-warn-fg" : "text-mute"}>
          {count(value)}
        </span>
      )
    },
  },
]

export function PurchaseOrders() {
  const goTo = useAppNavigate()
  const [query, setQuery] = useState("")
  // Which order is open lives in the URL (`?order=…`), not in state beside the
  // table. A sheet in `useState` cannot be linked to, does not survive the
  // reload a browser gets every morning, and cannot be opened by the command
  // palette or a notification — all three of which want to.
  const order = useSheet("order")
  // Default sort is the decision metric, not the identifier: the first screenful
  // should already be the orders somebody has to chase.
  const [sorting, setSorting] = useState<SortingState>([
    { id: "outstanding_stock_units", desc: true },
  ])

  const orders = useQuery({
    queryKey: procurementKeys.orders(),
    queryFn: ({ signal }) => listPurchaseOrders(signal),
  })

  const rows = useMemo(() => orders.data ?? [], [orders.data])

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: PurchaseOrderRow) => row.purchase_order_id,
        state: {
          columnFilters: filters.columnFilters,
          globalFilter: query,
          sorting,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [rows, filters.columns, filters.columnFilters, query, sorting]
    )
  )

  /// How many orders survive the bar, which is not the same as how many there
  /// are. A list that says nothing when a filter hides everything reads as a
  /// list with no data in it.
  const matching = table.getFilteredRowModel().rows.length

  return (
    <PageContent>
      <PageHeader
        crumb="Procurement"
        title="Purchase orders"
        sub="What has been ordered, what has arrived, and what is still owed."
        actions={
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-8 w-48"
            />
            {/* An order starts by choosing goods, so this goes to sourcing
                rather than opening an empty form. The order itself is raised
                from the basket, which is where the chosen goods collect. */}
            <Button variant="dark" onClick={() => goTo("/procurement")}>
              New order
            </Button>
          </>
        }
      />


      <Toolbar>
        <FilterBar model={filters} table={table} />
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(orders, {
          loading: "Loading the orders…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>No purchase order has been raised yet.</EmptyState>
            ) : matching === 0 ? (
              // A different sentence from the one above, deliberately: "there
              // are none" and "none of them match what you asked for" are
              // different facts, and only one of them has a fix.
              <EmptyState>No order matches these filters.</EmptyState>
            ) : (
              <DataTable<PurchaseOrderRow>
                table={table}
                onRowClick={(row) => order.open(row.purchase_order_id)}
                isSelected={(row) => row.purchase_order_id === order.value}
                className="max-h-[calc(100vh-14rem)]"
              />
            ),
        })}
      </Card>

      <OrderSheet id={order.value ?? null} onClose={order.close} />
    </PageContent>
  )
}

/// The record detail. It fetches its own read rather than being handed the row:
/// the list carries a summary, and the lines are only wanted once somebody
/// asks for one order.
function OrderSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const detail = useQuery({
    queryKey: procurementKeys.order(id ?? ""),
    queryFn: ({ signal }) => purchaseOrderDetail(id!, signal),
    enabled: id !== null,
  })

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "purchase_order", id }}
      onOpenChange={(open) => !open && onClose()}
      id={detail.data?.po_number}
      title={detail.data?.supplier_name ?? detail.data?.supplier_id ?? "Order"}
    >
      {queryState(detail, {
        loading: "Loading the order…",
        render: (order) => (
          <div className="flex flex-col gap-5">
            <div>
              <Pill tone={toneFor(order.order_status)}>
                {label(order.order_status)}
              </Pill>
            </div>

            <Facts>
              <Fact term="Destination">{order.destination_site_id}</Fact>
              <Fact term="Issued">{day(order.issued_at)}</Fact>
              <Fact term="Payable">{money(order.payable_minor)}</Fact>
              <Fact term="Raised by">{order.created_by}</Fact>
            </Facts>

            <div>
              <h4 className="mb-2 text-card-title font-semibold text-ink">
                Lines
              </h4>
              {/* The in-card mini-table: mono UPPERCASE micro-headers, which
                  is the one place that grammar belongs. */}
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {["Item", "Qty", "Received", "Line total"].map(
                      (head, index) => (
                        <th
                          key={head}
                          className={`pb-1.5 font-mono text-[0.625rem] tracking-[0.04em] text-faint uppercase ${index === 0 ? "text-left" : "text-right"}`}
                        >
                          {head}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((line) => (
                    <tr
                      key={line.po_line_id}
                      className="border-t border-hairline"
                    >
                      <td className="py-2 pr-2">
                        <span className="block text-[0.8125rem] text-ink">
                          {line.article_name}
                        </span>
                        <span className="font-mono text-[0.65625rem] text-mute">
                          {line.article_code}
                        </span>
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {count(line.ordered_quantity)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {count(line.received_quantity)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {money(line.ordered_value_minor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* The totals ladder: only the final row is `{ink}`/600. */}
              <div className="mt-3 flex flex-col gap-1 border-t border-hairline pt-2.5 text-[0.78125rem]">
                <div className="flex justify-between text-body">
                  <span>Expected units</span>
                  <span className="tabular-nums">
                    {count(
                      order.lines.reduce(
                        (sum, line) => sum + line.expected_stock_units,
                        0
                      )
                    )}
                  </span>
                </div>
                <div className="flex justify-between text-body">
                  <span>Outstanding units</span>
                  <span className="tabular-nums">
                    {count(
                      order.lines.reduce(
                        (sum, line) => sum + line.outstanding_stock_units,
                        0
                      )
                    )}
                  </span>
                </div>
                <div className="flex justify-between font-semibold text-ink">
                  <span>Payable</span>
                  <span className="tabular-nums">
                    {money(order.payable_minor)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ),
      })}
    </Sheet>
  )
}
