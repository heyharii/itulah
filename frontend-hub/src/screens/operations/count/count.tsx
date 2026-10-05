import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/states"
import { dc, poolsAnswer } from "@/lib/api"
import { count as figure, day, label as humanise } from "@/lib/format"
import { ROOMY } from "@/screens/operations/roomy"
import { TwoLines } from "@/screens/operations/two-lines"
import { keys } from "@/lib/operations/keys"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import type { EdgeOfficialCountSummary } from "@itulah/contract"

const countKeys = {
  all: ["dc", "official-counts"] as const,
  one: (id: string) => ["dc", "official-counts", id] as const,
}

/// **Count** — the counts the Gudang is asked for.
///
/// Counted with the handheld only (owner, 1 Oct 2026): a sweep reads every
/// tag in the pool and the handheld submits it to the count — no number is
/// typed anywhere, so nothing here asks for one. This screen is the list of
/// what is asked and what is done; Inventory reviews the result.
interface Row {
  readonly summary: EdgeOfficialCountSummary
  readonly pool: string
  readonly what: string
  readonly due: string
  readonly toCount: boolean
}

/// No. · Count · Pool · What · Why · Asked · Status. The prototype's Due is the
/// day the count was asked for here: the node carries no deadline.
function columnsFor(): ColumnDef<TableSetup, Row>[] {
  return [
    {
      id: "no",
      header: "No.",
      size: 70,
      enableSorting: false,
      meta: { align: "right", priority: 2 },
      cell: ({ row }) => <span className="text-mute">{row.index + 1}</span>,
    },
    {
      id: "count",
      header: "Count",
      size: 170,
      meta: { card: "id" },
      accessorFn: (row) => row.summary.count_id,
      cell: ({ row }) => (
        <TwoLines
          top={
            <span className="font-mono text-id">
              {row.original.summary.count_id.slice(0, 8)}
            </span>
          }
          bottom={row.original.summary.created_by}
        />
      ),
    },
    {
      accessorKey: "pool",
      header: "Pool",
      size: 220,
      meta: { card: "title" },
      cell: ({ row }) => (
        <span className="font-medium text-ink">{row.original.pool}</span>
      ),
    },
    { accessorKey: "what", header: "What", size: 170, meta: { priority: 2 } },
    {
      id: "why",
      header: "Why",
      size: 200,
      meta: { priority: 3 },
      accessorFn: (row) => row.summary.reason,
      cell: ({ row }) => humanise(row.original.summary.reason),
    },
    { accessorKey: "due", header: "Asked", size: 130, meta: { priority: 3 } },
    {
      id: "status",
      header: "Status",
      size: 140,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2">
          <span
            className={`size-2 rounded-full ${row.original.toCount ? "bg-warn" : "bg-faint"}`}
          />
          {row.original.toCount ? "To count" : "Counted"}
        </span>
      ),
    },
  ]
}

export function Count() {
  const [sorting, setSorting] = useState<SortingState>([])
  const columns = useMemo(() => columnsFor(), [])

  const list = useQuery({
    queryKey: countKeys.all,
    queryFn: ({ signal }) => dc.officialCounts(signal),
    // A handheld submits from the floor; the list notices on its own.
    refetchInterval: 30_000,
  })
  const pools = useQuery({
    queryKey: keys.pools(),
    queryFn: ({ signal }) => poolsAnswer(signal),
  })

  const rows = useMemo<Row[]>(() => {
    const label = new Map(
      (pools.data?.items ?? []).map((pool) => [pool.id, pool.label])
    )
    return (list.data ?? [])
      .filter((one) => one.status === "ACTIVE" || one.status === "SUBMITTED")
      .map((summary) => {
        const skus = summary.scope.sku_codes.length
        return {
          summary,
          pool: label.get(summary.pool_id) ?? summary.pool_id,
          what: skus === 0 ? "All articles" : `${figure(skus)} articles`,
          due: day(summary.activated_at),
          toCount: summary.status === "ACTIVE",
        }
      })
      .sort((a, b) => Number(b.toCount) - Number(a.toCount))
  }, [list.data, pools.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: Row) => row.summary.count_id,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [rows, columns, sorting]
    )
  )

  return (
    <PageContent>
      <PageHeader title="Count" />
      <Card className="overflow-hidden">
        {queryState(list, {
          loading: "Reading the counts…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>Nothing to count.</EmptyState>
            ) : (
              <DataTable<Row>
                table={table}
                touch
                pageScroll
                className={ROOMY}
              />
            ),
        })}
      </Card>
    </PageContent>
  )
}
