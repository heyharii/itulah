import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardStrip } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { ButtonGroup, Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count } from "@/lib/format"
import {
  availability,
  fleetPools,
  inventoryKeys,
  type AvailabilityItem,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Choice, Metric, MetricRow } from "@/screens/inventory/parts"
import { placements } from "@/screens/inventory/shared"

/// What one pool can still promise, per SKU.
///
/// The equation the server prints in its own answer — `Stock = On Hand +
/// Allotted + Missing` — is the whole screen. On Hand is the number that
/// matters and it is the one that can go negative: allotting is a promise, and
/// a pool is allowed to find out it has promised more than it holds. A negative
/// row here is the same fact the allotments screen calls a shortage.
///
/// Paging is the server's cursor, one page at a time, and deliberately not an
/// accumulating "load more": the cursor is a SKU code, so page two is exactly
/// the rows after the last one read, and stepping back is exact too. Nothing is
/// sliced client-side.
///
/// # Why there is no filter panel here
///
/// Every other list in this module got one on 2026-09-11 and this one did not,
/// which is a decision rather than an omission. This screen is narrowed at the
/// SERVER, twice over: the pool and the needle go on the wire as
/// `source_pool_id` and `q`, and the answer is one cursor page of 200 SKUs out
/// of a pool that holds thousands. A clause evaluated in the browser would
/// narrow THAT PAGE — "on hand below zero" over two hundred rows, while Next
/// walks on through pages it never saw — and the reader would have no way to
/// tell the difference between "three SKUs are oversold" and "three of these
/// two hundred are".
///
/// So the panel arrives here when the clause can travel with the request. That
/// is an endpoint change (`/inventory/availability` taking a division, a
/// quantity bound, a negative-on-hand flag), and when it lands this screen
/// becomes a `useFilterState(fields)` one with `counted` options from the
/// response — no table facets — exactly like Sourcing and Articles.

const columns: ColumnDef<TableSetup, AvailabilityItem>[] = [
  {
    id: "article",
    accessorFn: (row) => `${row.article_name} ${row.article_code}`,
    header: "Article",
    size: 260,
    cell: ({ row }) => (
      <div className="min-w-0">
        <span className="block truncate text-ink">
          {row.original.article_name}
        </span>
        <span className="font-mono text-id text-mute">
          {row.original.article_code}
        </span>
      </div>
    ),
  },
  {
    accessorKey: "sku_code",
    header: "SKU",
    size: 140,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.sku_code}
      </span>
    ),
  },
  {
    id: "variant",
    accessorFn: (row) => `${row.colour ?? ""} ${row.size ?? ""}`,
    header: "Variant",
    size: 150,
    cell: ({ row }) => (
      <span className="text-body">
        {[row.original.colour, row.original.size].filter(Boolean).join(" · ") ||
          "—"}
      </span>
    ),
  },
  {
    accessorKey: "division_code",
    header: "Division",
    size: 110,
    cell: ({ row }) =>
      row.original.division_code ? (
        <Tag>{row.original.division_code}</Tag>
      ) : (
        <span className="text-mute">—</span>
      ),
  },
  {
    accessorKey: "stock_qty",
    header: "Stock",
    size: 100,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.stock_qty),
  },
  {
    accessorKey: "allotted_qty",
    header: "Allotted",
    size: 100,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span
        className={row.original.allotted_qty > 0 ? "text-info-fg" : "text-mute"}
      >
        {count(row.original.allotted_qty)}
      </span>
    ),
  },
  {
    accessorKey: "on_hand_qty",
    header: "On hand",
    size: 110,
    meta: { align: "right" },
    // The decision metric, and the reason the list opens sorted by it: a
    // negative on hand is stock promised twice.
    cell: ({ row }) => (
      <span
        className={
          row.original.on_hand_qty < 0
            ? "font-medium text-bad-fg"
            : row.original.on_hand_qty === 0
              ? "text-mute"
              : "text-ink"
        }
      >
        {count(row.original.on_hand_qty)}
      </span>
    ),
  },
  {
    accessorKey: "missing_qty",
    header: "Missing",
    size: 100,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span
        className={row.original.missing_qty > 0 ? "text-warn-fg" : "text-mute"}
      >
        {count(row.original.missing_qty)}
      </span>
    ),
  },
]

