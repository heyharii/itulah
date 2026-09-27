import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
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
import { count, money, moment } from "@/lib/format"
import {
  listReturns,
  returnDetail,
  storeopsKeys,
  type ReturnRow,
} from "@/lib/queries/storeops"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"

/// The refund desk: what went back over the counter and what it cost.
///
/// A return is its own document and never an edit of the sale it came from —
/// a finalized sale is immutable, so the shortfall between what was charged and
/// what came back is a fact the accounts keep rather than a number that gets
/// quietly reduced. That is why this is a list of its own rather than a column
/// on Sales.
///
/// Sorted by what was refunded, because the money leaving is the thing somebody
/// reads this list to check. The sale it was taken against is a click away in
/// the sheet rather than a column here, and it is a real link: a refund with no
/// route back to what was sold is the dead end DESIGN.md forbids.

const columns: ColumnDef<TableSetup, ReturnRow>[] = [
  {
    accessorKey: "return_number",
    header: "Return",
    size: 200,
    // No filter: a document number is something you have in your hand, and
    // the search box beside the title already answers it.
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.return_number}
      </span>
    ),
  },
  {
    accessorKey: "site_id",
    header: "Store",
    size: 130,
    /// Faceted from these rows, which is the only spelling that can match
    /// them: the centre and the box standing in a place do not always agree
    /// on its name — the warehouse is `ho` to the centre and `dc-01` to its
    /// own edge node — and a list fetched from anywhere else would offer a
    /// value with a count beside it that selects nothing.
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.site_id}</span>
    ),
  },
  {
    accessorKey: "reason",
    header: "Reason",
    size: 260,
    // Prose somebody typed at a counter. A search box reads it better than a
    // facet of two hundred distinct sentences ever could.
    cell: ({ row }) => <span className="text-text">{row.original.reason}</span>,
  },
  {
    accessorKey: "actor_id",
    header: "Taken by",
    size: 150,
    /// A closed set in practice — the people standing at the counters — and
    /// "who refunded this" is the question a supervisor opens this list with.
    meta: { filter: { kind: "option" } },
  },
  {
    accessorKey: "created_at",
    header: "When",
    size: 160,
    meta: { filter: { kind: "date" } },
    cell: ({ row }) => moment(row.original.created_at),
  },
  {
    accessorKey: "refund_total_minor",
    header: "Refunded",
    size: 140,
    // The decision metric: money going back out of the till.
    /// **No `scale`, despite the `_minor` in the name.** `lib/format.ts` says
    /// it plainly — IDR has no minor unit in practice, so the server's "minor"
    /// is already whole rupiah and `money()` prints it undivided. A
    /// `scale: 100` here would turn "refunds over 500000" into "refunds over
    /// fifty million" and show an empty list under a chip claiming the first.
    meta: {
      align: "right",
      filter: { kind: "number", unit: "Rp" },
    },
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {money(row.original.refund_total_minor)}
      </span>
    ),
  },
]

/// What this screen asks for, named once so the banner and the request cannot
/// disagree. The search and the sort both run in the BROWSER over whatever
/// this fetched, and so do the filters — so this is also the number past which
/// the screen stops being able to answer the question it appears to answer.
const CAP = 500

export function Returns() {
  const [query, setQuery] = useState("")
  const refund = useSheet("refund")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "refund_total_minor", desc: true },
  ])

  const returns = useQuery({
    queryKey: storeopsKeys.returns(),
    queryFn: ({ signal }) => listReturns({ limit: CAP }, signal),
  })

  const rows = useMemo(() => returns.data?.rows ?? [], [returns.data])

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: ReturnRow) => row.id,
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

  return (
    <PageContent>
      <PageHeader
        crumb="Sales"
        title="Returns"
        sub="What came back over the counter, what it was refunded with, and whether it went back on the floor."
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

      {/* Only when the answer came back exactly as large as the question. A
          shorter answer proves there was nothing more to send; this length
          proves nothing either way — and a refund total read off a filtered
          slice of it is a figure somebody would quote. */}
      {rows.length >= CAP && <Truncated limit={CAP} noun="returns" />}

      <Card className="overflow-hidden">
        {queryState(returns, {
          loading: "Loading the returns…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                Nothing has been taken back yet. A return is raised against a
                completed sale, from that sale&apos;s own record.
              </EmptyState>
            ) : (
              <DataTable<ReturnRow>
                table={table}
                onRowClick={(row) => refund.open(row.id)}
                isSelected={(row) => row.id === refund.value}
                empty={
                  <>
                    None of the {rows.length.toLocaleString("id-ID")} returns
                    loaded match this search and the filters in force.
                  </>
                }
                className="max-h-[calc(100vh-14rem)]"
              />
            ),
        })}
      </Card>

      <ReturnSheet id={refund.value ?? null} onClose={refund.close} />
    </PageContent>
  )
}

