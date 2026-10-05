import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card, CardStrip } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { SHOW_MISSING, withoutMissing } from "@/lib/features"
import { count } from "@/lib/format"
import {
  availability,
  fleetPools,
  inventoryKeys,
  type AvailabilityItem,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import { Choice, Metric, MetricRow } from "@/screens/inventory/parts"
import { placements } from "@/screens/inventory/shared"
import {
  DisplayUnitPicker,
  useDisplayUnit,
  type DisplayUnit,
} from "@/screens/inventory/unit-display"

/// What one pool can still promise, per SKU.
///
/// The equation the server prints in its own answer — `Stock = On Hand +
/// Allotted + Missing` — is the whole screen. On Hand is the number that
/// matters and it is the one that can go negative: allotting is a promise, and
/// a pool is allowed to find out it has promised more than it holds. A negative
/// row here is the same fact the allotments screen calls a shortage.
///
/// Paging is the server's SKU-code cursor, walked as the table scrolls. The
/// rows come in SKU-code order and the table does not re-sort them: sorting
/// the loaded pages by On hand would put "the worst of these" where "the
/// worst" belongs. The over-promised question goes to the server instead, as
/// the Over-promised view (`shortfall=true`), which is every such SKU.
///
/// # Why there is no filter panel here
///
/// Every other list in this module got one on 2026-09-11 and this one did not,
/// which is a decision rather than an omission. This screen is narrowed at the
/// SERVER, twice over: the pool and the needle go on the wire as
/// `source_pool_id` and `q`, and the answer is one cursor page of 200 SKUs out
/// of a pool that holds thousands. A clause evaluated in the browser would
/// narrow THAT PAGE — "on hand below zero" over two hundred rows, while the scroll
/// walks on through pages it never saw — and the reader would have no way to
/// tell the difference between "three SKUs are oversold" and "three of these
/// two hundred are".
///
/// So the panel arrives here when the clause can travel with the request. That
/// is an endpoint change (`/inventory/availability` taking a division, a
/// quantity bound, a negative-on-hand flag), and when it lands this screen
/// becomes a `useFilterState(fields)` one with `counted` options from the
/// response — no table facets — exactly like Sourcing and Articles.

function availabilityColumns(
  display: DisplayUnit
): ColumnDef<TableSetup, AvailabilityItem>[] {
  return [
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
          {[row.original.colour, row.original.size]
            .filter(Boolean)
            .join(" · ") || "—"}
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
      cell: ({ row }) => display.format(row.original.stock_qty),
    },
    {
      accessorKey: "allotted_qty",
      header: "Allotted",
      size: 100,
      meta: { align: "right" },
      cell: ({ row }) => (
        <span
          className={
            row.original.allotted_qty > 0 ? "text-info-fg" : "text-mute"
          }
        >
          {display.format(row.original.allotted_qty)}
        </span>
      ),
    },
    {
      accessorKey: "on_hand_qty",
      header: "On Hand",
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
          {display.format(row.original.on_hand_qty)}
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
          className={
            row.original.missing_qty > 0 ? "text-warn-fg" : "text-mute"
          }
        >
          {display.format(row.original.missing_qty)}
        </span>
      ),
    },
  ]
}

export function Availability() {
  const [pool, setPool] = useState("dc.warehouse")
  const [text, setText] = useState("")
  const [view, setView] = useState<"all" | "short">("all")

  // Debounced: every keystroke folds the pool's ledger again.
  const needle = useDebounced(text.trim(), 400)
  const shortfall = view === "short"

  const pools = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  const page = useInfiniteQuery({
    queryKey: inventoryKeys.availability(pool, needle, shortfall),
    queryFn: ({ pageParam, signal }) =>
      availability(
        { sourcePoolId: pool, query: needle, shortfall, cursor: pageParam },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })

  const rows = useMemo(
    () =>
      (page.data?.pages.flatMap((one) => one.items) ??
        []) as AvailabilityItem[],
    [page.data]
  )

  const display = useDisplayUnit()
  const columns = useMemo(
    () => withoutMissing(availabilityColumns(display)),
    [display]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: AvailabilityItem) => row.sku_id,
        // The server orders by SKU code and nothing else; see above.
        enableSorting: false,
      }),
      [rows, columns]
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

  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="On Hand & Shortfall"
        sub="What one pool can still promise, SKU by SKU."
      />

      <Toolbar>
        <Choice
          value={pool}
          onChange={setPool}
          options={poolOptions}
          className="max-w-72"
        />
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="h-8 w-64"
        />
        <Toolbar.Spacer />
        <DisplayUnitPicker display={display} />
        <Segmented
          options={[
            { value: "all", label: "Every SKU" },
            { value: "short", label: "Over-promised" },
          ]}
          value={view}
          onChange={setView}
        />
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(page, {
          loading: "Reading the pool…",
          render: (answer) => {
            // The pool's own figures are over the whole matching set and
            // arrive on every page; the first page's are the ones to show.
            const data = answer.pages[0]
            return (
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
                    <Metric
                      label="Stock"
                      value={display.format(data.stock_qty)}
                    />
                    <Metric
                      label="Allotted"
                      value={display.format(data.allotted_qty)}
                    />
                    <Metric
                      label="On hand"
                      value={display.format(data.on_hand_qty)}
                      tone={data.on_hand_qty < 0 ? "bad" : "ink"}
                    />
                    {SHOW_MISSING && (
                      <Metric
                        label="Missing"
                        value={display.format(data.missing_qty)}
                        tone={data.missing_qty > 0 ? "warn" : "ink"}
                      />
                    )}
                  </MetricRow>
                </div>

                {rows.length === 0 ? (
                  <EmptyState>
                    {needle !== ""
                      ? `Nothing in this pool matches “${needle}”.`
                      : shortfall
                        ? "Nothing in this pool is promised beyond what it holds."
                        : "This pool holds no SKU the catalogue still lists as active."}
                  </EmptyState>
                ) : (
                  <>
                    <DataTable<AvailabilityItem>
                      table={table}
                      more={page}
                      className="max-h-[calc(100vh-26rem)]"
                    />
                    <div className="border-t border-hairline px-4 py-2.5 text-[0.875rem] text-mute tabular-nums">
                      {count(data.total_items)} SKUs
                    </div>
                  </>
                )}
              </>
            )
          },
        })}
      </Card>
    </PageContent>
  )
}
