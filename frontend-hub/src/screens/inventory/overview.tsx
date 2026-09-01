import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { PackageX, Scale, ShieldCheck, TriangleAlert } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { ExceptionQueue, type Exception } from "@/components/ui/exception-queue"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count } from "@/lib/format"
import {
  controlStatus,
  fleetPools,
  inventoryKeys,
  listMissing,
  type FleetPool,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { age, percent, useGo } from "@/screens/inventory/shared"

/// Inventory overview — exceptions first, then the numbers.
///
/// DESIGN.md is blunt that an overview leads with a queue of problems and not
/// with vanity KPIs, and inventory has an unusually sharp version of that: the
/// fleet total is **null** whenever the server cannot certify it. A screen that
/// rendered `fleet_total ?? 0` would print a confident zero over a stale Edge
/// checkpoint, which is the exact failure the server refused to commit. So the
/// strip says "Uncertified", and the reasons are the first thing in the queue.
///
/// Three reads, and only one of them governs the screen. The fleet read is the
/// page; the ledger-control and missing reads add rows to the queue and are
/// allowed to be absent — a broken control endpoint should cost the reader the
/// two lines it contributes, not the whole overview.

const columns: ColumnDef<TableSetup, FleetPool>[] = [
  {
    id: "pool",
    accessorFn: (row) => row.label,
    header: "Pool",
    size: 220,
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
    accessorKey: "site_kind",
    header: "Kind",
    size: 90,
    cell: ({ row }) => <Tag>{row.original.site_kind}</Tag>,
  },
  {
    accessorKey: "stock",
    header: "Stock",
    size: 100,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.stock),
  },
  {
    accessorKey: "missing",
    header: "Missing",
    size: 100,
    meta: { align: "right" },
    // The decision metric on an overview: stock nobody can find is the only
    // number here that costs somebody an afternoon.
    cell: ({ row }) => (
      <span
        className={
          row.original.missing > 0 ? "font-medium text-bad-fg" : "text-mute"
        }
      >
        {count(row.original.missing)}
      </span>
    ),
  },
  {
    accessorKey: "lost_rate",
    header: "Lost rate",
    size: 110,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className={row.original.lost_rate ? "text-warn-fg" : "text-mute"}>
        {percent(row.original.lost_rate)}
      </span>
    ),
  },
  {
    accessorKey: "sync_status",
    header: "Sync",
    size: 110,
    cell: ({ row }) => {
      const status = row.original.sync_status
      return (
        <Pill
          tone={
            status === "CURRENT" || status === "LOCAL"
              ? "ok"
              : status === "STALE"
                ? "warn"
                : "info"
          }
        >
          {status === "LOCAL" ? "Cloud" : status.toLowerCase()}
        </Pill>
      )
    },
  },
]