export function Availability() {
  const [pool, setPool] = useState("dc.warehouse")
  const [needle, setNeedle] = useState("")
  // The cursor stack, so Back is exact rather than a re-fetch of page one.
  const [trail, setTrail] = useState<readonly string[]>([""])
  const [sorting, setSorting] = useState<SortingState>([
    { id: "on_hand_qty", desc: false },
  ])

  const cursor = trail[trail.length - 1]

  const pools = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  const page = useQuery({
    queryKey: inventoryKeys.availability(pool, needle, cursor),
    queryFn: ({ signal }) => availability(pool, needle, cursor, signal),
  })

  const rows = useMemo(
    () => (page.data?.items ?? []) as AvailabilityItem[],
    [page.data]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: AvailabilityItem) => row.sku_id,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )

  const poolOptions = useMemo(
    () =>
      placements(pools.data?.items ?? []).map((item) => ({
        value: item.id,
        label: `${item.site_id} · ${item.label}`,
      })),
    [pools.data]
  )

  const restart = (next: () => void) => {
    setTrail([""])
    next()
  }

  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="Availability"
        sub="What one pool can still promise, SKU by SKU."
      />

      <Toolbar>
        <Choice
          value={pool}
          onChange={(value) => restart(() => setPool(value))}
          options={poolOptions}
          className="max-w-72"
        />
        <Input
          value={needle}
          onChange={(event) => restart(() => setNeedle(event.target.value))}
          placeholder="SKU, article code or name"
          className="h-8 w-64"
        />
        <Toolbar.Spacer />
        <ButtonGroup>
          <Button
            variant="ghost"
            className="rounded-none border-0"
            disabled={trail.length === 1}
            onClick={() => setTrail((stack) => stack.slice(0, -1))}
          >
            Back
          </Button>
          <Button
            variant="ghost"
            className="rounded-none border-0"
            disabled={!page.data?.next_cursor}
            onClick={() =>
              setTrail((stack) =>
                page.data?.next_cursor
                  ? [...stack, page.data.next_cursor]
                  : stack
              )
            }
          >
            Next
          </Button>
        </ButtonGroup>
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(page, {
          loading: "Reading the pool…",
          render: (data) => (
            <>
              <CardStrip className="justify-between">
                <span className="text-meta font-medium text-ink">
                  {data.source_pool_label}
                  <span className="ml-2 font-mono text-id text-mute">
                    {data.source_place_id}
                  </span>
                </span>
                <span className="text-[0.875rem] text-mute">
                  {data.inventory_equation}
                </span>
              </CardStrip>

              <div className="border-b border-hairline px-4 py-3.5">
                <MetricRow>
                  <Metric label="Stock" value={count(data.stock_qty)} />
                  <Metric label="Allotted" value={count(data.allotted_qty)} />
                  <Metric
                    label="On hand"
                    value={count(data.on_hand_qty)}
                    tone={data.on_hand_qty < 0 ? "bad" : "ink"}
                  />
                  <Metric
                    label="Missing"
                    value={count(data.missing_qty)}
                    tone={data.missing_qty > 0 ? "warn" : "ink"}
                  />
                </MetricRow>
              </div>

              {rows.length === 0 ? (
                <EmptyState>
                  {needle === ""
                    ? "This pool holds no SKU the catalogue still lists as active."
                    : `Nothing in this pool matches “${needle}”.`}
                </EmptyState>
              ) : (
                <>
                  <DataTable<AvailabilityItem>
                    table={table}
                    className="max-h-[calc(100vh-26rem)]"
                  />
                  <div className="flex items-center justify-between border-t border-hairline px-4 py-2.5 text-[0.875rem] text-mute">
                    <span className="tabular-nums">
                      Page {count(trail.length)} · {count(rows.length)} of{" "}
                      {count(data.total_items)} SKUs
                    </span>
                    <span>
                      {data.next_cursor === null
                        ? "End of the pool."
                        : `Next page starts after ${data.next_cursor}.`}
                    </span>
                  </div>
                </>
              )}
            </>
          ),
        })}
      </Card>
    </PageContent>
  )
}
