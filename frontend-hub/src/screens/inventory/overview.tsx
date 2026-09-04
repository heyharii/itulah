import { useQuery } from "@tanstack/react-query"

import { PageContent } from "@/components/shell/app-shell"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { count } from "@/lib/format"
import { fleetPools, inventoryKeys } from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { PoolsBody } from "@/screens/inventory/pools"

/// Inventory — the fleet's numbers, then every pool behind them.
///
/// Four figures and the pools they came from. The strip used to carry six of
/// them, a paragraph and a flag: the server returns `fleet_total: null`
/// whenever it will not certify the arithmetic, and the screen printed
/// "Uncertified" where the number goes, then explained itself underneath at
/// length, then said "uncertified" a second time under that.
///
/// All of it has gone, and the figure is the arithmetic the server itself did
/// (`calculated_total`). A word like *uncertified* under a number tells a
/// reader that something is wrong and not one thing about what — it is a
/// warning nobody can act on, which is a worse read than no warning. The
/// reasons are named, one per line, on **Control**, and that is where a person
/// who wants them is going.

export function InventoryOverview() {
  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="Stock"
        sub="What the business holds, and every pool it is standing in."
      />

      {queryState(fleet, {
        loading: "Counting the fleet…",
        render: (data) => {
          /// Only rows the server counts. A shadowed Cloud row and a stage
          /// rollup are both real rows and neither is a second piece of stock.
          const total = (pick: (pool: (typeof data.items)[number]) => number) =>
            data.items.reduce(
              (running, pool) =>
                pool.authority.included_in_fleet_total
                  ? running + pick(pool)
                  : running,
              0
            )

          return (
            <>
              <KpiStrip className="md:grid-cols-4 xl:grid-cols-4">
                <Kpi
                  label="Stock"
                  value={count(
                    data.fleet_total ??
                      data.fleet_total_diagnostics.calculated_total
                  )}
                />
                <Kpi label="On hand" value={count(total((p) => p.on_hand))} />
                <Kpi
                  label="Allotted"
                  value={count(total((p) => p.allotted ?? 0))}
                />
                <Kpi label="Missing" value={count(total((p) => p.missing))} />
              </KpiStrip>

              <PoolsBody />
            </>
          )
        },
      })}
    </PageContent>
  )
}
