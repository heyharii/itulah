import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState } from "@/components/ui/states"
import { dc, poolsAnswer } from "@/lib/api"
import { count as figure, day, label as humanise } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { CardFigure, CardName } from "@/components/ui/phone-cards"
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

/// **Count** — the counts the warehouse is asked for.
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
/// `phone`: the card's own columns exist on a phone only, so a desk's and a
/// tablet's columns are exactly what they were.
function columnsFor(phone: boolean): ColumnDef<TableSetup, Row>[] {
  const cards: ColumnDef<TableSetup, Row>[] = [
    // Four columns that exist only on a card (`cardLead`; a phone): the pool
    // over why it was asked, how many articles are in it, who asked and when,
    // and whether it still waits for a handheld.
    {
      id: "head",
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "title" },
      accessorFn: (row) => row.pool,
      cell: ({ row }) => (
        <CardName
          name={row.original.pool}
          line={humanise(row.original.summary.reason)}
        />
      ),
    },
    {
      id: "lead",
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "lead" },
      accessorFn: (row) => row.summary.scope.sku_codes.length,
      cell: ({ row }) => {
        const skus = row.original.summary.scope.sku_codes.length
        return skus === 0 ? (
          <CardFigure value="All" caption="articles" />
        ) : (
          <CardFigure
            value={figure(skus)}
            caption={skus === 1 ? "article" : "articles"}
          />
        )
      },
    },
    {
      id: "foot",
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "foot" },
      accessorFn: (row) => row.due,
      cell: ({ row }) => (
        <span>
          {row.original.summary.created_by} · {row.original.due}
        </span>
      ),
    },
    {
      id: "where",
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { align: "right", card: "status" },
      accessorFn: (row) => (row.toCount ? 1 : 0),
      cell: ({ row }) => (
        <Pill tone={row.original.toCount ? "warn" : "neutral"}>
          {row.original.toCount ? "To count" : "Counted"}
        </Pill>
      ),
    },
  ]

  return [
    {
      id: "no",
      header: "No.",
      size: 70,
      enableSorting: false,
      meta: { align: "right", priority: 2, card: "hide" },
      cell: ({ row }) => <span className="text-mute">{row.index + 1}</span>,
    },
    {
      id: "count",
      header: "Count",
      size: 170,
      meta: { card: "hide" },
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
      meta: { card: "hide" },
      cell: ({ row }) => (
        <span className="font-medium text-ink">{row.original.pool}</span>
      ),
    },
    {
      accessorKey: "what",
      header: "What",
      size: 170,
      meta: { priority: 2, card: "hide" },
    },
    {
      id: "why",
      header: "Why",
      size: 200,
      meta: { priority: 3, card: "hide" },
      accessorFn: (row) => row.summary.reason,
      cell: ({ row }) => humanise(row.original.summary.reason),
    },
    {
      accessorKey: "due",
      header: "Asked",
      size: 130,
      meta: { priority: 3, card: "hide" },
    },
    {
      id: "status",
      header: "Status",
      size: 140,
      meta: { card: "hide" },
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2">
          <span
            className={`size-2 rounded-full ${row.original.toCount ? "bg-warn" : "bg-faint"}`}
          />
          {row.original.toCount ? "To count" : "Counted"}
        </span>
      ),
    },
    ...(phone ? cards : []),
  ]
}

export function Count() {
  const [sorting, setSorting] = useState<SortingState>([])
  const [typed, setTyped] = useState("")
  const phone = useLayout() === "phone"
  const columns = useMemo(() => columnsFor(phone), [phone])

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

  const needle = typed.trim().toLowerCase()
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
      .filter(
        (row) =>
          needle === "" ||
          row.pool.toLowerCase().includes(needle) ||
          humanise(row.summary.reason).toLowerCase().includes(needle) ||
          row.summary.created_by.toLowerCase().includes(needle)
      )
      .sort((a, b) => Number(b.toCount) - Number(a.toCount))
  }, [list.data, pools.data, needle])

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
      <DockTools
        search={{ value: typed, onChange: setTyped, label: "Search counts" }}
        sort={dockSortOf(table)}
      />
      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(list, {
          loading: "Reading the counts…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>Nothing to count.</EmptyState>
            ) : (
              <DataTable<Row>
                refresh={[list]}
                table={table}
                touch
                pageScroll
                className={ROOMY}
                cardSort={false}
                cardsApart
                cardLead
              />
            ),
        })}
      </Card>
    </PageContent>
  )
}
