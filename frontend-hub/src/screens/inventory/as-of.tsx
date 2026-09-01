import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, moment } from "@/lib/format"
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

/// The same pools, folded to a moment in the past.
///
/// The server does this by replaying movements up to `at` rather than reading
/// the projection, so the answer is the ledger's own account of that afternoon
/// and not a snapshot somebody remembered to take. It also comes back with
/// `read_only: true` for anything more than two seconds ago, and that flag is
/// the whole discipline of the screen: these numbers are history, nothing may
/// be posted against them, and there is deliberately not a single write here.

const columns: ColumnDef<TableSetup, Pool>[] = [
  {
    id: "pool",
    accessorFn: (row) => `${row.label} ${row.id}`,
    header: "Pool",
    size: 240,
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
    cell: ({ row }) => <Tag>{row.original.group}</Tag>,
  },
  {
    accessorKey: "stock",
    header: "Stock",
    size: 110,
    meta: { align: "right" },
    // The only number worth sorting a historical read by: how much was there.
    cell: ({ row }) => count(row.original.stock),
  },
  {
    accessorKey: "on_hand",
    header: "On hand",
    size: 110,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.on_hand),
  },
  {
    accessorKey: "allotted",
    header: "Allotted",
    size: 110,
    meta: { align: "right" },
    cell: ({ row }) =>
      row.original.allotted === null ? (
        <span className="text-mute">—</span>
      ) : (
        count(row.original.allotted)
      ),
  },
  {
    accessorKey: "missing",
    header: "Missing",
    size: 110,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className={row.original.missing > 0 ? "text-bad-fg" : "text-mute"}>
        {count(row.original.missing)}
      </span>
    ),
  },
  {
    accessorKey: "lost_rate",
    header: "Lost rate",
    size: 110,
    meta: { align: "right" },
    cell: ({ row }) => percent(row.original.lost_rate),
  },
]

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

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: Pool) => row.id,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [rows, sorting]
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
          placeholder="Every site"
        />
        <Choice
          value={pool}
          onChange={setPool}
          options={pools}
          placeholder="Every pool"
          className="max-w-72"
        />
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
                    value={count(
                      rows.reduce((total, row) => total + row.stock, 0)
                    )}
                  />
                  <Metric
                    label="On hand"
                    value={count(
                      rows.reduce((total, row) => total + row.on_hand, 0)
                    )}
                  />
                  <Metric
                    label="Allotted"
                    value={count(
                      rows.reduce(
                        (total, row) => total + (row.allotted ?? 0),
                        0
                      )
                    )}
                  />
                  <Metric
                    label="Missing"
                    value={count(
                      rows.reduce((total, row) => total + row.missing, 0)
                    )}
                    tone="warn"
                  />
                </MetricRow>
                <p className="mt-3 text-[0.71875rem] text-mute">
                  {data.inventory_equation} · sightings counted over the{" "}
                  {data.observed_window_hours}h before that moment.
                </p>
              </Card>

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
