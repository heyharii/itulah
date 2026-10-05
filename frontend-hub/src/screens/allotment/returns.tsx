import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { SavedDialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState, Problem } from "@/components/ui/states"
import { count } from "@/lib/format"
import {
  createAllotment,
  fleetPools,
  idempotencyKey,
  inventoryKeys,
  poolAvailability,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import { Allotments } from "@/screens/allotment/allotments"
import { sitesOf, sourcePoolsFor, useActor } from "@/screens/inventory/shared"

/// Merchandise's "Return to HO": the allotment book narrowed to
/// `RETURN_TO_DC`, plus the one act that starts a return — asking a store to
/// send goods back. A store never starts one itself (owner, 1 Oct 2026).
///
/// "Return to supplier" lives in `screens/procurement/supplier-returns.tsx`.
export function ReturnsToHo() {
  const [asking, setAsking] = useState(false)
  /// The return the ask minted, held in the receipt dialog until it is read.
  /// State lives here because `NewReturn` unmounts the moment its `onDone`
  /// walks back to the book.
  const [savedReturn, setSavedReturn] = useState(false)
  if (asking)
    return (
      <>
        <NewReturn
          onDone={() => setAsking(false)}
          onCreated={() => setSavedReturn(true)}
        />
        <SavedDialog
          open={savedReturn}
          onOpenChange={(next) => {
            if (!next) setSavedReturn(false)
          }}
          title="Return created"
        />
      </>
    )
  return (
    <Allotments
      title="Return to HO"
      type="RETURN_TO_DC"
      actions={
        <Button variant="primary" onClick={() => setAsking(true)}>
          New return
        </Button>
      }
    />
  )
}

/// Pick a store, say how many of each SKU it should send back, ask.
function NewReturn({
  onDone,
  onCreated,
}: {
  onDone: () => void
  /// The ask went through; the receipt is the caller's to show.
  onCreated: () => void
}) {
  const client = useQueryClient()
  const actor = useActor()
  const [store, setStore] = useState("")
  const [quantities, setQuantities] = useState<Record<string, string>>({})

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  const pools = useMemo(() => fleet.data?.items ?? [], [fleet.data])
  const stores = useMemo(() => sitesOf(pools, "STORE"), [pools])
  const sources = useMemo(
    () =>
      sourcePoolsFor("RETURN_TO_DC", pools).filter((p) => p.site_id === store),
    [pools, store]
  )
  // The head-office warehouse the goods come back to (the server wants a
  // warehouse of head office as the destination).
  const destination = useMemo(
    () =>
      pools.find((p) => p.site_kind === "HO" && p.pool_code === "WAREHOUSE")
        ?.site_id ??
      pools.find((p) => p.site_kind === "HO")?.site_id ??
      "",
    [pools]
  )

  const stock = useQueries({
    queries: sources.map((pool) => ({
      queryKey: inventoryKeys.poolAvailability(pool.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        poolAvailability(pool.id, {}, signal),
    })),
  })
  const rows = useMemo(
    () =>
      sources.flatMap((pool, index) =>
        (stock[index]?.data?.items ?? [])
          .filter((item) => item.on_hand_qty > 0)
          .map((item) => ({
            key: `${pool.id}|${item.sku_id}`,
            pool,
            item,
          }))
      ),
    [sources, stock]
  )

  const lines = rows
    .map((row) => ({ row, qty: Math.floor(Number(quantities[row.key] ?? 0)) }))
    .filter(
      (one) =>
        Number.isFinite(one.qty) &&
        one.qty > 0 &&
        one.qty <= one.row.item.on_hand_qty
    )
  const total = lines.reduce((sum, one) => sum + one.qty, 0)

  const ask = useMutation({
    mutationFn: () =>
      createAllotment({
        type: "RETURN_TO_DC",
        lines: lines.map(({ row, qty }) => ({
          source_site_id: row.pool.site_id,
          source_pool_id: row.pool.id,
          destination_type: "DC",
          destination_id: destination,
          sku_id: row.item.sku_id,
          quantity: qty,
        })),
        notes: null,
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: inventoryKeys.allotments() })
      void client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
      onCreated()
      onDone()
    },
  })

  return (
    <PageContent>
      <PageHeader
        title="New Return"
        actions={
          <Button variant="quiet" onClick={onDone}>
            Back
          </Button>
        }
      />

      <Problem error={ask.error} className="mb-3" />

      <div className="grid items-start gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <Card className="flex flex-col gap-1 p-1.5">
          {stores.map((one) => (
            <button
              key={one.site_id}
              type="button"
              onClick={() => {
                setStore(one.site_id)
                setQuantities({})
              }}
              className={cn(
                "rounded-inner px-3 py-3 text-left font-medium transition-colors",
                one.site_id === store
                  ? "bg-accent-bg text-accent"
                  : "text-ink hover:bg-soft"
              )}
            >
              {one.site_name}
            </button>
          ))}
        </Card>

        {store === "" ? null : (
          <Card className="overflow-hidden">
            {queryState(
              {
                isPending: stock.some((q) => q.isPending),
                isError: stock.some((q) => q.isError),
                error: stock.find((q) => q.isError)?.error,
                data: rows,
                refetch: () => stock.forEach((q) => void q.refetch()),
              },
              {
                loading: "Reading the store's stock…",
                render: (list) =>
                  list.length === 0 ? (
                    <EmptyState>Nothing in its return stock.</EmptyState>
                  ) : (
                    <table className="w-full border-collapse text-body">
                      <thead>
                        <tr className="h-12 border-b border-hairline bg-soft text-left text-[0.875rem] font-medium text-body">
                          <th className="pl-4">SKU</th>
                          {sources.length > 1 && <th>From</th>}
                          <th className="text-right">In Return Stock</th>
                          <th className="pr-4 text-right">To Send</th>
                        </tr>
                      </thead>
                      <tbody className="[&_td]:py-3.5">
                        {list.map(({ key, pool, item }) => (
                          <tr
                            key={key}
                            className="h-16 border-b border-hairline last:border-b-0"
                          >
                            <td className="pl-4">
                              <span className="block leading-snug font-medium text-ink">
                                {item.article_name}
                              </span>
                              <span className="mt-1 block font-mono text-[0.875rem] text-mute">
                                {item.sku_code}
                              </span>
                            </td>
                            {sources.length > 1 && <td>{pool.label}</td>}
                            <td className="text-right tabular-nums">
                              {count(item.on_hand_qty)}
                            </td>
                            <td className="w-36 pr-4">
                              <Input
                                inputMode="numeric"
                                className="text-right"
                                aria-label={`Return ${item.sku_code}`}
                                value={quantities[key] ?? ""}
                                onChange={(event) =>
                                  setQuantities((was) => ({
                                    ...was,
                                    [key]: event.target.value.replace(
                                      /\D/g,
                                      ""
                                    ),
                                  }))
                                }
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ),
              }
            )}
          </Card>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between gap-4">
        <span className="text-body tabular-nums">{count(total)} pcs</span>
        <Button
          variant="primary"
          pending={ask.isPending}
          disabled={total === 0 || destination === "" || actor === ""}
          onClick={() => ask.mutate()}
        >
          {ask.isPending ? "Submitting…" : "Submit"}
        </Button>
      </div>
    </PageContent>
  )
}
