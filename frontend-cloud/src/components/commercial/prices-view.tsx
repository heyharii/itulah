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
import { Input } from "@/components/ui/input"
import type { CommercialChannel } from "@/lib/commercial"
import {
  CHANNELS,
  isMarkedDown,
  localInstantToIso,
  shelfPrices,
  shelfPricesKey,
} from "@/lib/commercial"
import { money, units } from "@/lib/money"
import { useDestinations } from "@/lib/basket"
import { useMemoryAdapter } from "@/lib/store/adapters/memory"
import { DataTableStoreProvider } from "@/lib/store/provider/DataTableStoreProvider"
import { dataTableFeatures } from "@/lib/table/features"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import type { ColumnFiltersState, SortingState } from "@tanstack/react-table"
import { flexRender, useTable } from "@tanstack/react-table"
import { BookOpen, Clock, RotateCcw } from "lucide-react"
import { useMemo, useState } from "react"
import type { PriceRow } from "./columns"
import {
  priceColumns,
  priceFilterFields,
  priceFilterSchema,
  toPriceRows,
} from "./columns"

/// How many rows are drawn before the rest wait behind a button.
///
/// A shop's range is thousands of SKUs and the browser will draw all of them if
/// asked, slowly. The number is high enough that a filtered view is almost
/// always whole and low enough that the first paint is immediate.
const DRAWN = 400

