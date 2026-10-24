import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Fragment, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { SavedDialog } from "@/components/ui/dialog"
import { Fab } from "@/components/ui/fab"
import { Input } from "@/components/ui/field"
import { Thumbnail } from "@/components/ui/thumbnail"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState, Problem } from "@/components/ui/states"
import { count, quantity, sku as skuNumber } from "@/lib/format"
import {
  fleetPools,
  type FleetPool,
  inventoryKeys,
  markStoreReturn,
  poolAvailability,
} from "@/lib/queries/inventory"
import { useSiteLabel } from "@/lib/queries/organisation"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import { Allotments } from "@/screens/allotment/allotments"
import { sitesOf, sourcePoolsFor } from "@/screens/inventory/shared"

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
  const [savedReturn, setSavedReturn] = useState<string | null>(null)
  if (asking)
    return (
      <>
        <NewReturn onDone={() => setAsking(false)} onCreated={setSavedReturn} />
        <SavedDialog
          open={savedReturn !== null}
          onOpenChange={(next) => {
            if (!next) setSavedReturn(null)
          }}
          title={savedReturn ?? "Moved to Return HO"}
        />
      </>
    )
  return (
    <>
      <Allotments
        title="Return HO"
        type="RETURN_TO_DC"
        actions={
          <span className="max-md:hidden">
            <Button variant="primary" onClick={() => setAsking(true)}>
              New return
            </Button>
          </span>
        }
      />
      {/* A phone's is the dock's round plus, as on every list. */}
      <Fab label="New Return" onClick={() => setAsking(true)} />
    </>
  )
}