export function InventoryOverview() {
  const go = useGo()
  const [sorting, setSorting] = useState<SortingState>([
    { id: "missing", desc: true },
  ])

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })
  const control = useQuery({
    queryKey: inventoryKeys.control(),
    queryFn: ({ signal }) => controlStatus(signal),
  })
  const missing = useQuery({
    queryKey: inventoryKeys.missing(),
    queryFn: ({ signal }) => listMissing(signal),
  })

  // Only the pools that trouble somebody. Not a `slice()` — a filter on a
  // stated condition, which is a different thing from hiding the tail of a list.
  const troubled = useMemo(
    () =>
      (fleet.data?.items ?? []).filter(
        (pool) => pool.missing > 0 || (pool.lost_rate ?? 0) > 0
      ),
    [fleet.data]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: troubled,
        columns,
        getRowId: (row: FleetPool) => `${row.origin_id}/${row.id}`,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [troubled, sorting]
    )
  )

  const exceptions = useMemo((): Exception[] => {
    const list: Exception[] = []
    const diagnostics = fleet.data?.fleet_total_diagnostics
    const reconciliation = fleet.data?.reconciliation_summary

    if (fleet.data && fleet.data.fleet_total === null) {
      list.push({
        id: "uncertified",
        severity: "high",
        icon: <ShieldCheck className="size-4" />,
        title: "The fleet total cannot be certified",
        detail: (diagnostics?.certification_reasons ?? [])
          .map((reason) => reason.toLowerCase().replace(/_/g, " "))
          .join(" · "),
        amount: `${diagnostics?.certification_reasons.length ?? 0} reasons`,
        onOpen: () => go("/inventory/reconciliations"),
      })
    }
    if (diagnostics && diagnostics.missing_edge_origins.length > 0) {
      list.push({
        id: "missing-checkpoints",
        severity: "high",
        icon: <TriangleAlert className="size-4" />,
        title: "Edge nodes that have never checkpointed",
        detail: diagnostics.missing_edge_origins.join(", "),
        amount: count(diagnostics.missing_edge_origins.length),
        onOpen: () => go("/inventory/pools"),
      })
    }
    if (diagnostics && diagnostics.stale_edge_origins.length > 0) {
      list.push({
        id: "stale-checkpoints",
        severity: "medium",
        icon: <TriangleAlert className="size-4" />,
        title: "Edge checkpoints older than five minutes",
        detail: diagnostics.stale_edge_origins.join(", "),
        amount: count(diagnostics.stale_edge_origins.length),
        onOpen: () => go("/inventory/pools"),
      })
    }
    if (reconciliation && reconciliation.store_only > 0) {
      list.push({
        id: "store-only",
        severity: "high",
        icon: <Scale className="size-4" />,
        title: "Stores signed for goods no DC says it sent",
        detail:
          "Every one of these has to be resolved before the fleet certifies.",
        amount: count(reconciliation.store_only),
        onOpen: () => go("/inventory/reconciliations"),
      })
    }
    if (
      reconciliation &&
      reconciliation.conflicts + reconciliation.unresolved > 0
    ) {
      list.push({
        id: "reconciliation-conflicts",
        severity: "medium",
        icon: <Scale className="size-4" />,
        title: "Transfer claims that do not line up",
        detail: `${count(reconciliation.conflicts)} conflicting · ${count(reconciliation.unresolved)} unresolved`,
        amount: count(reconciliation.conflicts + reconciliation.unresolved),
        onOpen: () => go("/inventory/reconciliations"),
      })
    }
    if (control.data && control.data.ledger_health !== "HEALTHY") {
      list.push({
        id: "ledger",
        severity: "high",
        icon: <ShieldCheck className="size-4" />,
        title: "The projection disagrees with the ledger",
        detail: `${count(control.data.projection_difference_count)} rows · ${count(control.data.outbound_rollup_difference_count)} stage rollups`,
        amount: count(
          control.data.projection_difference_count +
            control.data.outbound_rollup_difference_count
        ),
        onOpen: () => go("/inventory/control"),
      })
    }
    if (missing.data && missing.data.length > 0) {
      const oldest = missing.data.reduce(
        (worst, item) => Math.max(worst, item.age_hours ?? 0),
        0
      )
      list.push({
        id: "missing",
        severity: oldest > 24 * 14 ? "high" : "medium",
        icon: <PackageX className="size-4" />,
        title: "Stock the ledger cannot find",
        detail: `Oldest has been missing ${age(oldest)}.`,
        amount: count(missing.data.length),
        onOpen: () => go("/inventory/missing"),
      })
    }
    return list
  }, [fleet.data, control.data, missing.data, go])

  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="Overview"
        sub="What the business holds, and what is stopping anybody from being sure of it."
      />

      {control.isError && (
        <Banner tone="bad" className="mb-3">
          The ledger check could not be read:{" "}
          {control.error instanceof Error
            ? control.error.message
            : "the server could not be reached."}
        </Banner>
      )}

      {queryState(fleet, {
        loading: "Counting the fleet…",
        render: (data) => (
          <>
            <KpiStrip>
              <Kpi
                label="Fleet stock"
                value={
                  data.fleet_total === null
                    ? "Uncertified"
                    : count(data.fleet_total)
                }
                delta={data.fleet_total_status.toLowerCase()}
                tone={data.fleet_total === null ? "down" : "flat"}
              />
              <Kpi
                label="On hand"
                value={count(
                  data.items.reduce(
                    (total, pool) =>
                      pool.authority.included_in_fleet_total
                        ? total + pool.on_hand
                        : total,
                    0
                  )
                )}
              />
              <Kpi
                label="Allotted"
                value={count(
                  data.items.reduce(
                    (total, pool) =>
                      pool.authority.included_in_fleet_total
                        ? total + (pool.allotted ?? 0)
                        : total,
                    0
                  )
                )}
              />
              <Kpi
                label="Missing"
                value={count(
                  data.items.reduce(
                    (total, pool) =>
                      pool.authority.included_in_fleet_total
                        ? total + pool.missing
                        : total,
                    0
                  )
                )}
              />
              <Kpi
                label="Matched transfers"
                value={count(data.reconciliation_summary.matched)}
                delta={`${count(data.reconciliation_summary.dc_only)} in the air`}
              />
              <Kpi
                label="Ledger facts"
                value={
                  control.data ? count(control.data.ledger_fact_count) : "—"
                }
                delta={control.data?.ledger_health.toLowerCase()}
                tone={control.data?.ledger_health === "HEALTHY" ? "up" : "down"}
              />
            </KpiStrip>

            {data.fleet_total === null && (
              <Banner tone="warn" className="mb-[1.125rem]">
                The server will not publish a fleet total it cannot stand
                behind.{" "}
                {data.fleet_total_diagnostics.calculated_total.toLocaleString(
                  "id-ID"
                )}{" "}
                is what the arithmetic gives — it is shown here and nowhere
                else, because until the reasons above are cleared it is a
                number, not an answer.
              </Banner>
            )}

            <ExceptionQueue
              exceptions={exceptions}
              empty="Every node has checkpointed, every transfer is matched and the ledger agrees with itself."
            />

            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>Pools losing stock</CardTitle>
                <span className="text-[0.75rem] text-mute tabular-nums">
                  {count(troubled.length)} of {count(data.items.length)}
                </span>
              </CardHeader>
              {troubled.length === 0 ? (
                <EmptyState>
                  No pool is holding missing stock or has lost anything in the
                  last {data.lost_risk_window_days} days.
                </EmptyState>
              ) : (
                <DataTable<FleetPool>
                  table={table}
                  className="max-h-[calc(100vh-30rem)] border-t border-hairline"
                />
              )}
            </Card>
          </>
        ),
      })}
    </PageContent>
  )
}
