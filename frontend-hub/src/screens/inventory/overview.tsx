import { useQuery } from "@tanstack/react-query"

import { PageContent } from "@/components/shell/app-shell"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Banner } from "@/components/ui/states"
import { count } from "@/lib/format"
import {
  controlStatus,
  fleetPools,
  inventoryKeys,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { PoolsBody } from "@/screens/inventory/pools"

/// Inventory — the fleet's numbers, then every pool behind them.
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

export function InventoryOverview() {
  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })
  const control = useQuery({
    queryKey: inventoryKeys.control(),
    queryFn: ({ signal }) => controlStatus(signal),
  })

  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="Stock"
        sub="What the business holds, what is stopping anybody from being sure of it, and every pool it is standing in."
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

            <PoolsBody />
          </>
        ),
      })}
    </PageContent>
  )
}
