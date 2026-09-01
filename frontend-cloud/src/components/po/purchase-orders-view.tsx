import { AppShell, ScreenBody, ScreenHeader, ScreenState } from "@/components/app-shell"
import { DataGrid } from "@/components/custom/data-grid"
import { DataTableProvider } from "@/components/data-table/data-table-provider"
import { DataTableResetButton } from "@/components/data-table/data-table-reset-button"
import { Nav } from "@/components/nav"
import { SupplierPicker } from "@/components/po/new-order"
import { Button } from "@/components/ui/button"
import { listPurchaseOrders } from "@/lib/purchase-orders"
import { useMemoryAdapter } from "@/lib/store/adapters/memory"
import { DataTableStoreProvider } from "@/lib/store/provider/DataTableStoreProvider"
import { dataTableFeatures } from "@/lib/table/features"
import { ApiError } from "@itulah/contract/client"
import { useQuery } from "@tanstack/react-query"
import type { ColumnFiltersState, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { OrderSheet } from "@/components/sheets/po/order-sheet"
import { useOrderSheet } from "@/lib/sheets/po"
import { Plus } from "lucide-react"
import { useMemo, useState } from "react"
import { orderColumns, orderFilterFields, orderFilterSchema } from "./columns"

const PAGE = 500

/// The buyer's list of orders, and the way into any one of them.
export function PurchaseOrdersView() {
  /// Whether the buyer is naming a supplier. Held here rather than behind a
  /// hook that returned its own element: the screen already owns the two
  /// buttons that open it, and one open/closed boolean is not worth a wrapper
  /// that hides where the dialog is rendered.
  const [choosingSupplier, setChoosingSupplier] = useState(false)
  // Opening an order writes a query parameter rather than changing route, so
  // the filters and the sort that found it are still here when it closes.
  const sheet = useOrderSheet()
  const open = sheet.open
  const orders = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: ({ signal }) => listPurchaseOrders(signal),
  })

  const rows = useMemo(() => orders.data ?? [], [orders.data])
  const filterFields = useMemo(() => orderFilterFields(rows), [rows])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([])

  const adapter = useMemoryAdapter(orderFilterSchema.definition, {
    id: "purchase-orders",
  })

  /// The columns are a factory now, because the trailing `⋯` row action has to
  /// be able to open the record and the row menu is the one cell that needs to
  /// reach the screen around it.
  const columns = useMemo(() => orderColumns({ onOpen: open }), [open])

  const table = useTable(
    useMemo(
      () => ({
        features: dataTableFeatures,
        data: rows,
        columns,
        getRowId: (row: (typeof rows)[number]) => row.purchase_order_id,
        state: {
          columnFilters,
          sorting,
          pagination: { pageIndex: 0, pageSize: PAGE },
        },
        onColumnFiltersChange: setColumnFilters,
        onSortingChange: setSorting,
        enableFilters: true,
        enableColumnFilters: true,
      }),
      [rows, columnFilters, sorting]
    )
  )

  /// The rows to draw, in the order the reader asked for.
  ///
  /// `getRowModel()` and not `getFilteredRowModel()`: the filtered model has
  /// not been through the sorter, so clicking a column header updated the
  /// state and reordered nothing. It also routes through the paginated model
  /// the shared feature set registers, which is what applies `PAGE`.
  const visible = table.getRowModel().rows
  /// The same rows as ids, so the sheet's ↑/↓ walk what the buyer filtered.
  const orderIds = useMemo(
    () => visible.map((row) => row.original.purchase_order_id),
    [visible]
  )
  /// How many orders match, which is not the same as how many are drawn once
  /// `PAGE` has had its say.
  const matching = table.getFilteredRowModel().rows.length

  return (
    <DataTableStoreProvider adapter={adapter}>
      <DataTableProvider
        table={table}
        columns={columns}
        filterFields={filterFields}
        columnFilters={columnFilters}
        sorting={sorting}
        isLoading={orders.isPending}
      >
        {/* No facet column. Sourcing faceting a catalogue of 2,811 items earns
            248px of permanent width; an order list of this size does not — the
            column stood mostly empty and pushed the table it was meant to help
            into two thirds of the screen. The same filters remain reachable
            from the toolbar. */}
        <AppShell data-cloudhub nav={<Nav />}>
          <ScreenHeader
            eyebrow="Buying"
            title="Purchase orders"
            subtitle={
              orders.isPending
                ? "loading…"
                : `${matching} order${matching === 1 ? "" : "s"}`
            }
          >
            <DataTableResetButton />
            {/* Straight to a draft by naming the supplier. Sourcing is still
                one click away in the rail for a buyer who is shopping rather
                than ordering something they have already decided on. */}
            <Button size="sm" onClick={() => setChoosingSupplier(true)}>
              <Plus className="size-3.5" />
              New PO
            </Button>
          </ScreenHeader>
          <SupplierPicker
            open={choosingSupplier}
            onOpenChange={setChoosingSupplier}
          />

          <ScreenBody>
            {orders.isPending ? (
              <ScreenState>Loading orders…</ScreenState>
            ) : orders.isError ? (
              <ScreenState
                tone="problem"
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void orders.refetch()}
                  >
                    Try again
                  </Button>
                }
              >
                {orders.error instanceof ApiError
                  ? orders.error.message
                  : "The orders could not be loaded."}
              </ScreenState>
            ) : visible.length === 0 ? (
              <ScreenState
                action={
                  rows.length === 0 ? (
                    <Button size="sm" onClick={() => setChoosingSupplier(true)}>
                      <Plus className="size-3.5" />
                      Raise one
                    </Button>
                  ) : undefined
                }
              >
                {rows.length === 0
                  ? "No purchase orders have been raised yet."
                  : "No orders match these filters."}
              </ScreenState>
            ) : (
              <DataGrid
                table={table}
                onRowClick={(row) => open(row.original.purchase_order_id)}
              />
            )}
          </ScreenBody>
          <OrderSheet rows={orderIds} />
        </AppShell>
      </DataTableProvider>
    </DataTableStoreProvider>
  )
}