/// Pick the stores, say how many of each colour · size goes back, and move
/// them to the store's To be returned · Return HO (owner, 23 Oct 2026,
/// "chips + matrix").
///
/// The stores are chips — a name and what it holds — any number at once; each
/// chosen store is a column of the matrix, its article rows and colour · size
/// rows as New allotment draws them. A box takes how many; under it what the
/// store holds of that SKU on its warehouse and floor. Move sends each store
/// one command (`markStoreReturn`): its node moves the pieces into Return HO
/// at once, warehouse first, and the store sends them when it is ready. A
/// store's own reject is its to send, so it is not offered here.
function NewReturn({
  onDone,
  onCreated,
}: {
  onDone: () => void
  /// The move went through; the receipt is the caller's to show.
  onCreated: (number: string) => void
}) {
  const client = useQueryClient()
  const placeName = useSiteLabel()
  const [chosen, setChosen] = useState<readonly string[]>([])
  /// `store|sku` → pieces.
  const [quantities, setQuantities] = useState<Record<string, string>>({})

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  const pools = useMemo(() => fleet.data?.items ?? [], [fleet.data])
  const stores = useMemo(() => sitesOf(pools, "STORE"), [pools])
  const sources = useMemo(
    () =>
      sourcePoolsFor("RETURN_TO_DC", pools).filter(
        (pool) => pool.pool_code !== "REJECT"
      ),
    [pools]
  )
  // What each store holds, for its chip.
  const held = useMemo(() => {
    const by = new Map<string, number>()
    for (const pool of sources)
      by.set(pool.site_id, (by.get(pool.site_id) ?? 0) + pool.on_hand)
    return by
  }, [sources])
  const read = useMemo(
    () => sources.filter((pool) => chosen.includes(pool.site_id)),
    [sources, chosen]
  )
  const stock = useQueries({
    queries: read.map((pool) => ({
      queryKey: inventoryKeys.poolAvailability(pool.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        poolAvailability(pool.id, {}, signal),
    })),
  })

  // Articles → colour · size rows → per store, the pools that hold it.
  const matrix = useMemo(() => {
    const articles = new Map<string, Article>()
    read.forEach((pool, index) => {
      for (const item of stock[index]?.data?.items ?? []) {
        if (item.on_hand_qty <= 0) continue
        const article = articles.get(item.article_id) ?? {
          id: item.article_id,
          code: item.article_code,
          name: item.article_name,
          image: item.image_url,
          division: item.division_code,
          skus: new Map(),
        }
        const sku = article.skus.get(item.sku_id) ?? {
          id: item.sku_id,
          code: item.sku_code,
          label: [item.colour, item.size].filter(Boolean).join(" · "),
          at: new Map(),
        }
        const shelves = sku.at.get(pool.site_id) ?? []
        shelves.push({ pool, held: item.on_hand_qty })
        sku.at.set(pool.site_id, shelves)
        article.skus.set(item.sku_id, sku)
        articles.set(item.article_id, article)
      }
    })
    return [...articles.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [read, stock])

  const heldAt = (sku: SkuRow, store: string) =>
    (sku.at.get(store) ?? []).reduce((sum, one) => sum + one.held, 0)
  const typed = (store: string, sku: SkuRow) => {
    const value = Math.floor(Number(quantities[`${store}|${sku.id}`] ?? 0))
    return Number.isFinite(value) && value > 0
      ? Math.min(value, heldAt(sku, store))
      : 0
  }

  // One move per store, a line per SKU; the store's node takes the pieces
  // off its warehouse first, then its floor.
  const plans = chosen
    .map((store) => {
      const lines = matrix.flatMap((article) =>
        [...article.skus.values()].flatMap((sku) => {
          const qty = typed(store, sku)
          return qty > 0 ? [{ sku, qty }] : []
        })
      )
      return { store, lines }
    })
    .filter((plan) => plan.lines.length > 0)
  const total = plans.reduce(
    (sum, plan) => sum + plan.lines.reduce((s, one) => s + one.qty, 0),
    0
  )

  const move = useMutation({
    mutationFn: async () => {
      let pieces = 0
      for (const plan of plans) {
        const moved = await markStoreReturn(
          plan.store,
          plan.lines.map(({ sku, qty }) => ({ sku_code: sku.code, quantity: qty }))
        )
        pieces += moved.pieces
      }
      return { pieces, stores: plans.length }
    },
    onSuccess: ({ pieces, stores }) => {
      void client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
      onCreated(
        `${quantity(pieces)} moved to Return HO${stores > 1 ? ` at ${stores} stores` : ""}`
      )
      onDone()
    },
  })

  const toggle = (store: string) => {
    if (chosen.includes(store)) {
      setChosen(chosen.filter((one) => one !== store))
      setQuantities((was) =>
        Object.fromEntries(
          Object.entries(was).filter(([key]) => !key.startsWith(`${store}|`))
        )
      )
    } else setChosen([...chosen, store].sort())
  }
  const movedAt = (store: string) =>
    plans
      .find((plan) => plan.store === store)
      ?.lines.reduce((sum, one) => sum + one.qty, 0) ?? 0

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

      <Problem error={move.error} className="mb-3" />

      {/* The stores are the page's scope: chips, any number at once, each a
          column below. */}
      <div
        role="group"
        aria-label="Stores"
        className="mb-3.5 flex flex-wrap items-center gap-1.5"
      >
        {stores.map((one) => {
          const on = chosen.includes(one.site_id)
          const moved = movedAt(one.site_id)
          const has = held.get(one.site_id) ?? 0
          return (
            <button
              key={one.site_id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(one.site_id)}
              className={cn(
                "inline-flex h-9 min-w-0 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-[0.9375rem] font-medium whitespace-nowrap",
                "transition-[background-color,border-color,color,scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.97]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                on
                  ? "border-accent bg-accent-bg text-accent"
                  : "border-hairline-2 bg-canvas text-ink hover:border-hairline-strong hover:bg-soft-2"
              )}
            >
              {placeName(one.site_id)}
              <span
                className={cn(
                  "font-normal tabular-nums",
                  on ? "text-accent" : "text-mute"
                )}
              >
                {moved > 0 ? `${count(moved)} of ${count(has)}` : count(has)}
              </span>
            </button>
          )
        })}
      </div>

      {chosen.length === 0 ? (
        <Card>
          <EmptyState>Choose the stores whose goods go back to HO.</EmptyState>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          {queryState(
            {
              isPending: stock.some((q) => q.isPending),
              isError: stock.some((q) => q.isError),
              error: stock.find((q) => q.isError)?.error,
              data: matrix,
              refetch: () => stock.forEach((q) => void q.refetch()),
            },
            {
              loading: "Reading the stores' stock…",
              render: (list) =>
                list.length === 0 ? (
                  <EmptyState>Nothing in these stores.</EmptyState>
                ) : (
                  <table className="w-full border-collapse text-body">
                    <thead>
                      <tr className="h-14 border-b border-hairline bg-soft text-left text-[0.9375rem] font-medium text-body">
                        <th className="pl-4">Article</th>
                        {chosen.map((store) => {
                          // "C001 · Cikupa": the code over the name, two
                          // even lines whatever the name's length.
                          const name = placeName(store)
                          const cut = name.indexOf(" · ")
                          const code = cut === -1 ? name : name.slice(0, cut)
                          const rest = cut === -1 ? "" : name.slice(cut + 3)
                          return (
                            <th
                              key={store}
                              title={name}
                              className="w-36 max-w-36 px-4 py-2 text-right leading-snug"
                            >
                              <span className="block truncate font-semibold text-ink">
                                {code}
                              </span>
                              {rest !== "" && (
                                <span className="block truncate font-normal text-mute">
                                  {rest}
                                </span>
                              )}
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((article) => (
                        <Fragment key={article.id}>
                          <tr className="border-b border-hairline">
                            <td colSpan={chosen.length + 1} className="py-3 pl-4">
                              <span className="flex items-center gap-3">
                                <Thumbnail
                                  url={article.image}
                                  name={article.name}
                                  division={article.division}
                                  className="size-11 shrink-0 rounded-inner"
                                />
                                <span className="min-w-0">
                                  <span className="block truncate font-semibold text-ink">
                                    {article.name}
                                  </span>
                                  <span className="block font-mono text-[0.9375rem] text-mute">
                                    {article.code}
                                  </span>
                                </span>
                              </span>
                            </td>
                          </tr>
                          {[...article.skus.values()].map((sku) => (
                            <tr
                              key={sku.id}
                              className="border-b border-hairline last:border-b-0"
                            >
                              <td className="py-2.5 pl-[4.5rem]">
                                <span className="text-ink">{sku.label || "—"}</span>
                                <span className="ml-2 font-mono text-[0.9375rem] text-mute">
                                  {skuNumber(sku.code)}
                                </span>
                              </td>
                              {chosen.map((store) => {
                                const has = heldAt(sku, store)
                                const key = `${store}|${sku.id}`
                                return (
                                  <td key={store} className="px-4 py-2.5 text-right">
                                    <Input
                                      inputMode="numeric"
                                      disabled={has === 0}
                                      placeholder="0"
                                      className={cn(
                                        "ml-auto w-20 text-right tabular-nums",
                                        typed(store, sku) > 0 &&
                                          "border-accent bg-accent-bg font-semibold text-accent"
                                      )}
                                      aria-label={`${placeName(store)} ${skuNumber(sku.code)} to be returned`}
                                      value={quantities[key] ?? ""}
                                      onChange={(event) =>
                                        setQuantities((was) => ({
                                          ...was,
                                          [key]: event.target.value.replace(/\D/g, ""),
                                        }))
                                      }
                                    />
                                    <span className="mt-1 block text-[0.9375rem] text-mute tabular-nums">
                                      of {count(has)}
                                    </span>
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                ),
            }
          )}
        </Card>
      )}

      <div className="mt-5 flex items-center justify-between gap-4">
        <span className="text-body tabular-nums">{quantity(total)}</span>
        <Button
          variant="primary"
          pending={move.isPending}
          disabled={total === 0}
          onClick={() => move.mutate()}
        >
          {move.isPending ? "Moving…" : "Move to To be returned"}
        </Button>
      </div>
    </PageContent>
  )
}

interface SkuRow {
  readonly id: string
  readonly code: string
  /// "Navy · M".
  readonly label: string
  /// store → the pools that hold this SKU there.
  readonly at: Map<string, { pool: FleetPool; held: number }[]>
}

interface Article {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly image: string | null
  readonly division: string | null
  readonly skus: Map<string, SkuRow>
}
