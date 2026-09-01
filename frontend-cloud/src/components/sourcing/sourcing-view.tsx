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
import { PoSheet } from "@/components/po/po-sheet"
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
import { listSuppliers, useSourcingCatalogue } from "@/lib/sourcing"
import { useQuery } from "@tanstack/react-query"
import { useMemoryAdapter } from "@/lib/store/adapters/memory"
import { DataTableStoreProvider } from "@/lib/store/provider/DataTableStoreProvider"
import { dataTableFeatures } from "@/lib/table/features"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
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
/// One screenful and then some. Small enough that the first page paints
/// quickly on a shop's connection, large enough that a scroll does not stop
/// every few rows.
const PAGE = 120

export function SourcingView() {
  const navigate = useNavigate()
  const [search, setSearch] = useState("")
  const query = useDebounce(search, 250)
  const [layout, setLayout] = useState<"grid" | "table">("grid")
  const [openItemId, setOpenItemId] = useState<string | null>(null)


  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  /// The facets the server filters on, lifted out of the table's own filter
  /// state. They were applied in the browser, which only ever narrowed the rows
  /// that had already arrived — so "Kids" searched the part of the catalogue
  /// that happened to have loaded and reported that as the whole of it.
  const selected = useCallback(
    (id: string): string[] => {
      const value = columnFilters.find((filter) => filter.id === id)?.value
      return Array.isArray(value) ? value.map(String) : value === undefined ? [] : [String(value)]
    },
    [columnFilters],
  )
  const priceRange = useMemo(() => {
    const value = columnFilters.find((filter) => filter.id === "price")?.value
    const numbers = (Array.isArray(value) ? value : []).map(Number).filter(Number.isFinite)
    if (numbers.length === 0) return { priceMin: undefined, priceMax: undefined }
    const sorted = [...numbers].sort((a, b) => a - b)
    return { priceMin: sorted[0], priceMax: sorted[sorted.length - 1] }
  }, [columnFilters])

  const items = useSourcingCatalogue({
    q: query,
    divisionCodes: selected("division"),
    tagCodes: selected("tags"),
    supplierIds: selected("supplier"),
    ...priceRange,
    limit: PAGE,
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

  const rows = useMemo<SourcingRow[]>(() => items.items.map(toSourcingRow), [items.items])
  const vocabulary = useVocabulary()
  const suppliers = useQuery({
    queryKey: ["suppliers", "all"],
    queryFn: ({ signal }) => listSuppliers(undefined, signal),
    staleTime: 10 * 60 * 1000,
  })
  const supplierName = useCallback(
    (id: string) => suppliers.data?.find((row) => row.supplier_id === id)?.name ?? id,
    [suppliers.data],
  )
  /// Facet counts come from the server, over the whole catalogue.
  ///
  /// The data-table computes these itself by default, from the rows it holds —
  /// which is right when it holds all of them and wrong the moment the list is
  /// paged: it would report "Kids 33" about a catalogue holding 751, and the
  /// number would climb as the buyer scrolled. This is the library's own hook
  /// for handing it a better answer.
  const facetCounts = useCallback(
    (_table: unknown, columnId: string): Map<string, number> => {
      const source =
        columnId === "division"
          ? items.facets?.divisions
          : columnId === "tags"
            ? items.facets?.tags
            : columnId === "supplier"
              ? items.facets?.suppliers
              : undefined
      return new Map((source ?? []).map((entry) => [entry.value, entry.count]))
    },
    [items.facets],
  )

  const filterFields = useMemo(
    () => sourcingFilterFields(rows, vocabulary, items.facets, supplierName),
    [rows, vocabulary, items.facets, supplierName],
  )
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
        // No pages. The catalogue is paged over the wire, and the rows that
        // have arrived are all meant to be on screen — a page size here would
        // cap the grid at one request's worth and quietly stop growing while
        // the header went on counting.
        pagination: { pageIndex: 0, pageSize: Number.MAX_SAFE_INTEGER },
      },
      onColumnFiltersChange: setColumnFilters,
      onSortingChange: setSorting,
      onRowSelectionChange: setRowSelection,
      onColumnVisibilityChange: setColumnVisibility,
      enableFilters: true,
      enableColumnFilters: true,
      // The server does the filtering now. Left on, the table would filter the
      // page a second time — harmlessly for division and tags, but the price
      // slider and the supplier list would silently narrow to whatever had
      // scrolled into view.
      manualFiltering: true,
    }),
    [rows, columns, columnFilters, sorting, rowSelection, columnVisibility],
  )

  const table = useTable(tableOptions)
  const visible = table.getRowModel().rows.map((row) => row.original)
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
        getFacetedUniqueValues={facetCounts}
        totalRows={items.total}
        filterRows={rows.length}
      >
        <AppShell nav={<Nav />} facets={<DataTableFilterControls />}>
          <ScreenHeader
            title="Sourcing"
            subtitle={
              items.isPending
                ? "loading…"
                : `${items.total} item${items.total === 1 ? "" : "s"}` +
                  (rows.length < items.total ? ` · ${rows.length} shown` : "") +
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
                onReachEnd={
                  items.hasNextPage && !items.isFetchingNextPage
                    ? () => void items.fetchNextPage()
                    : undefined
                }
                loadingMore={items.isFetchingNextPage}
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
                {/* Straight to an order when the selection is one supplier's.
                    A purchase order goes to exactly one supplier, so offering
                    this across a mixed selection would promise something that
                    cannot be delivered — the basket is the right stop then. */}
                {new Set(orderable.map((row) => row.supplierId)).size === 1 && (
                  <PoSheet supplierId={orderable[0].supplierId}>
                    <Button size="sm" variant="outline">
                      Draft PO
                    </Button>
                  </PoSheet>
                )}
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
