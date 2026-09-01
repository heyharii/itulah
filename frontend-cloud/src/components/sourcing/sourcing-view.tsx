import { AppShell, ScreenHeader, ScreenState } from "@/components/app-shell"
import { DataTableFilterControls } from "@/components/data-table/data-table-filter-controls"
import { DataTableFloatingBar } from "@/components/data-table/data-table-floating-bar"
import { DataTableProvider } from "@/components/data-table/data-table-provider"
import { DataTableResetButton } from "@/components/data-table/data-table-reset-button"
import { DataTableViewOptions } from "@/components/data-table/data-table-view-options"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/custom/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDebounce } from "@/hooks/use-debounce"
import { searchSourcedItems } from "@/lib/sourcing"
import { money } from "@/lib/money"
import { useShortlist } from "@/lib/shortlist"
import { useMemoryAdapter } from "@/lib/store/adapters/memory"
import { DataTableStoreProvider } from "@/lib/store/provider/DataTableStoreProvider"
import { dataTableFeatures } from "@/lib/table/features"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import { useQuery } from "@tanstack/react-query"
import type {
  ColumnFiltersState,
  ColumnVisibilityState,
  RowSelectionState,
  SortingState,
} from "@tanstack/react-table"
import { flexRender, useTable } from "@tanstack/react-table"
import { LayoutGrid, List, Search, Star } from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import { sourcingColumns, sourcingFilterFields, sourcingFilterSchema } from "./columns"
import { ProductGrid } from "./product-grid"
import { bySupplier, quoteTotal, toSourcingRow, type SourcingRow } from "./rows"

/// How many candidates one request may return.
///
/// Raised from the server's default of 120 and used as the table's page size,
/// so the rows on screen are the rows that were fetched. The facets in the rail
/// are computed from this set; a paged fetch would make them the facets of a
/// page, which reads as the facets of the catalogue and is not.
const PAGE = 500

