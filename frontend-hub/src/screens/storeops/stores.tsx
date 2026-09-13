import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { rollUp, type StoreRow } from "@/screens/storeops/roll-up"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { MiniTable, TotalsLadder } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState, Truncated } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { count, label, money, moment } from "@/lib/format"
import {
  listReturns,
  listSales,
  storeopsKeys,
  type ReturnRow,
  type SaleRow,
} from "@/lib/queries/storeops"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"

/// The fleet as the counter sees it: which shops have tills open, and how much
/// is sitting in them.
///
/// Rolled up from the sales and returns lists rather than fetched: there is no
/// site register on this module's endpoints, and inventing one would mean this
/// screen and the sales list could disagree about which shops exist. What it
/// costs is honesty about the horizon — a shop that has not traded inside the
/// last 500 sales has no row here, and the sub-heading says so rather than
/// letting an absent shop read as a closed one.
///
/// Sorted by open tills, because that is the row somebody has to do something
/// about. Takings are the follow-up question, not the first one.

const columns: ColumnDef<TableSetup, StoreRow>[] = [
  {
    accessorKey: "site_id",
    header: "Store",
    size: 170,
    /// The shop ids as the SALES rolled up here spell them, because that is
    /// the only spelling these rows carry: the centre says `dc` where the box
    /// standing in the same place says `dc-01`, and a facet built from a site
    /// register instead would offer a shop that matches none of them.
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.site_id}</span>
    ),
  },
  {
    accessorKey: "open_count",
    header: "Tills open",
    size: 110,
    // The exception, and the reason for the default sort: an open sale is a
    // basket somebody walked away from or is standing at right now.
    meta: { align: "right", filter: { kind: "number", unit: "tills" } },
    cell: ({ row }) => (
      <span
        className={
          row.original.open_count > 0 ? "font-medium text-warn-fg" : "text-mute"
        }
      >
        {row.original.open_count > 0 ? count(row.original.open_count) : "—"}
      </span>
    ),
  },
  {
    accessorKey: "owing_minor",
    header: "Owing",
    size: 140,
    meta: {
      align: "right",
      filter: { kind: "number", unit: "Rp" },
    },
    cell: ({ row }) =>
      row.original.owing_minor > 0 ? (
        <span className="text-warn-fg">{money(row.original.owing_minor)}</span>
      ) : (
        <span className="text-mute">—</span>
      ),
  },
  {
    accessorKey: "completed_count",
    header: "Sales",
    size: 100,
    // No filter: it is the denominator beside Takings rather than a question
    // anybody opens this list to ask, and one more clause in the panel is one
    // more row nobody reads.
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.completed_count),
  },
  {
    accessorKey: "takings_minor",
    header: "Takings",
    size: 150,
    /// **No `scale`, despite the `_minor` in the name.** `lib/format.ts` says
    /// it plainly — IDR has no minor unit in practice, so the server's "minor"
    /// is already whole rupiah, and `money()` prints it without dividing.
    /// A `scale: 100` here would multiply every bound by a hundred: somebody
    /// asking for shops over ten million would be asking for a billion and get
    /// an empty list with a chip above it saying otherwise.
    meta: {
      align: "right",
      filter: { kind: "number", unit: "Rp" },
    },
    cell: ({ row }) => money(row.original.takings_minor),
  },
  {
    accessorKey: "voided_count",
    header: "Voided",
    size: 100,
    /// "At least 1" is the supervisor's question, and it is a real one: a shop
    /// voiding sales is either training or something worse.
    meta: { align: "right", filter: { kind: "number", unit: "sales" } },
    cell: ({ row }) =>
      row.original.voided_count > 0 ? (
        count(row.original.voided_count)
      ) : (
        <span className="text-mute">—</span>
      ),
  },
  {
    accessorKey: "refunded_minor",
    header: "Refunded",
    size: 140,
    meta: {
      align: "right",
      filter: { kind: "number", unit: "Rp" },
    },
    cell: ({ row }) =>
      row.original.refunded_minor > 0 ? (
        money(row.original.refunded_minor)
      ) : (
        <span className="text-mute">—</span>
      ),
  },
]

/// What each of the two source lists asks for, named once so the banner and
/// the requests cannot disagree. Every figure on a row here is a sum over
/// whichever of them arrived.
const CAP = 500

