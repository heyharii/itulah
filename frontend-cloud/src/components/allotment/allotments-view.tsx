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
import type { DestinationRollup } from "@/lib/allotments"
import { allotmentListKey, humanise, listAllotments } from "@/lib/allotments"
import { units } from "@/lib/money"
import { useMemoryAdapter } from "@/lib/store/adapters/memory"
import { DataTableStoreProvider } from "@/lib/store/provider/DataTableStoreProvider"
import { dataTableFeatures } from "@/lib/table/features"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import type { ColumnFiltersState, SortingState } from "@tanstack/react-table"
import { flexRender, useTable } from "@tanstack/react-table"
import { AlertTriangle, Plus } from "lucide-react"
import { useMemo, useState } from "react"
import {
  allotmentColumns,
  allotmentFilterFields,
  allotmentFilterSchema,
} from "./columns"

const PAGE = 500

/// What the centre has promised, and how much of it has actually gone.
///
/// Destination is filtered on the server rather than in the table, and that is
/// forced rather than chosen: a list row carries its totals but not its
/// destination — an Allotment can have lines going to several — so the only
/// honest way to ask "what is owed to this store" is to ask the server.
export function AllotmentsView() {
  const navigate = useNavigate()
  const [destination, setDestination] = useState("")
  const [panel, setPanel] = useState<"allotments" | "destinations">("allotments")
  const [showShortages, setShowShortages] = useState(false)

  const allotments = useQuery({
    queryKey: allotmentListKey(destination),
    queryFn: ({ signal }) =>
      listAllotments(
        { limit: PAGE, ...(destination === "" ? {} : { destination_id: destination }) },
        signal,
      ),
    // Picking happens in a warehouse, not on this screen. A list left open goes
    // stale within the minute it takes somebody there to scan a carton.
    refetchInterval: 60_000,
  })

  const rows = useMemo(() => allotments.data?.items ?? [], [allotments.data])
  const destinations = allotments.data?.by_destination ?? []
  const shortages = allotments.data?.shortages ?? []
  const filterFields = useMemo(() => allotmentFilterFields(rows), [rows])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([])

  const adapter = useMemoryAdapter(allotmentFilterSchema.definition, { id: "allotments" })

  const table = useTable(
    useMemo(
      () => ({
        features: dataTableFeatures,
        data: rows,
        columns: allotmentColumns,
        getRowId: (row: (typeof rows)[number]) => row.id,
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
  const reserved = visible.reduce((sum, row) => sum + row.original.remaining_quantity, 0)

  const open = (allotmentId: string) =>
    void navigate({ to: "/allotments/$allotmentId", params: { allotmentId } })

  return (
    <DataTableStoreProvider adapter={adapter}>
      <DataTableProvider
        table={table}
        columns={allotmentColumns}
        filterFields={filterFields}
        columnFilters={columnFilters}
        sorting={sorting}
        isLoading={allotments.isPending}
      >
        <AppShell nav={<Nav />} facets={<DataTableFilterControls />}>
          <ScreenHeader
            title="Allotments"
            subtitle={
              allotments.isPending
                ? "loading…"
                : `${visible.length} allotment${visible.length === 1 ? "" : "s"} · ${units(reserved)} still reserved`
            }
          >
            <select
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              aria-label="Destination"
              className="border-input bg-background h-8 rounded-md border px-2 text-xs"
            >
              <option value="">Every destination</option>
              {destinations.map((rollup) => (
                <option key={rollup.destination_id} value={rollup.destination_id}>
                  {rollup.destination_name ?? rollup.destination_id}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant={panel === "destinations" ? "secondary" : "ghost"}
              onClick={() =>
                setPanel(panel === "destinations" ? "allotments" : "destinations")
              }
            >
              By destination
            </Button>
            <DataTableResetButton />
            <Button size="sm" onClick={() => void navigate({ to: "/allotments/new" })}>
              <Plus className="size-3.5" />
              New allotment
            </Button>
          </ScreenHeader>

          {shortages.length > 0 && (
            <div className="border-b bg-amber-50 px-3.5 py-2 dark:bg-amber-950/30">
              <button
                type="button"
                onClick={() => setShowShortages(!showShortages)}
                className="flex w-full items-center gap-2 text-left text-[12px] text-amber-700 dark:text-amber-400"
              >
                <AlertTriangle className="size-3.5 shrink-0" />
                <span>
                  {shortages.length} SKU{shortages.length === 1 ? " is" : "s are"} promised out
                  of the DC warehouse beyond what is in it.
                </span>
                <span className="ml-auto shrink-0 underline">
                  {showShortages ? "Hide" : "Show"}
                </span>
              </button>
              {showShortages && (
                <div className="max-h-56 overflow-auto pt-2">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>SKU</TableHead>
                        <TableHead>Article</TableHead>
                        <TableHead className="text-right">Stock</TableHead>
                        <TableHead className="text-right">Allotted</TableHead>
                        <TableHead className="text-right">Short by</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {shortages.map((shortage) => (
                        <TableRow key={shortage.sku_id}>
                          <TableCell className="font-mono text-[11px]">
                            {shortage.sku_code}
                          </TableCell>
                          <TableCell className="truncate text-xs">
                            {shortage.article_name}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs tabular-nums">
                            {units(shortage.stock_qty)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs tabular-nums">
                            {units(shortage.allotted_qty)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-medium tabular-nums text-amber-600">
                            {units(shortage.shortage_qty)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto">
            {allotments.isPending ? (
              <ScreenState>Loading allotments…</ScreenState>
            ) : allotments.isError ? (
              <ScreenState
                tone="problem"
                action={
                  <Button size="sm" variant="outline" onClick={() => void allotments.refetch()}>
                    Try again
                  </Button>
                }
              >
                {allotments.error instanceof ApiError
                  ? allotments.error.message
                  : "The allotments could not be loaded."}
              </ScreenState>
            ) : panel === "destinations" ? (
              <DestinationRollups
                rollups={destinations}
                onPick={(destinationId) => {
                  setDestination(destinationId)
                  setPanel("allotments")
                }}
              />
            ) : visible.length === 0 ? (
              <ScreenState>
                {rows.length === 0
                  ? "Nothing has been allotted yet."
                  : "No allotments match these filters."}
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
                      onClick={() => open(row.original.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          open(row.original.id)
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

/// Every destination, whatever the filters say.
///
/// The server sums this over the whole table rather than over the rows on
/// screen, so it answers "what is owed to this store" and not "what is owed on
/// this list". Filtering the list from a row here is the one place the two
/// meet.
function DestinationRollups({
  rollups,
  onPick,
}: {
  rollups: readonly DestinationRollup[]
  onPick: (destinationId: string) => void
}) {
  if (rollups.length === 0) {
    return <ScreenState>Nothing has been allotted to anywhere yet.</ScreenState>
  }
  return (
    <Table>
      <TableHeader className="bg-muted/50">
        <TableRow className="hover:bg-transparent">
          <TableHead>Destination</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead className="text-right">Allotted</TableHead>
          <TableHead className="text-right">Accepted</TableHead>
          <TableHead className="text-right">Picked</TableHead>
          <TableHead className="text-right">In transit</TableHead>
          <TableHead className="text-right">Received</TableHead>
          <TableHead className="text-right">Cancelled</TableHead>
          <TableHead className="text-right">Still reserved</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rollups.map((rollup) => (
          <TableRow
            key={`${rollup.destination_type}:${rollup.destination_id}`}
            tabIndex={0}
            role="button"
            className="cursor-pointer"
            onClick={() => onPick(rollup.destination_id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onPick(rollup.destination_id)
              }
            }}
          >
            <TableCell>
              <div className="min-w-0">
                <div className="truncate text-[13px]">
                  {rollup.destination_name ?? rollup.destination_id}
                </div>
                <div className="text-muted-foreground truncate font-mono text-[10.5px]">
                  {rollup.destination_id}
                </div>
              </div>
            </TableCell>
            <TableCell className="text-xs">{humanise(rollup.destination_type)}</TableCell>
            <Figure value={rollup.total_quantity} />
            <Figure value={rollup.total_accepted_quantity} />
            <Figure value={rollup.total_picked_quantity} />
            <Figure value={rollup.total_in_transit_quantity} />
            <Figure value={rollup.total_received_quantity} />
            <Figure value={rollup.total_cancelled_quantity} />
            <Figure value={rollup.remaining_quantity} highlight />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function Figure({ value, highlight }: { value: number; highlight?: boolean }) {
  return (
    <TableCell
      className={cn(
        "text-right font-mono text-xs tabular-nums",
        highlight === true && value > 0 && "text-amber-600",
      )}
    >
      {units(value)}
    </TableCell>
  )
}
