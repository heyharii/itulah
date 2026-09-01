import { AppShell, ScreenHeader, ScreenState } from "@/components/app-shell"
import { Nav } from "@/components/nav"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/custom/table"
import { DataTableFilterControls } from "@/components/data-table/data-table-filter-controls"
import { useVocabulary } from "@/lib/vocabulary"
import { DataTableFloatingBar } from "@/components/data-table/data-table-floating-bar"
import { DataTableProvider } from "@/components/data-table/data-table-provider"
import { DataTableResetButton } from "@/components/data-table/data-table-reset-button"
import { DataTableViewOptions } from "@/components/data-table/data-table-view-options"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDebounce } from "@/hooks/use-debounce"
import { useBasket, useBasketActions } from "@/lib/basket"
import { money } from "@/lib/money"
import { searchSourcedItems } from "@/lib/sourcing"
import { useMemoryAdapter } from "@/lib/store/adapters/memory"
import { DataTableStoreProvider } from "@/lib/store/provider/DataTableStoreProvider"
import { dataTableFeatures } from "@/lib/table/features"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import type {
  ColumnFiltersState,
  ColumnVisibilityState,
  RowSelectionState,
  SortingState,
} from "@tanstack/react-table"
import { flexRender, useTable } from "@tanstack/react-table"
import { LayoutGrid, List, Search, ShoppingBasket } from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import { sourcingColumns, sourcingFilterFields, sourcingFilterSchema } from "./columns"
import { ItemDetail } from "./item-detail"
import { ProductGrid } from "./product-grid"
import { quoteTotal, toSourcingRow, type SourcingRow } from "./rows"

/// How many candidates one request may return.
///
/// Raised from the server's default of 120 and used as the table's page size,
/// so the rows on screen are the rows that were fetched. The facets in the rail
/// are computed from this set; a paged fetch would make them the facets of a
/// page, which reads as the facets of the catalogue and is not.
const PAGE = 500