export function Stores() {
  const [query, setQuery] = useState("")
  const store = useSheet("store")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "open_count", desc: true },
  ])

  const sales = useQuery({
    queryKey: storeopsKeys.sales("any"),
    queryFn: ({ signal }) => listSales({ limit: CAP }, signal),
  })
  const returns = useQuery({
    queryKey: storeopsKeys.returns(),
    queryFn: ({ signal }) => listReturns({ limit: CAP }, signal),
  })

  const rows = useMemo(
    () => rollUp(sales.data ?? [], returns.data?.rows ?? []),
    [sales.data, returns.data]
  )

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: StoreRow) => row.site_id,
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

  /// The roll-up's arithmetic is only as complete as the two lists under it,
  /// and neither says how much it left behind. A cap reached on EITHER is a
  /// figure on every row that is a partial sum — which is worth saying out
  /// loud now that the panel above can narrow the rows further.
  const capped =
    (sales.data?.length ?? 0) >= CAP || (returns.data?.rows.length ?? 0) >= CAP

  return (
    <PageContent>
      <PageHeader
        crumb="Store ops"
        title="Stores"
        sub="Rolled up from the last 500 sales and returns the centre holds — a shop quiet for longer than that has no row."
        actions={
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="h-8 w-48"
          />
        }
      />

      <Toolbar>
        <FilterPanel model={filters} table={table} />
      </Toolbar>

      {capped && (
        <Truncated
          limit={CAP}
          noun="sales and returns the roll-up is built from"
        />
      )}

      <Card className="overflow-hidden">
        {queryState(sales, {
          loading: "Loading the fleet…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                No shop has reported a sale to the centre yet.
              </EmptyState>
            ) : (
              <DataTable<StoreRow>
                table={table}
                onRowClick={(row) => store.open(row.site_id)}
                isSelected={(row) => row.site_id === store.value}
                empty={
                  <>
                    None of the {rows.length.toLocaleString("id-ID")} shops
                    trading here match this search and the filters in force.
                  </>
                }
                className="max-h-[calc(100vh-14rem)]"
              />
            ),
        })}
      </Card>

      <StoreSheet
        siteId={store.value ?? null}
        onClose={store.close}
        sales={sales.data ?? []}
        returns={returns.data?.rows ?? []}
      />
    </PageContent>
  )
}

/// One shop, from what the two lists already hold.
///
/// It does not fetch: the whole point of the roll-up is that the rows and the
/// detail are the same arithmetic over the same answer, and a second request
/// here could return a different 500 sales and make the two disagree.
function StoreSheet({
  siteId,
  onClose,
  sales,
  returns,
}: {
  siteId: string | null
  onClose: () => void
  sales: readonly SaleRow[]
  returns: readonly ReturnRow[]
}) {
  const mine = sales.filter((sale) => sale.site_id === siteId)
  const refunds = returns.filter((entry) => entry.site_id === siteId)
  const totals = siteId === null ? undefined : rollUp(mine, refunds)[0]

  return (
    <Sheet
      open={siteId !== null}
      onOpenChange={(open) => !open && onClose()}
      id={siteId ?? undefined}
      title="Store"
      actions={
        siteId !== null ? (
          // No dead ends: from a shop's roll-up to its own receipts, and to the
          // day-close report that reconciles its drawer.
          <>
            <AppLink
              to="/storeops/sales"
              sheet={{ key: "store", value: siteId }}
              className="inline-flex h-[1.625rem] shrink-0 items-center rounded-full bg-soft-2 px-2.5 text-[0.71875rem] font-medium text-text transition-colors hover:bg-hairline"
            >
              Receipts
            </AppLink>
            <AppLink
              to="/reports"
              sheet={{ key: "store", value: siteId }}
              className="inline-flex h-[1.625rem] shrink-0 items-center rounded-full bg-soft-2 px-2.5 text-[0.71875rem] font-medium text-text transition-colors hover:bg-hairline"
            >
              Day close
            </AppLink>
          </>
        ) : undefined
      }
    >
      {totals === undefined ? (
        <EmptyState>That store has nothing in the last 500 sales.</EmptyState>
      ) : (
        <div className="flex flex-col gap-5">
          <Facts>
            <Fact term="Tills open">{count(totals.open_count)}</Fact>
            <Fact term="Owing">{money(totals.owing_minor)}</Fact>
            <Fact term="Sales">{count(totals.completed_count)}</Fact>
            <Fact term="Voided">{count(totals.voided_count)}</Fact>
          </Facts>

          <div>
            <h4 className="mb-2 text-card-title font-semibold text-ink">
              Latest at this counter
            </h4>
            <MiniTable head={["Sale", "Status", "Total"]}>
              {mine.slice(0, 12).map((sale) => (
                <tr key={sale.id} className="border-t border-hairline">
                  <td className="py-2 pr-2">
                    <AppLink
                      to="/storeops/sales"
                      sheet={{ key: "sale", value: sale.id }}
                      className="block font-mono text-[0.65625rem] text-accent hover:underline"
                    >
                      {sale.sale_number}
                    </AppLink>
                    <span className="text-[0.65625rem] text-mute">
                      {moment(sale.created_at)}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <Tag
                      tone={
                        sale.status === "COMPLETED"
                          ? "ok"
                          : sale.status === "OPEN"
                            ? "warn"
                            : "neutral"
                      }
                    >
                      {label(sale.status).toUpperCase()}
                    </Tag>
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {money(sale.total_minor)}
                  </td>
                </tr>
              ))}
            </MiniTable>
            {/* Twelve is a preview, and it says so. The list it came from is one
                click away, unsliced. */}
            {mine.length > 12 && (
              <p className="mt-2 text-[0.6875rem] text-mute">
                Showing 12 of {count(mine.length)} held here.
              </p>
            )}
          </div>

          <TotalsLadder
            rows={[
              { label: "Takings", value: money(totals.takings_minor) },
              { label: "Returns", value: count(totals.return_count) },
              { label: "Refunded", value: money(totals.refunded_minor) },
            ]}
            total={{
              label: "Net of refunds",
              value: money(totals.takings_minor - totals.refunded_minor),
            }}
          />
        </div>
      )}
    </Sheet>
  )
}