/// One return document: what came back, where it went, and how the money was
/// handed over.
function ReturnSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const detail = useQuery({
    queryKey: storeopsKeys.saleReturn(id ?? ""),
    queryFn: ({ signal }) => returnDetail(id!, signal),
    enabled: id !== null,
  })

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "return", id }}
      onOpenChange={(open) => !open && onClose()}
      id={detail.data?.return_number}
      title={detail.data?.site_id ?? "Return"}
    >
      {queryState(detail, {
        loading: "Loading the return…",
        render: (record) => (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="Store">{record.site_id}</Fact>
              <Fact term="Taken by">{record.actor_id}</Fact>
              <Fact term="When">{moment(record.created_at)}</Fact>
              <Fact term="Against">
                {/* The crossing DESIGN.md asks for: a refund is always about a
                    sale, and this opens that sale's own record rather than
                    restating it here. */}
                <AppLink
                  to="/sales"
                  sheet={{ key: "sale", value: record.sale_id }}
                  className="font-mono text-id text-accent hover:underline"
                >
                  {record.sale_number}
                </AppLink>
              </Fact>
            </Facts>

            <div>
              <h4 className="mb-2 text-card-title font-semibold text-ink">
                Why
              </h4>
              <p className="text-meta text-text">{record.reason}</p>
            </div>

            <div>
              <h4 className="mb-2 text-card-title font-semibold text-ink">
                What came back
              </h4>
              <MiniTable head={["Item", "Went to", "Qty", "Refund"]}>
                {record.lines.map((line) => (
                  <tr key={line.id} className="border-t border-hairline">
                    <td className="py-2 pr-2">
                      <span className="block text-[0.875rem] text-ink">
                        {line.article_name}
                      </span>
                      <span className="font-mono text-[0.875rem] text-mute">
                        {line.sku_code}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      {/* Not a note: `restock` decides which pool the garment
                          moved into, so it is the difference between stock the
                          shop can sell again and stock it cannot. */}
                      <Tag tone={line.restock ? "ok" : "warn"}>
                        {line.restock ? "FLOOR" : "REJECT"}
                      </Tag>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {count(line.quantity)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {money(line.refund_minor)}
                    </td>
                  </tr>
                ))}
              </MiniTable>
            </div>

            {record.refunds.length > 0 && (
              <div>
                <h4 className="mb-2 text-card-title font-semibold text-ink">
                  Refunded with
                </h4>
                <MiniTable head={["Method", "Reference", "Amount"]}>
                  {record.refunds.map((entry, index) => (
                    <tr
                      key={`${entry.method}-${index}`}
                      className="border-t border-hairline"
                    >
                      <td className="py-2 pr-2">
                        <Tag>{entry.method}</Tag>
                      </td>
                      <td className="py-2 text-right text-[0.875rem] text-mute">
                        {entry.reference ?? "—"}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {money(entry.amount_minor)}
                      </td>
                    </tr>
                  ))}
                </MiniTable>
              </div>
            )}

            <TotalsLadder
              rows={[
                { label: "Lines returned", value: count(record.lines.length) },
                {
                  label: "Back on the floor",
                  value: count(
                    record.lines.filter((line) => line.restock).length
                  ),
                },
                {
                  label: "To the reject pool",
                  value: count(
                    record.lines.filter((line) => !line.restock).length
                  ),
                },
              ]}
              total={{
                label: "Refunded",
                value: money(record.refund_total_minor),
              }}
            />
          </div>
        ),
      })}
    </Sheet>
  )
}