export function SourcingView() {
  const navigate = useNavigate()
  const [search, setSearch] = useState("")
  const query = useDebounce(search, 250)
  const [layout, setLayout] = useState<"grid" | "table">("grid")
  const [openItemId, setOpenItemId] = useState<string | null>(null)

  const items = useQuery({
    queryKey: ["sourcing", "items", query],
    queryFn: ({ signal }) => searchSourcedItems({ q: query, limit: PAGE }, signal),
  })
  const basket = useBasket()
  const { add } = useBasketActions()

  /// How many of each item is already in the basket, so the list can say so
  /// without every row asking.
  const held = useMemo(() => {
    const counts = new Map<string, number>()
    for (const line of basket.data ?? []) {
      counts.set(line.item.supplier_item_id, line.quantity)
    }
    return counts
  }, [basket.data])

  const rows = useMemo<SourcingRow[]>(
    () => (items.data ?? []).map(toSourcingRow),
    [items.data],
  )
  const vocabulary = useVocabulary()
  const filterFields = useMemo(
    () => sourcingFilterFields(rows, vocabulary),
    [rows, vocabulary],
  )

  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({})

  const select = useCallback((id: string, selected: boolean) => {
    setRowSelection((current) => {
      const next = { ...current }
      if (selected) next[id] = true
      else delete next[id]
      return next
    })
  }, [])

  const addOne = useCallback(
    (id: string) => add.mutate({ supplier_item_id: id, quantity: 1 }),
    [add],
  )

  const columns = useMemo(
    () => sourcingColumns({ held, onAdd: addOne, onOpen: setOpenItemId }),
    [held, addOne],
  )

  const adapter = useMemoryAdapter(sourcingFilterSchema.definition, { id: "sourcing" })

  const tableOptions = useMemo(
    () => ({
      features: dataTableFeatures,
      data: rows,
      columns,
      // The basket and the selection both address `supplier_item_id`, so the
      // table's own row key is that id rather than a positional index.
      getRowId: (row: SourcingRow) => row.id,
      state: {
        columnFilters,
        sorting,
        rowSelection,
        columnVisibility,
        pagination: { pageIndex: 0, pageSize: PAGE },
      },
      onColumnFiltersChange: setColumnFilters,
      onSortingChange: setSorting,
      onRowSelectionChange: setRowSelection,
      onColumnVisibilityChange: setColumnVisibility,
      enableFilters: true,
      enableColumnFilters: true,
    }),
    [rows, columns, columnFilters, sorting, rowSelection, columnVisibility],
  )

  const table = useTable(tableOptions)
  const visible = table.getFilteredRowModel().rows.map((row) => row.original)
  const total = quoteTotal(visible)
  const openRow = rows.find((row) => row.id === openItemId) ?? null

  return (
    <DataTableStoreProvider adapter={adapter}>
      <DataTableProvider
        table={table}
        columns={columns}
        filterFields={filterFields}
        columnFilters={columnFilters}
        sorting={sorting}
        rowSelection={rowSelection}
        columnVisibility={columnVisibility}
        isLoading={items.isPending}
      >
        <AppShell nav={<Nav />} facets={<DataTableFilterControls />}>
          <ScreenHeader
            title="Sourcing"
            subtitle={
              items.isPending
                ? "loading…"
                : `${visible.length} item${visible.length === 1 ? "" : "s"}` +
                  (total === null ? "" : ` · ${money(total.minor, total.currency)}`)
            }
          >
            <label className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  // A selection is a set of rows, and a new search is a new set
                  // of rows. Left alone, the floating bar would offer to add
                  // something that is no longer on screen.
                  setRowSelection({})
                }}
                placeholder="Item, code, supplier…"
                aria-label="Search the supplier catalogue"
                className="h-8 w-52 pl-7 text-xs"
              />
            </label>

            <div className="bg-muted flex items-center gap-0.5 rounded-md p-0.5">
              {(
                [
                  ["grid", LayoutGrid, "Grid view"],
                  ["table", List, "Table view"],
                ] as const
              ).map(([id, Icon, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-label={label}
                  aria-pressed={layout === id}
                  onClick={() => setLayout(id)}
                  className={cn(
                    "grid size-6 place-items-center rounded-sm transition-colors",
                    layout === id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                </button>
              ))}
            </div>

            <DataTableResetButton />
            <DataTableViewOptions />
          </ScreenHeader>

          {add.isError && (
            <div className="text-destructive border-b px-3.5 py-2 text-[11.5px]">
              {add.error instanceof ApiError
                ? add.error.message
                : "It could not be added to the basket."}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto">
            {items.isPending ? (
              <ScreenState>Loading the supplier catalogue…</ScreenState>
            ) : items.isError ? (
              <ScreenState
                tone="problem"
                action={
                  <Button size="sm" variant="outline" onClick={() => void items.refetch()}>
                    Try again
                  </Button>
                }
              >
                {items.error instanceof ApiError
                  ? items.error.message
                  : "The catalogue could not be loaded."}
              </ScreenState>
            ) : visible.length === 0 ? (
              <ScreenState>No supplier items match this search.</ScreenState>
            ) : layout === "grid" ? (
              <ProductGrid
                rows={visible}
                held={held}
                isSelected={(id) => rowSelection[id] === true}
                onSelect={select}
                vocabulary={vocabulary}
                onAdd={addOne}
                onOpen={setOpenItemId}
              />
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
                  {table.getFilteredRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() && "selected"}
                      onClick={() => setOpenItemId(row.original.id)}
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

        <DataTableFloatingBar<SourcingRow>>
          {({ rows: selected, table: selectionTable }) => {
            const picked = selected.map((row) => row.original)
            const orderable = picked.filter((row) => row.status === "ACTIVE")
            return (
              <>
                <Button
                  size="sm"
                  disabled={orderable.length === 0 || add.isPending}
                  title={
                    orderable.length === picked.length
                      ? undefined
                      : "Items on hold cannot be ordered and will be left out."
                  }
                  onClick={() => {
                    // One request per item rather than one bulk route: the
                    // server's add is per line, and a partial failure should
                    // leave the rest of the basket alone rather than rolling
                    // back a basket the buyer can see.
                    for (const row of orderable) {
                      add.mutate({ supplier_item_id: row.id, quantity: 1 })
                    }
                    selectionTable.resetRowSelection()
                  }}
                >
                  <ShoppingBasket className="size-3.5" />
                  Add {orderable.length} to basket
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void navigate({ to: "/basket" })}
                >
                  Open basket
                </Button>
              </>
            )
          }}
        </DataTableFloatingBar>

        <ItemDetail
          row={openRow}
          inBasket={openRow === null ? 0 : (held.get(openRow.id) ?? 0)}
          onClose={() => setOpenItemId(null)}
        />
      </DataTableProvider>
    </DataTableStoreProvider>
  )
}
