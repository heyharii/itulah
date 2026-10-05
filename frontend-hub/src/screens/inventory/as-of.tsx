import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { SHOW_MISSING, withoutMissing } from "@/lib/features"
import { useFilters } from "@/lib/filters"
import { moment } from "@/lib/format"
import {
  fleetPools,
  inventoryAsOf,
  inventoryKeys,
  type Pool,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Choice, Metric, MetricRow } from "@/screens/inventory/parts"
import {
  instantFromLocal,
  localInput,
  percent,
  sitesOf,
} from "@/screens/inventory/shared"
import {
  DisplayUnitPicker,
  useDisplayUnit,
  type DisplayUnit,
} from "@/screens/inventory/unit-display"

/// The same pools, folded to a moment in the past.
///
/// The server does this by replaying movements up to `at` rather than reading
/// the projection, so the answer is the ledger's own account of that afternoon
/// and not a snapshot somebody remembered to take. It also comes back with
/// `read_only: true` for anything more than two seconds ago, and that flag is
/// the whole discipline of the screen: these numbers are history, nothing may
/// be posted against them, and there is deliberately not a single write here.

function poolColumns(display: DisplayUnit): ColumnDef<TableSetup, Pool>[] {
  return [
    {
      id: "pool",
      accessorFn: (row) => `${row.label} ${row.id}`,
      header: "Pool",
      size: 240,
      // Same reason as Site below: the toolbar already picks a pool, and it
      // picks it on the wire.
      cell: ({ row }) => (
        <div className="min-w-0">
          <span className="block truncate font-medium text-ink">
            {row.original.label}
          </span>
          <span className="font-mono text-id text-mute">{row.original.id}</span>
        </div>
      ),
    },
    {
      id: "site",
      accessorFn: (row) => row.site_name ?? row.site_id,
      header: "Site",
      size: 170,
      // No filter, and that is not an oversight: the toolbar's Site picker is a
      // REQUEST parameter, and a second site question answered in the browser
      // would be a place the narrowing is decided twice. The day the two
      // disagreed, this one would look right.
      cell: ({ row }) => (
        <span className="text-body">
          {row.original.site_name ?? row.original.site_id}
        </span>
      ),
    },
    {
      accessorKey: "group",
      header: "Group",
      size: 140,
      /// The one closed set on the row the toolbar cannot ask for: the kind of
      /// place, faceted from what the replay actually returned.
      meta: { filter: { kind: "option" } },
      cell: ({ row }) => <Tag>{row.original.group}</Tag>,
    },
    {
      accessorKey: "stock",
      header: "Stock",
      size: 110,
      // The only number worth sorting a historical read by: how much was there.
      meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
      cell: ({ row }) => display.format(row.original.stock),
    },
    {
      accessorKey: "on_hand",
      header: "On Hand",
      size: 110,
      meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
      cell: ({ row }) => display.format(row.original.on_hand),
    },
    {
      accessorKey: "allotted",
      header: "Allotted",
      size: 110,
      /// Nullable, and the dash in the cell is the point: a pool nobody promised
      /// anything out of is not a pool that promised zero. The accessor hands
      /// the predicate the raw `null`, so "is empty" asks for exactly those rows
      /// and no comparison quietly counts them as 0.
      meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
      cell: ({ row }) =>
        row.original.allotted === null ? (
          <span className="text-mute">—</span>
        ) : (
          display.format(row.original.allotted)
        ),
    },
    {
      accessorKey: "missing",
      header: "Missing",
      size: 110,
      meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
      cell: ({ row }) => (
        <span
          className={row.original.missing > 0 ? "text-bad-fg" : "text-mute"}
        >
          {display.format(row.original.missing)}
        </span>
      ),
    },
    {
      accessorKey: "lost_rate",
      header: "Lost Rate",
      size: 110,
      /// The cell holds a fraction and the column prints a percentage, so the
      /// box takes the percentage and `scale` puts it back: somebody asking for
      /// pools losing more than 5% types 5, not 0.05.
      meta: {
        align: "right",
        filter: { kind: "number", scale: 0.01, unit: "%" },
      },
      cell: ({ row }) => percent(row.original.lost_rate),
    },
  ]
}

