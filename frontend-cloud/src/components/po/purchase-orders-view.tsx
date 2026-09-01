import { AppShell, ScreenHeader, ScreenState } from "@/components/app-shell"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/custom/table"
import { DataTableFilterControls } from "@/components/data-table/data-table-filter-controls"
import { DataTableProvider } from "@/components/data-table/data-table-provider"
import { DataTableResetButton } from "@/components/data-table/data-table-reset-button"
import { Nav } from "@/components/nav"
import { Button } from "@/components/ui/button"
import { listPurchaseOrders } from "@/lib/purchase-orders"
import { useMemoryAdapter } from "@/lib/store/adapters/memory"
import { DataTableStoreProvider } from "@/lib/store/provider/DataTableStoreProvider"
import { dataTableFeatures } from "@/lib/table/features"
import { ApiError } from "@itulah/contract/client"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import type { ColumnFiltersState, SortingState } from "@tanstack/react-table"
import { flexRender, useTable } from "@tanstack/react-table"
import { Plus } from "lucide-react"
import { useMemo, useState } from "react"
import { orderColumns, orderFilterFields, orderFilterSchema } from "./columns"

const PAGE = 500

/// The buyer's list of orders, and the way into any one of them.
export function PurchaseOrdersView() {
  const navigate = useNavigate()
  const open = (purchaseOrderId: string) =>
    void navigate({ to: "/orders/$purchaseOrderId", params: { purchaseOrderId } })
  const orders = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: ({ signal }) => listPurchaseOrders(signal),
  })

  const rows = useMemo(() => orders.data ?? [], [orders.data])
  const filterFields = useMemo(() => orderFilterFields(rows), [rows])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([])

  const adapter = useMemoryAdapter(orderFilterSchema.definition, { id: "purchase-orders" })

  const table = useTable(
    useMemo(
      () => ({
        features: dataTableFeatures,
        data: rows,
        columns: orderColumns,
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
      [rows, columnFilters, sorting],
    ),
  )

  const visible = table.getFilteredRowModel().rows

  return (
    <DataTableStoreProvider adapter={adapter}>
      <DataTableProvider
        table={table}
        columns={orderColumns}
        filterFields={filterFields}
        columnFilters={columnFilters}
        sorting={sorting}
        isLoading={orders.isPending}
      >
        <AppShell nav={<Nav />} facets={<DataTableFilterControls />}>
          <ScreenHeader
            title="Purchase orders"
            subtitle={
              orders.isPending
                ? "loading…"
                : `${visible.length} order${visible.length === 1 ? "" : "s"}`
            }
          >
            <DataTableResetButton />
            <Button size="sm" onClick={() => void navigate({ to: "/" })}>
              <Plus className="size-3.5" />
              New PO
            </Button>
          </ScreenHeader>

          <div className="min-h-0 flex-1 overflow-auto">
            {orders.isPending ? (
              <ScreenState>Loading orders…</ScreenState>
            ) : orders.isError ? (
              <ScreenState
                tone="problem"
                action={
                  <Button size="sm" variant="outline" onClick={() => void orders.refetch()}>
                    Try again
                  </Button>
                }
              >
                {orders.error instanceof ApiError
                  ? orders.error.message
                  : "The orders could not be loaded."}
              </ScreenState>
            ) : visible.length === 0 ? (
              <ScreenState>
                {rows.length === 0
                  ? "No purchase orders have been raised yet."
                  : "No orders match these filters."}
              </ScreenState>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id} className="hover:bg-transparent">
                      {headerGroup.headers.map((header) => (
                        <TableHead key={header.id}>
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {visible.map((row) => (
                    <TableRow
                      key={row.id}
                      tabIndex={0}
                      role="button"
                      onClick={() => open(row.original.purchase_order_id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          open(row.original.purchase_order_id)
                        }
                      }}
                      className="cursor-pointer"
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </AppShell>
      </DataTableProvider>
    </DataTableStoreProvider>
  )
}