export function SourcingView({
  nav,
  staged,
  onDraft,
}: {
  nav: React.ReactNode
  /// The shortlist is the same rows, narrowed to what has been starred — a
  /// scope, not a second screen. It is the one view where the rows are grouped
  /// by supplier, because that is the shape an order has to be raised in.
  staged: boolean
  onDraft: (supplierId: string, itemIds: string[]) => void
}) {
  const shortlist = useShortlist()
  const [search, setSearch] = useState("")
  const query = useDebounce(search, 250)
  const [layout, setLayout] = useState<"grid" | "table">("grid")

  const items = useQuery({
    queryKey: ["sourcing", "items", query],
    queryFn: ({ signal }) => searchSourcedItems({ q: query, limit: PAGE }, signal),
  })

  const rows = useMemo<SourcingRow[]>(() => {
    const mapped = (items.data ?? []).map(toSourcingRow)
    return staged ? mapped.filter((row) => shortlist.has(row.id)) : mapped
  }, [items.data, staged, shortlist])

  const columns = useMemo(
    () => sourcingColumns(shortlist.has, shortlist.toggle),
    [shortlist],
  )
  const filterFields = useMemo(() => sourcingFilterFields(rows), [rows])

  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({})

  // Row selection is a set, spelled as a map of the ids that are in it — an id
  // mapped to `false` is not "unselected", it is a third state the table's own
  // type does not have.
  const select = useCallback((id: string, selected: boolean) => {
    setRowSelection((current) => {
      const next = { ...current }
      if (selected) next[id] = true
      else delete next[id]
      return next
    })
  }, [])

  const adapter = useMemoryAdapter(sourcingFilterSchema.definition, {
    id: staged ? "shortlist" : "sourcing",
  })

  const tableOptions = useMemo(
    () => ({
      features: dataTableFeatures,
      data: rows,
      columns,
      // The shortlist and the selection both address `supplier_item_id`, so the
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
  const groups = useMemo(() => bySupplier(visible), [visible])
  const total = quoteTotal(visible)

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
        <AppShell nav={nav} facets={<DataTableFilterControls />}>
          <ScreenHeader
            title={staged ? "Shortlist" : "Sourcing"}
            subtitle={
              items.isPending
                ? "loading…"
                : `${visible.length} item${visible.length === 1 ? "" : "s"}` +
                  (staged ? ` · ${groups.length} supplier${groups.length === 1 ? "" : "s"}` : "") +
                  // Only when it means something: a mixed-currency selection has
                  // no total, and saying so is the point of `quoteTotal`.
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
                  // of rows. Left alone, the floating bar would offer to order
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

            {staged && shortlist.count > 0 && (
              <Button variant="ghost" size="sm" onClick={shortlist.clear}>
                Clear
              </Button>
            )}
          </ScreenHeader>

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
              <ScreenState>
                {staged
                  ? shortlist.count === 0
                    ? "Nothing is shortlisted yet. Star an item in Sourcing to stage it for an order."
                    : "Nothing shortlisted matches these filters."
                  : "No supplier items match this search."}
              </ScreenState>
            ) : staged ? (
              groups.map((group) => (
                <section key={group.supplierId} className="border-b last:border-b-0">
                  <SupplierGroupHeader
                    supplier={group.supplier}
                    rows={group.rows}
                    onDraft={() =>
                      onDraft(
                        group.supplierId,
                        group.rows.map((row) => row.id),
                      )
                    }
                  />
                  {layout === "grid" ? (
                    <ProductGrid
                      rows={group.rows}
                      isSelected={(id) => rowSelection[id] === true}
                      onSelect={(id, selected) => select(id, selected)}
                      isShortlisted={shortlist.has}
                      onToggleShortlist={shortlist.toggle}
                    />
                  ) : (
                    <RowTable rows={group.rows} table={table} />
                  )}
                </section>
              ))
            ) : layout === "grid" ? (
              <ProductGrid
                rows={visible}
                isSelected={(id) => rowSelection[id] === true}
                onSelect={(id, selected) => select(id, selected)}
                isShortlisted={shortlist.has}
                onToggleShortlist={shortlist.toggle}
              />
            ) : (
              <RowTable rows={visible} table={table} />
            )}
          </div>
        </AppShell>

        <DataTableFloatingBar<SourcingRow>>
          {({ rows: selected, table: selectionTable }) => {
            const picked = selected.map((row) => row.original)
            const suppliers = new Set(picked.map((row) => row.supplierId))
            const one = suppliers.size === 1 ? picked[0].supplierId : null
            return (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => shortlist.add(picked.map((row) => row.id))}
                >
                  <Star className="size-3.5" />
                  Shortlist
                </Button>
                <Button
                  size="sm"
                  disabled={one === null}
                  title={
                    one === null
                      ? "One purchase order goes to one supplier. Narrow the selection to a single supplier first."
                      : undefined
                  }
                  onClick={() => {
                    if (one === null) return
                    onDraft(
                      one,
                      picked.map((row) => row.id),
                    )
                    selectionTable.resetRowSelection()
                  }}
                >
                  Draft PO
                </Button>
              </>
            )
          }}
        </DataTableFloatingBar>
      </DataTableProvider>
    </DataTableStoreProvider>
  )
}

/// One supplier's staged items, and the order they would become.
function SupplierGroupHeader({
  supplier,
  rows,
  onDraft,
}: {
  supplier: string
  rows: readonly SourcingRow[]
  onDraft: () => void
}) {
  const total = quoteTotal(rows)
  return (
    <div className="bg-muted/40 flex h-11 items-center gap-3 border-b px-3.5">
      <span className="truncate text-xs font-semibold">{supplier}</span>
      <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
        {rows.length} item{rows.length === 1 ? "" : "s"}
        {total !== null && ` · ${total.currency}`}
      </span>
      <Button size="sm" variant="outline" className="ml-auto h-7" onClick={onDraft}>
        Draft PO
      </Button>
    </div>
  )
}

/// The table body, rendered from rows the caller has already narrowed.
///
/// It takes rows rather than reading the row model itself so the staged view
/// can render one table per supplier group off the same table instance —
/// filters, sorting and selection stay in one place.
function RowTable({
  rows,
  table,
}: {
  rows: readonly SourcingRow[]
  table: ReturnType<typeof useTable<typeof dataTableFeatures, SourcingRow>>
}) {
  const wanted = new Set(rows.map((row) => row.id))
  const modelRows = table.getFilteredRowModel().rows.filter((row) => wanted.has(row.id))
  return (
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
        {modelRows.map((row) => (
          <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
