import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { FilterBar } from "@/components/ui/filter-bar"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { count, moment } from "@/lib/format"
import {
  fleetPools,
  inventoryKeys,
  listMovements,
  type Movement,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Choice } from "@/screens/inventory/parts"
import { placements } from "@/screens/inventory/shared"

/// The ledger itself — every posting that moved a piece, in the order it
/// happened.
///
/// # Why this is its own screen
///
/// Movements have always reached the app as a tail: a pool's own panel carries
/// the last few in and out of it, capped by whatever that read decides. That
/// answers "what happened to this shelf lately" and nothing else. It cannot
/// answer "what happened at all", which is the question somebody has when the
/// number is wrong and they do not yet know which shelf to blame.
///
/// The endpoint has existed since the ledger was written. Nothing had ever
/// called it.
///
/// # What a movement is
///
/// Double-entry, and both halves are on the row. `from` and `to` are *places*
/// — `<pool>:on_hand`, `<pool>:missing`, `system/lost`, `external/disposal` —
/// so a piece going missing is not a deletion, it is a move to the missing
/// place of the same pool, and losing it for good is a second move out to
/// `system/lost`. That is why the route is one column and not two: reading
/// "where did it go" as a pair of independent columns is what makes a ledger
/// look like a list of edits.
///
/// **Cause is the load-bearing column.** Most causes are workflow-owned — a
/// SALE posts from a till, a PICK from a picklist — and only `NORMAL_MOVE` and
/// `RETURN_TO_DC` may be posted by hand. A movement claiming SALE that nobody
/// sold is the failure the server refuses at the boundary, and reading the
/// cause is how anybody would notice one that got through.

/// A place id, split into the shelf and the state it sits in.
///
/// `store-02.warehouse:on_hand` is one place, but it is two facts, and the
/// second one is the interesting half: a movement between the two halves of
/// the same pool is a piece going missing or being found, which reads as a
/// no-op if the suffix is dropped.
///
/// A fragment rather than an element, because the caller wraps each half in
/// its own truncating block. That is load-bearing: a virtualised row is a flex
/// container, a flex item defaults to `min-width: auto`, and an unbreakable
/// 30-character pool id therefore overrides the column's declared basis and
/// drags every column to its right out of line. `overflow: hidden` is what
/// takes the cell's min-content contribution back to nought.
function Place({ id }: { id: string }) {
  const cut = id.lastIndexOf(":")
  if (cut === -1) {
    // `system/lost`, `external/supplier` — outside the pool grammar entirely,
    // and worth looking different, because stock crossing that line is leaving
    // the company rather than moving inside it.
    return <span className="text-mute">{id}</span>
  }
  return (
    <>
      <AppLink
        to="/inventory/pools"
        sheet={{ key: "pool", value: id.slice(0, cut) }}
        className="text-body hover:text-ink hover:underline"
      >
        {id.slice(0, cut)}
      </AppLink>
      <span className="text-mute">:{id.slice(cut + 1)}</span>
    </>
  )
}

const columns: ColumnDef<TableSetup, Movement>[] = [
  {
    accessorKey: "occurred_at",
    header: "When",
    size: 150,
    meta: { filter: { kind: "date" }, card: "meta" },
    cell: ({ row }) => moment(row.original.occurred_at),
  },
  {
    accessorKey: "cause",
    header: "Cause",
    size: 150,
    meta: { filter: { kind: "text" }, card: "status" },
    cell: ({ row }) => <Tag>{row.original.cause}</Tag>,
  },
  {
    id: "route",
    accessorFn: (row) => `${row.from} → ${row.to}`,
    header: "Route",
    size: 380,
    meta: { filter: { kind: "text" }, card: "title" },
    /// Stacked rather than laid out on one line, and that is a table-layout
    /// decision as much as a reading one: a pool id is 30-odd characters of
    /// mono that will not wrap, so side by side the widest route in view sets
    /// the column and every row after it inherits the ragged edge — the
    /// columns to its right stop lining up at all. Two lines fit the declared
    /// width, and the pair reads as what it is: out of here, into there.
    cell: ({ row }) => (
      <span className="block overflow-hidden font-mono text-[0.65625rem] leading-snug">
        <span className="block truncate">
          <Place id={row.original.from} />
        </span>
        <span className="block truncate">
          <span className="text-line-ico">→ </span>
          <Place id={row.original.to} />
        </span>
      </span>
    ),
  },
  {
    accessorKey: "sku_code",
    header: "SKU",
    size: 130,
    meta: { mono: true, filter: { kind: "text" }, card: "id" },
    cell: ({ row }) =>
      row.original.sku_code ?? <span className="text-mute">—</span>,
  },
  {
    accessorKey: "epc",
    header: "Tag",
    size: 200,
    meta: { mono: true, priority: 3, filter: { kind: "text" }, card: "hide" },
    cell: ({ row }) => row.original.epc ?? <span className="text-mute">—</span>,
  },
  {
    accessorKey: "quantity",
    header: "Qty",
    size: 80,
    meta: {
      align: "right",
      filter: { kind: "number", unit: "pcs" },
      card: "metric",
    },
    cell: ({ row }) => count(row.original.quantity),
  },
  {
    accessorKey: "actor_id",
    header: "Posted by",
    size: 160,
    meta: { priority: 2, filter: { kind: "text" }, card: "meta" },
    cell: ({ row }) => row.original.actor_id,
  },
]

export function Movements() {
  const [pool, setPool] = useState("")
  const [query, setQuery] = useState("")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "occurred_at", desc: true },
  ])

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  const ledger = useQuery({
    queryKey: inventoryKeys.movements(pool),
    queryFn: ({ signal }) => listMovements(pool, 300, signal),
  })

  const rows = useMemo(() => ledger.data ?? [], [ledger.data])
  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: Movement) => row.movement_id,
        state: {
          columnFilters: filters.columnFilters,
          globalFilter: query,
          sorting,
        },
        onGlobalFilterChange: setQuery,
        onSortingChange: setSorting,
      }),
      [rows, filters.columns, filters.columnFilters, query, sorting]
    )
  )

  /// Every shelf, not only the writable ones: this is a read, and a pool the
  /// centre may not post to still has a history worth looking at.
  const poolOptions = useMemo(
    () =>
      placements(fleet.data?.items ?? []).map((item) => ({
        value: item.id,
        label: `${item.site_id} · ${item.label}`,
      })),
    [fleet.data]
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="Movements"
        sub="Every posting that moved a piece. Double-entry: a route, a cause, and who posted it."
      />

      <Toolbar>
        <Choice
          value={pool}
          onChange={setPool}
          options={poolOptions}
          placeholder="Every pool"
          className="max-w-72"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          className="h-8 w-48"
        />
        <FilterBar model={filters} table={table} />
        <Toolbar.Spacer />
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(ledger, {
          loading: "Reading the ledger…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {pool === ""
                  ? "Nothing has been posted to this ledger yet."
                  : "Nothing has moved in or out of this pool."}
              </EmptyState>
            ) : (
              <DataTable<Movement>
                table={table}
                className="max-h-[calc(100vh-17rem)]"
              />
            ),
        })}
      </Card>
    </PageContent>
  )
}
