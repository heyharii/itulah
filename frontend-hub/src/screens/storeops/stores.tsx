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
import { PageHeader } from "@/components/ui/page-header"
import { MiniTable, TotalsLadder } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
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
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.site_id}</span>
    ),
  },
  {
    accessorKey: "open_count",
    header: "Tills open",
    size: 110,
    meta: { align: "right" },
    // The exception, and the reason for the default sort: an open sale is a
    // basket somebody walked away from or is standing at right now.
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
    meta: { align: "right" },
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
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.completed_count),
  },
  {
    accessorKey: "takings_minor",
    header: "Takings",
    size: 150,
    meta: { align: "right" },
    cell: ({ row }) => money(row.original.takings_minor),
  },
  {
    accessorKey: "voided_count",
    header: "Voided",
    size: 100,
    meta: { align: "right" },
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
    meta: { align: "right" },
    cell: ({ row }) =>
      row.original.refunded_minor > 0 ? (
        money(row.original.refunded_minor)
      ) : (
        <span className="text-mute">—</span>
      ),
  },
]

export function Stores() {
  const [query, setQuery] = useState("")
  const store = useSheet("store")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "open_count", desc: true },
  ])

  const sales = useQuery({
    queryKey: storeopsKeys.sales("any"),
    queryFn: ({ signal }) => listSales({ limit: 500 }, signal),
  })
  const returns = useQuery({
    queryKey: storeopsKeys.returns(),
    queryFn: ({ signal }) => listReturns({ limit: 500 }, signal),
  })

  const rows = useMemo(
    () => rollUp(sales.data ?? [], returns.data ?? []),
    [sales.data, returns.data]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: StoreRow) => row.site_id,
        state: { globalFilter: query, sorting },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [rows, query, sorting]
    )
  )

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
                empty="No store matches that search."
                className="max-h-[calc(100vh-14rem)]"
              />
            ),
        })}
      </Card>

      <StoreSheet
        siteId={store.value ?? null}
        onClose={store.close}
        sales={sales.data ?? []}
        returns={returns.data ?? []}
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
              to="/analytics"
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
