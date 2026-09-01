import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { MiniTable, TotalsLadder } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
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
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.site_id}</span>
    ),
  },
  {
    accessorKey: "reason",
    header: "Reason",
    size: 260,
    cell: ({ row }) => <span className="text-text">{row.original.reason}</span>,
  },
  {
    accessorKey: "actor_id",
    header: "Taken by",
    size: 150,
  },
  {
    accessorKey: "created_at",
    header: "When",
    size: 160,
    cell: ({ row }) => moment(row.original.created_at),
  },
  {
    accessorKey: "refund_total_minor",
    header: "Refunded",
    size: 140,
    meta: { align: "right" },
    // The decision metric: money going back out of the till.
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {money(row.original.refund_total_minor)}
      </span>
    ),
  },
]

export function Returns() {
  const [query, setQuery] = useState("")
  const refund = useSheet("refund")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "refund_total_minor", desc: true },
  ])

  const returns = useQuery({
    queryKey: storeopsKeys.returns(),
    queryFn: ({ signal }) => listReturns({ limit: 500 }, signal),
  })

  const rows = useMemo(() => returns.data ?? [], [returns.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: ReturnRow) => row.id,
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
                empty="No return matches that search."
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
                  to="/storeops/sales"
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
                      <span className="block text-[0.8125rem] text-ink">
                        {line.article_name}
                      </span>
                      <span className="font-mono text-[0.65625rem] text-mute">
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
                      <td className="py-2 text-right text-[0.75rem] text-mute">
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
