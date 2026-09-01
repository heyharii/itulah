import { useQuery } from "@tanstack/react-query"

import { PageContent } from "@/components/shell/app-shell"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { poolsAnswer, type PoolRow } from "@/lib/api"
import { clock, count } from "@/lib/format"
import { keys } from "@/lib/queries/keys"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"

/// Where the stock is — the state, as opposed to the history one screen over.
///
/// The groups and their order come from `edge_pool_metadata` in
/// `edge/http.rs` rather than being invented here, so the screen reads in the
/// order goods actually pass through the building.
///
/// The one trap this screen exists to avoid: the five outbound totals are
/// **rollups**, sums of the destination pools beneath them. Adding both would
/// report this warehouse twice, so every headline here filters to the leaves
/// and the rollups are drawn as what they are.
const GROUPS: Readonly<Record<string, { title: string; says: string }>> = {
  PENDING: {
    title: "Not yet stock",
    says: "Arrived and accepted, but not yet identified or tagged.",
  },
  WAREHOUSE: {
    title: "On the racks",
    says: "Available to pick.",
  },
  OUTBOUND: {
    title: "On the way out",
    says: "Off the racks and moving toward a shop.",
  },
  REJECT: {
    title: "Rejected",
    says: "Held back — damaged here, or sent back by a shop.",
  },
}

export function Stock() {
  const answer = useQuery({
    queryKey: keys.pools(),
    queryFn: ({ signal }) => poolsAnswer(signal),
  })

  const items = answer.data?.items ?? []
  const leaves = items.filter((pool) => !pool.is_rollup)
  const held = leaves.reduce((total, pool) => total + pool.stock, 0)
  const onHand = leaves.reduce((total, pool) => total + pool.on_hand, 0)
  const missing = leaves.reduce((total, pool) => total + pool.missing, 0)
  const allotted = leaves.reduce(
    (total, pool) => total + (pool.allotted ?? 0),
    0
  )

  const groups = Object.keys(GROUPS).filter((group) =>
    items.some((pool) => pool.group === group)
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Counting"
        title="Pools"
        sub={
          answer.data === undefined
            ? "Reading this node's pools…"
            : `As of ${clock(answer.data.as_of)}`
        }
      />

      <KpiStrip className="grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Stock"
          value={count(held)}
          delta="everything this DC owns"
        />
        <Kpi
          label="On hand"
          value={count(onHand)}
          delta="found where it should be"
        />
        <Kpi
          label="Allotted"
          value={count(allotted)}
          delta="promised to a shop"
        />
        <Kpi
          label="Missing"
          value={count(missing)}
          delta={missing > 0 ? "known to exist, not there" : "nothing lost"}
          tone={missing > 0 ? "down" : "flat"}
        />
      </KpiStrip>

      {answer.data && (
        <Banner tone="info" className="mb-[1.125rem]">
          <b className="font-medium">{answer.data.inventory_equation}.</b>{" "}
          {answer.data.aggregation_policy}. The five outbound totals are sums of
          the destination pools beneath them and are marked as such — adding
          both would report this warehouse twice.
        </Banner>
      )}

      {queryState(answer, {
        loading: "Reading this node's pools…",
        render: () =>
          items.length === 0 ? (
            <Card>
              <EmptyState>This node owns no pools yet.</EmptyState>
            </Card>
          ) : (
            <div className="flex flex-col gap-[1.125rem]">
              {groups.map((group) => (
                <PoolGroup
                  key={group}
                  title={GROUPS[group].title}
                  says={GROUPS[group].says}
                  pools={items.filter((pool) => pool.group === group)}
                />
              ))}
            </div>
          ),
      })}
    </PageContent>
  )
}

function PoolGroup({
  title,
  says,
  pools,
}: {
  title: string
  says: string
  pools: readonly PoolRow[]
}) {
  const leaves = pools.filter((pool) => !pool.is_rollup)
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <span className="text-[0.75rem] text-mute">{says}</span>
      </CardHeader>
      <table className="w-full border-collapse text-cell">
        <thead>
          <tr>
            {["Pool", "Stock", "On hand", "Allotted", "Missing"].map(
              (head, index) => (
                <th
                  key={head}
                  className={cn(
                    "border-b border-hairline px-3.5 py-[0.5625rem] text-eyebrow font-semibold whitespace-nowrap text-mute uppercase",
                    index === 0 ? "text-left" : "text-right"
                  )}
                >
                  {head}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {pools.map((pool) => (
            <tr
              key={pool.id}
              className={cn(
                "h-tap border-b border-hairline last:border-b-0",
                // A rollup is a sum of the rows around it, not another row of
                // stock. It gets the tinted band the prototypes give a total,
                // so nobody adds it to the others by eye.
                pool.is_rollup && "bg-soft"
              )}
            >
              <td className="px-3.5 py-3">
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "truncate",
                      pool.is_rollup
                        ? "font-semibold text-ink"
                        : "font-medium text-ink"
                    )}
                  >
                    {pool.label}
                  </span>
                  {pool.is_rollup && <Tag>TOTAL</Tag>}
                  {pool.destination_store_id !== null && (
                    <Tag tone="accent">{pool.destination_store_id}</Tag>
                  )}
                </span>
              </td>
              <td className="px-3.5 py-3 text-right tabular-nums">
                {count(pool.stock)}
              </td>
              <td className="px-3.5 py-3 text-right tabular-nums">
                {count(pool.on_hand)}
              </td>
              <td className="px-3.5 py-3 text-right text-body tabular-nums">
                {pool.allotted === null ? "—" : count(pool.allotted)}
              </td>
              <td className="px-3.5 py-3 text-right tabular-nums">
                {pool.missing > 0 ? (
                  <Pill tone="bad">{count(pool.missing)}</Pill>
                ) : (
                  <span className="text-mute">0</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {leaves.length === 0 && (
        <EmptyState>Nothing in this group yet.</EmptyState>
      )}
    </Card>
  )
}