export function AsOf() {
  const [when, setWhen] = useState(() =>
    localInput(new Date(Date.now() - 24 * 60 * 60 * 1000))
  )
  const [site, setSite] = useState("")
  const [pool, setPool] = useState("")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "stock", desc: true },
  ])

  const at = instantFromLocal(when)

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  const history = useQuery({
    queryKey: inventoryKeys.asOf(at, site, pool),
    queryFn: ({ signal }) => inventoryAsOf(at, site, pool, signal),
    enabled: at !== "",
  })

  const rows = useMemo(
    () => (history.data?.items ?? []) as Pool[],
    [history.data]
  )

  const display = useDisplayUnit()
  const columns = useMemo(() => withoutMissing(poolColumns(display)), [display])
  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: Pool) => row.id,
        state: { columnFilters: filters.columnFilters, sorting },
        onSortingChange: setSorting,
      }),
      [rows, filters.columns, filters.columnFilters, sorting]
    )
  )

  const sites = useMemo(
    () =>
      sitesOf(fleet.data?.items ?? []).map((one) => ({
        value: one.site_id,
        label: one.site_name,
      })),
    [fleet.data]
  )

  const pools = useMemo(
    () =>
      (fleet.data?.items ?? [])
        .filter((one) => site === "" || one.site_id === site)
        .map((one) => ({ value: one.id, label: one.label })),
    [fleet.data, site]
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="As of"
        sub="What every pool held at a moment, replayed from the ledger rather than remembered."
      />

      <Toolbar>
        <Input
          type="datetime-local"
          value={when}
          onChange={(event) => setWhen(event.target.value)}
          className="h-8 w-56"
        />
        <Choice
          value={site}
          onChange={(value) => {
            setSite(value)
            setPool("")
          }}
          options={sites}
        />
        <Choice
          value={pool}
          onChange={setPool}
          options={pools}
          className="max-w-72"
        />
        <Toolbar.Spacer />
        <DisplayUnitPicker display={display} />
      </Toolbar>

      {at === "" ? (
        <Card>
          <EmptyState>Pick a moment to replay the ledger to.</EmptyState>
        </Card>
      ) : (
        queryState(history, {
          loading: "Replaying the ledger…",
          render: (data) => (
            <>
              {data.read_only && (
                <Banner tone="info" className="mb-[1.125rem]">
                  Read only. These are the balances as at {moment(data.as_of)},
                  replayed from the movements the ledger holds — nothing on this
                  screen can be posted against, and a correction made now would
                  not appear here.
                </Banner>
              )}

              <Card className="mb-[1.125rem] px-4 py-3.5">
                <MetricRow>
                  <Metric
                    label="Stock"
                    value={display.format(
                      rows.reduce((total, row) => total + row.stock, 0)
                    )}
                  />
                  <Metric
                    label="On hand"
                    value={display.format(
                      rows.reduce((total, row) => total + row.on_hand, 0)
                    )}
                  />
                  <Metric
                    label="Allotted"
                    value={display.format(
                      rows.reduce(
                        (total, row) => total + (row.allotted ?? 0),
                        0
                      )
                    )}
                  />
                  {SHOW_MISSING && (
                    <Metric
                      label="Missing"
                      value={display.format(
                        rows.reduce((total, row) => total + row.missing, 0)
                      )}
                      tone="warn"
                    />
                  )}
                </MetricRow>
                <p className="mt-3 text-[0.875rem] text-mute">
                  {data.inventory_equation} · observations counted over the{" "}
                  {data.observed_window_hours}h before that moment.
                  {/* The totals are the replay's, and the clauses below do not
                      touch them. Said here rather than left to be inferred:
                      four figures sitting above a narrowed table read as the
                      narrowed table's totals, which they are not. */}
                  {filters.filters.length > 0 &&
                    " Every pool the replay returned is in these four figures — the clauses below narrow the table, not the totals."}
                </p>
              </Card>

              <Toolbar>
                <FilterPanel model={filters} table={table} />
              </Toolbar>

              <Card className="overflow-hidden">
                {rows.length === 0 ? (
                  <EmptyState>
                    {site === "" && pool === ""
                      ? "The ledger held nothing at that moment."
                      : "No pool in this filter held anything at that moment."}
                  </EmptyState>
                ) : (
                  <DataTable<Pool>
                    table={table}
                    empty="No pool in this replay matches the filters in force."
                    className="max-h-[calc(100vh-28rem)]"
                  />
                )}
              </Card>
            </>
          ),
        })
      )}
    </PageContent>
  )
}
