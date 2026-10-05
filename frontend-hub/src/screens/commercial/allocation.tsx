import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ApiError } from "@itulah/contract/client"

import { Switch } from "@/components/ui/form"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { ErrorState } from "@/components/ui/states"
import { count, money } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import {
  allocationKeys,
  capAllocation,
  commercialKeys,
  setCapAllocation,
  type CapAllocation,
  type ShopAllowance,
} from "@/lib/queries/commercial"
import { Quiet } from "@/screens/commercial/parts"

/// A promotion's or campaign's limit, split between the shops — the hard cap.
///
/// Off, every shop enforces the all-shops count, which a shop that has been
/// offline all afternoon holds from lunchtime. On, each shop is granted an
/// allowance and stops at it on its own sales, whether or not it can reach
/// head office; the allowances never add up to more than the limit. Half the
/// limit is split evenly at the start and the rest is handed in steps to the
/// shops that are actually selling. A grant is never taken back — the centre
/// cannot know what a shop has sold and not yet uploaded — so the table below
/// only ever grows.
///
/// Shown only where there is a limit to split; the parent decides that from
/// the terms it already holds.
export function HardCap({
  kind,
  subject,
}: {
  kind: CapAllocation["kind"]
  subject: string
}) {
  const client = useQueryClient()
  const split = useQuery({
    queryKey: allocationKeys.one(kind, subject),
    queryFn: ({ signal }) => capAllocation(kind, subject, signal),
    staleTime: 30_000,
    // A missing route will not appear on a retry.
    retry: (attempts, error) =>
      !(error instanceof ApiError && error.status === 404) && attempts < 2,
  })

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setCapAllocation(kind, subject, enabled),
    onSuccess: (next) => {
      client.setQueryData(allocationKeys.one(kind, subject), next)
      // The switch also sent the shops a fresh count.
      client.invalidateQueries({ queryKey: commercialKeys.usage() })
    },
  })

  const data = toggle.data ?? split.data
  const enabled = data?.enabled ?? false

  // A node that predates the split answers 404 for the whole route. The
  // panel is then absent rather than an error under every promotion: there is
  // nothing to switch on there yet.
  if (split.error instanceof ApiError && split.error.status === 404) return null

  return (
    <div>
      <SubHead
        aside={
          <span className="flex items-center gap-3">
            <span className="text-[0.875rem] text-body">
              {enabled ? "On" : "Off"}
            </span>
            <Switch
              on={enabled}
              busy={toggle.isPending || split.isPending}
              label={`Split the limit between stores for ${subject}`}
              onToggle={() => toggle.mutate(!enabled)}
            />
          </span>
        }
      >
        Split between stores
      </SubHead>

      {toggle.isError && (
        <div className="mb-4">
          <ErrorState error={toggle.error} />
        </div>
      )}

      {queryState(split, {
        loading: "Loading…",
        render: (fetched) => {
          const shown = toggle.data ?? fetched
          return shown.enabled ? (
            <Allowances split={shown} />
          ) : (
            <Quiet>Off.</Quiet>
          )
        },
      })}
    </div>
  )
}

function Allowances({ split }: { split: CapAllocation }) {
  const budget = split.budget_minor !== null
  const uses = split.max_uses !== null
  const held = split.shops.filter(
    (shop) => shop.budget_granted !== null || shop.uses_granted !== null
  )
  return (
    <div className="flex flex-col gap-4">
      {held.length === 0 ? (
        <Quiet>No allowances yet.</Quiet>
      ) : (
        <MiniTable
          head={[
            "Store",
            ...(budget
              ? [
                  { label: "Allowance", align: "right" as const },
                  { label: "Given away", align: "right" as const },
                ]
              : []),
            ...(uses
              ? [
                  { label: "Transactions", align: "right" as const },
                  { label: "Used", align: "right" as const },
                ]
              : []),
          ]}
        >
          {held.map((shop) => (
            <Row key={shop.origin_id} shop={shop} budget={budget} uses={uses} />
          ))}
        </MiniTable>
      )}
      <div className="flex flex-wrap justify-end gap-x-6 text-meta text-body tabular-nums">
        {split.budget_pool !== null && (
          <span>Not yet granted: {money(split.budget_pool)}</span>
        )}
        {split.uses_pool !== null && (
          <span>Transactions not yet granted: {count(split.uses_pool)}</span>
        )}
      </div>
    </div>
  )
}

function Row({
  shop,
  budget,
  uses,
}: {
  shop: ShopAllowance
  budget: boolean
  uses: boolean
}) {
  const spentOut =
    shop.budget_granted !== null && shop.own_spent_minor >= shop.budget_granted
  const usedOut =
    shop.uses_granted !== null && shop.own_uses >= shop.uses_granted
  return (
    <MiniRow>
      <MiniCell className="py-4">
        <span title={shop.origin_id} className="block truncate text-ink">
          {shop.label ?? shop.site_id ?? shop.origin_id}
        </span>
      </MiniCell>
      {budget && (
        <>
          <MiniCell align="right" className="py-4">
            {shop.budget_granted === null ? "—" : money(shop.budget_granted)}
          </MiniCell>
          <MiniCell align="right" className="py-4">
            <span className={spentOut ? "text-bad-fg" : "text-body"}>
              {money(shop.own_spent_minor)}
            </span>
          </MiniCell>
        </>
      )}
      {uses && (
        <>
          <MiniCell align="right" className="py-4">
            {shop.uses_granted === null ? "—" : count(shop.uses_granted)}
          </MiniCell>
          <MiniCell align="right" className="py-4">
            <span className={usedOut ? "text-bad-fg" : "text-body"}>
              {count(shop.own_uses)}
            </span>
          </MiniCell>
        </>
      )}
    </MiniRow>
  )
}