/// What one shop is charging, product by product.
///
/// This is the screen a merchandiser opens to check a price, so of every screen
/// in the system it is the worst one to have a second opinion. It does not
/// compute anything: the server answers it with `pricing-engine`, the same
/// evaluator the till in that shop runs, over the same price book. A shirt on
/// clearance shows here at the clearance price because the counter would charge
/// the clearance price.
///
/// Promotions are absent by design, not by omission. "Buy two, get twenty per
/// cent" is a statement about a basket and not this product's price; putting it
/// on a shelf-edge list would promise a number the counter will not honour for
/// one item.
export function PricesView() {
  const destinations = useDestinations()
  const shops = useMemo(() => {
    const rows = destinations.data ?? []
    // Shops first: a price book is dispatched to STORE origins, so a warehouse
    // can be priced but nobody there is selling. It stays in the list because
    // the engine will answer for it and "what would this cost at the DC" is a
    // fair question — it is just not the first one.
    return [...rows].sort((left, right) =>
      left.node_role === right.node_role
        ? left.label.localeCompare(right.label)
        : left.node_role === "STORE"
          ? -1
          : 1,
    )
  }, [destinations.data])

  /// The shop being priced, once somebody has chosen one.
  ///
  /// Empty means "nobody has chosen", and the first shop stands in until they
  /// do. Derived rather than written into state by an effect: a default written
  /// on arrival is a default that has to be un-written when the list of shops
  /// changes underneath it, and one that is merely read cannot go stale.
  const [chosen, setChosen] = useState("")
  const site = chosen !== "" ? chosen : (shops[0]?.site_id ?? "")
  const [channel, setChannel] = useState<CommercialChannel>("STORE")
  /// Empty means now. The engine takes the instant as an argument, so asking
  /// what a shop will charge on the first morning of a campaign is the same
  /// code path as asking what it charges at this second.
  const [at, setAt] = useState("")
  const [drawn, setDrawn] = useState(DRAWN)

  const scope = { siteId: site, channel, at: localInstantToIso(at) }
  const prices = useQuery({
    queryKey: shelfPricesKey(scope),
    queryFn: ({ signal }) => shelfPrices(scope, signal),
    enabled: site !== "",
  })

  const rows = useMemo(() => toPriceRows(prices.data?.items ?? []), [prices.data])
  const filterFields = useMemo(() => priceFilterFields(rows), [rows])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([])

  const adapter = useMemoryAdapter(priceFilterSchema.definition, { id: "commercial-prices" })

  const table = useTable(
    useMemo(
      () => ({
        features: dataTableFeatures,
        data: rows,
        columns: priceColumns,
        getRowId: (row: (typeof rows)[number]) => row.sku_code,
        state: {
          columnFilters,
          sorting,
          pagination: { pageIndex: 0, pageSize: rows.length || 1 },
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
  const markedDown = visible.filter((row) => isMarkedDown(row.original)).length
  // What the shop is giving away on the rows in view, per unit. Not a forecast
  // of anything — nobody knows how many will sell — but it is the honest answer
  // to "how deep is this clearance".
  const given = visible.reduce(
    (sum, row) =>
      sum + Math.max(0, row.original.base_unit_price_minor - row.original.unit_price_minor),
    0,
  )
  const currency = rows[0]?.currency ?? "IDR"
  // A range priced out of several books is ordinary — each one only changed
  // what it named — so the newest is reported rather than "the" version.
  const newestBook = rows.reduce(
    (high: number, row: PriceRow) => Math.max(high, row.version),
    0,
  )

  return (
    <DataTableStoreProvider adapter={adapter}>
      <DataTableProvider
        table={table}
        columns={priceColumns}
        filterFields={filterFields}
        columnFilters={columnFilters}
        sorting={sorting}
        isLoading={prices.isPending}
      >
        <AppShell nav={<Nav />} facets={<DataTableFilterControls />}>
          <ScreenHeader
            title="Prices"
            subtitle={
              site === ""
                ? "pick a shop"
                : prices.isPending
                  ? "loading…"
                  : `${units(visible.length)} product${visible.length === 1 ? "" : "s"}`
            }
          >
            <select
              value={site}
              onChange={(event) => setChosen(event.target.value)}
              aria-label="Shop"
              className="border-input bg-background h-8 max-w-44 rounded-md border px-2 text-xs"
            >
              {shops.length === 0 && <option value="">No shops</option>}
              {shops.map((shop) => (
                <option key={shop.site_id} value={shop.site_id}>
                  {shop.label}
                  {shop.node_role === "STORE" ? "" : ` · ${shop.node_role}`}
                </option>
              ))}
            </select>

            <div className="bg-muted flex items-center gap-0.5 rounded-md p-0.5">
              {CHANNELS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setChannel(option)}
                  className={cn(
                    "rounded px-2 py-1 text-[11px] capitalize transition-colors",
                    channel === option
                      ? "bg-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option.toLowerCase()}
                </button>
              ))}
            </div>

            <AsOf value={at} onChange={setAt} />
            <DataTableResetButton />
            {/* Where a wrong price is answered. The two screens are one place
                as far as the rail is concerned, so the way between them lives
                here rather than in a second rail entry. */}
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link to="/commercial/books" />}
            >
              <BookOpen className="size-3.5" />
              Books
            </Button>
          </ScreenHeader>

          {at !== "" && (
            /* A price screen showing a moment other than now is the one thing
               on it that can be misread as fact, so it says so rather than
               leaving the reader to notice a date box they filled in earlier. */
            <div className="flex items-center gap-2 border-b bg-sky-50 px-3.5 py-1.5 text-[11.5px] text-sky-800 dark:bg-sky-950/30 dark:text-sky-300">
              <Clock className="size-3.5 shrink-0" />
              <span>
                Priced as of {new Date(at).toLocaleString("id-ID")} — not what the till is
                charging now.
              </span>
              <button
                type="button"
                onClick={() => setAt("")}
                className="ml-auto shrink-0 underline"
              >
                Back to now
              </button>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto">
            {site === "" ? (
              <ScreenState>
                {destinations.isPending
                  ? "Finding the shops…"
                  : "No shop is registered to price against."}
              </ScreenState>
            ) : prices.isPending ? (
              <ScreenState>Pricing the range…</ScreenState>
            ) : prices.isError ? (
              <ScreenState
                tone="problem"
                action={
                  <Button size="sm" variant="outline" onClick={() => void prices.refetch()}>
                    Try again
                  </Button>
                }
              >
                {prices.error instanceof ApiError
                  ? prices.error.message
                  : "The prices could not be loaded."}
              </ScreenState>
            ) : visible.length === 0 ? (
              <ScreenState>
                {rows.length === 0
                  ? "This shop has no effective prices. Either no price book has been published for it, or the one that was does not reach this channel."
                  : "No product matches these filters."}
              </ScreenState>
            ) : (
              <>
                <Table>
                  <TableHeader className="bg-muted/50">
                    {table.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id} className="hover:bg-transparent">
                        {headerGroup.headers.map((header) => (
                          <TableHead
                            key={header.id}
                            className={cn(
                              header.column.id === "unit_price_minor" && "text-right",
                            )}
                          >
                            {header.isPlaceholder
                              ? null
                              : flexRender(
                                  header.column.columnDef.header,
                                  header.getContext(),
                                )}
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {visible.slice(0, drawn).map((row) => (
                      <TableRow
                        key={row.id}
                        // Nothing dims for "not sellable": the engine drops
                        // those before pricing, so a product a shop may not
                        // sell is absent rather than greyed out.
                        className={cn(
                          isMarkedDown(row.original) && "bg-amber-50/40 dark:bg-amber-950/10",
                        )}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <TableCell
                            key={cell.id}
                            className={cn(
                              cell.column.id === "unit_price_minor" && "text-right",
                            )}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {visible.length > drawn && (
                  <div className="flex items-center justify-center gap-3 border-t p-3">
                    <span className="text-muted-foreground text-[11.5px]">
                      {units(visible.length - drawn)} more not drawn
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDrawn(drawn + DRAWN * 4)}
                    >
                      Show more
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* The two facts that belong to the whole list rather than to a row.
              Down here rather than beside the title because the title strip is
              where the controls live, and a subtitle that grows with the answer
              squeezes the name of the screen off it. */}
          {newestBook > 0 && (
            <div className="text-muted-foreground flex shrink-0 items-center gap-3 border-t px-3.5 py-2 text-[11.5px]">
              <span>Newest book in force here: v{newestBook}</span>
              {markedDown > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    {units(markedDown)} of {units(visible.length)} on markdown
                  </span>
                  <span aria-hidden>·</span>
                  <span>
                    {money(given, currency)} off per set of one, across everything in view
                  </span>
                </>
              )}
            </div>
          )}
        </AppShell>
      </DataTableProvider>
    </DataTableStoreProvider>
  )
}

/// The instant to price at.
///
/// Blank is now, and blank is the normal state — the box exists for the two
/// questions a list of current prices cannot answer: what this shop charged
/// last Tuesday, and what it will charge when the campaign starts.
function AsOf({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <Input
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Price as of"
        className="h-8 w-48 text-xs"
      />
      {value !== "" && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onChange("")}
          aria-label="Price as of now"
        >
          <RotateCcw className="size-3.5" />
        </Button>
      )}
    </div>
  )
}
