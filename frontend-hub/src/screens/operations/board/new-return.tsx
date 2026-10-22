import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { ChevronLeft } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/field"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState, LoadingState, Problem } from "@/components/ui/states"
import { Thumbnail } from "@/components/ui/thumbnail"
import { useColourwayFill } from "@/lib/colourway-fill"
import { count, quantity, sku as skuNumber } from "@/lib/format"
import {
  createAllotmentBatch,
  fleetPools,
  idempotencyKey,
  inventoryKeys,
  poolAvailability,
  type AvailabilityItem,
  type CreateAllotmentRequest,
} from "@/lib/queries/inventory"
import { useSiteLabel } from "@/lib/queries/organisation"
import { cn } from "@/lib/utils"
import { sitesOf, sourcePoolsFor, useActor } from "@/screens/inventory/shared"

/// **New return** (owner's sketch, 20 Oct 2026): the stores as tiles on top,
/// to switch between them; under them the chosen store's return stock — the
/// article with its picture, how many it holds — and a box for how many go
/// back. Each store has its own Submit return; the foot's Return all sends
/// every store that has something typed. Both pass through Review return
/// first, as a new PO passes through Review order.
///
/// One store is one return (owner, 20 Oct 2026: "kalau isi 4 store, 4
/// return") — which is also the server's own rule: an allotment has exactly
/// one source site.
interface Line {
  readonly key: string
  readonly site: string
  readonly poolId: string
  readonly item: AvailabilityItem
}

export function NewReturnSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const actor = useActor()
  const placeName = useSiteLabel()
  const fill = useColourwayFill()
  const [store, setStore] = useState<string | null>(null)
  const [typed, setTyped] = useState<Record<string, string>>({})
  /// Review return: every store with something typed, or the one store
  /// whose own Submit return was pressed.
  const [review, setReview] = useState<"all" | string | null>(null)

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
    enabled: open,
  })
  const pools = useMemo(() => fleet.data?.items ?? [], [fleet.data])
  const sources = useMemo(() => sourcePoolsFor("RETURN_TO_DC", pools), [pools])
  // The head-office warehouse the goods come back to.
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
      enabled: open,
    })),
  })
  const lines = useMemo<Line[]>(
    () =>
      sources.flatMap((pool, index) =>
        (stock[index]?.data?.items ?? [])
          .filter((item) => item.on_hand_qty > 0)
          .map((item) => ({
            key: `${pool.id}|${item.sku_id}`,
            site: pool.site_id,
            poolId: pool.id,
            item,
          }))
      ),
    [sources, stock]
  )
  // Only the stores that hold something to send back.
  const stores = useMemo(
    () =>
      sitesOf(pools, "STORE").filter((one) =>
        lines.some((line) => line.site === one.site_id)
      ),
    [pools, lines]
  )
  const shown = store ?? stores[0]?.site_id ?? null

  const qty = (line: Line) => Math.floor(Number(typed[line.key] ?? 0)) || 0
  const over = (line: Line) => qty(line) > line.item.on_hand_qty
  const linesOf = (site: string) => lines.filter((line) => line.site === site)
  const sentOf = (site: string) =>
    linesOf(site).reduce((sum, line) => sum + qty(line), 0)
  const heldOf = (site: string) =>
    linesOf(site).reduce((sum, line) => sum + line.item.on_hand_qty, 0)
  const anyOver = lines.some(over)
  const filled = stores.filter((one) => sentOf(one.site_id) > 0)
  const reviewed =
    review === null
      ? []
      : review === "all"
        ? filled
        : filled.filter((one) => one.site_id === review)
  const total = filled.reduce((sum, one) => sum + sentOf(one.site_id), 0)

  const requestOf = (site: string): CreateAllotmentRequest => ({
    type: "RETURN_TO_DC",
    lines: linesOf(site)
      .filter((line) => qty(line) > 0)
      .map((line) => ({
        source_site_id: line.site,
        source_pool_id: line.poolId,
        destination_type: "DC",
        destination_id: destination,
        sku_id: line.item.sku_id,
        quantity: qty(line),
      })),
    notes: null,
    actor_id: actor,
    idempotency_key: idempotencyKey(),
  })

  const submit = useMutation({
    mutationFn: (sites: readonly string[]) =>
      createAllotmentBatch(sites.map(requestOf)),
    onSuccess: (made, sites) => {
      void client.invalidateQueries({ queryKey: inventoryKeys.allotments() })
      void client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
      const n = made.items.length
      toast.success(
        n === 1
          ? `${made.items[0]?.allotment_number ?? "Return"} created`
          : `${count(n)} returns created`
      )
      // What was sent leaves the boxes; a store still typed stays.
      setTyped((was) => {
        const next = { ...was }
        for (const line of lines)
          if (sites.includes(line.site)) delete next[line.key]
        return next
      })
      setReview(null)
      if (review === "all" || sites.length === filled.length) onClose()
    },
  })

  const close = () => {
    setReview(null)
    onClose()
  }

  const loading = fleet.isPending || stock.some((query) => query.isPending)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && close()}
      context="Return Store"
      title={review === null ? "New return" : "Review return"}
      width="wide"
      footer={
        review === null ? (
          <div className="flex items-center justify-end gap-2">
            {/* White, not the red every other Cancel wears (owner, 20 Oct
                2026, New return): the word is wrapped so `Button`'s Cancel
                rule, which reads a bare string, leaves it alone. */}
            <Button variant="ghost" onClick={close}>
              <span>Cancel</span>
            </Button>
            <Button
              variant="primary"
              disabled={filled.length === 0 || anyOver}
              onClick={() => setReview("all")}
            >
              {`Return all · ${count(filled.length)} ${filled.length === 1 ? "store" : "stores"}`}
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setReview(null)}>
              <ChevronLeft />
              Back to editing
            </Button>
            <Button
              variant="primary"
              pending={submit.isPending}
              disabled={
                reviewed.length === 0 || destination === "" || actor === ""
              }
              onClick={() =>
                submit.mutate(reviewed.map((one) => one.site_id))
              }
            >
              {submit.isPending
                ? "Submitting…"
                : `Submit ${count(reviewed.length)} ${reviewed.length === 1 ? "return" : "returns"}`}
            </Button>
          </div>
        )
      }
    >
      <Problem error={submit.error} className="mb-3" />
      {loading ? (
        <LoadingState>Reading the stores' return stock…</LoadingState>
      ) : stores.length === 0 || shown === null ? (
        <EmptyState>No store holds return stock.</EmptyState>
      ) : review === null ? (
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap gap-2.5">
            {stores.map((one) => {
              const sent = sentOf(one.site_id)
              return (
                <button
                  key={one.site_id}
                  type="button"
                  onClick={() => setStore(one.site_id)}
                  className={cn(
                    "min-w-40 rounded-card border px-3.5 py-3 text-left transition-[border-color,background-color,scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.98] max-sm:min-w-0 max-sm:flex-[1_1_40%]",
                    one.site_id === shown
                      ? "border-accent bg-accent-bg ring-1 ring-accent"
                      : "border-hairline-2 bg-canvas hover:bg-soft-2"
                  )}
                >
                  <span className="block font-medium text-ink">
                    {placeName(one.site_id)}
                  </span>
                  <span className="mt-1 block text-body tabular-nums">
                    {`${quantity(heldOf(one.site_id))} in return`}
                    {sent > 0 && (
                      <span className="font-semibold text-accent">{` · ${count(sent)} to send`}</span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="flex items-center justify-between gap-3">
            <h3 className="text-card-title font-semibold text-ink">
              {placeName(shown)}
            </h3>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() =>
                  setTyped((was) => {
                    const next = { ...was }
                    for (const line of linesOf(shown))
                      next[line.key] = String(line.item.on_hand_qty)
                    return next
                  })
                }
              >
                Fill all
              </Button>
              <Button
                variant="primary"
                disabled={sentOf(shown) === 0 || linesOf(shown).some(over)}
                onClick={() => setReview(shown)}
              >
                Submit return
              </Button>
            </div>
          </div>

          <Card className="overflow-hidden">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="h-10 border-b border-hairline bg-soft text-left text-eyebrow font-medium text-body">
                  <th className="pl-4">Article</th>
                  <th className="pr-6 text-right max-sm:hidden">Quantity</th>
                  <th className="w-36 pr-4 text-right">Return</th>
                </tr>
              </thead>
              <tbody>
                {linesOf(shown).map((line) => (
                  <tr
                    key={line.key}
                    className="border-b border-hairline last:border-b-0"
                  >
                    <td className="py-3 pl-4">
                      <ArticleCell item={line.item} fill={fill}>
                        <span className="sm:hidden">{` · ${quantity(line.item.on_hand_qty)}`}</span>
                      </ArticleCell>
                    </td>
                    <td className="pr-6 text-right tabular-nums max-sm:hidden">
                      {quantity(line.item.on_hand_qty)}
                    </td>
                    <td className="py-3 pr-4">
                      <Input
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="0"
                        aria-label={`Return ${skuNumber(line.item.sku_code)}`}
                        aria-invalid={over(line) || undefined}
                        className={cn(
                          "h-11 text-center font-semibold",
                          over(line) && "border-bad-fg text-bad-fg"
                        )}
                        value={typed[line.key] ?? ""}
                        onChange={(event) =>
                          setTyped((was) => ({
                            ...was,
                            [line.key]: event.target.value.replace(/\D/g, ""),
                          }))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Totals
            rows={[
              [placeName(shown), quantity(sentOf(shown))],
              [
                `${count(filled.length)} ${filled.length === 1 ? "store" : "stores"} · ${count(filled.length)} ${filled.length === 1 ? "return" : "returns"}`,
                quantity(total),
              ],
            ]}
          />
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-3.5">
          {reviewed.map((one, index) => (
            <Card key={one.site_id} className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-soft px-4 py-3">
                <span>
                  <span className="font-semibold text-ink">
                    {placeName(one.site_id)}
                  </span>
                  <span className="text-body"> → Gudang HO</span>
                </span>
                <span className="text-body tabular-nums">
                  {`Return ${index + 1} of ${reviewed.length} · `}
                  <span className="font-semibold text-ink">
                    {quantity(sentOf(one.site_id))}
                  </span>
                </span>
              </div>
              <table className="w-full border-collapse text-body">
                <tbody>
                  {linesOf(one.site_id)
                    .filter((line) => qty(line) > 0)
                    .map((line) => (
                      <tr
                        key={line.key}
                        className="border-b border-hairline last:border-b-0"
                      >
                        <td className="py-3 pl-4">
                          <ArticleCell item={line.item} fill={fill} />
                        </td>
                        <td className="pr-4 text-right font-semibold text-ink tabular-nums">
                          {quantity(qty(line))}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </Card>
          ))}
          <Totals
            rows={[
              [
                `${count(reviewed.length)} ${reviewed.length === 1 ? "return" : "returns"}`,
                quantity(
                  reviewed.reduce((sum, one) => sum + sentOf(one.site_id), 0)
                ),
              ],
            ]}
          />
        </div>
      )}
    </Sheet>
  )
}

/// The article as the hub draws one: its picture, its name, and under it the
/// SKU with colour and size.
function ArticleCell({
  item,
  fill,
  children,
}: {
  item: AvailabilityItem
  fill: ReturnType<typeof useColourwayFill>
  children?: React.ReactNode
}) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Thumbnail
        url={item.image_url}
        name={item.article_name}
        division={item.division_code ?? undefined}
        colours={fill(item.colour)}
        className="size-11 shrink-0 rounded-inner"
      />
      <span className="flex min-w-0 flex-col gap-0.5 leading-5">
        <span className="truncate font-medium text-ink">
          {item.article_name}
        </span>
        <span className="truncate text-[0.9375rem] text-mute">
          <span className="font-mono">{skuNumber(item.sku_code)}</span>
          {[item.colour, item.size]
            .filter((part) => part)
            .map((part) => ` · ${part}`)
            .join("")}
          {children}
        </span>
      </span>
    </span>
  )
}

/// The totals in a box at the right, as on a PO's count.
function Totals({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <div className="flex justify-end">
      <dl className="grid w-full grid-cols-[1fr_auto] gap-x-12 rounded-card border border-hairline bg-soft px-5 py-2 tabular-nums md:w-auto md:min-w-[22rem]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="flex min-h-10 items-center text-ink">{label}</dt>
            <dd className="flex min-h-10 items-center justify-end font-semibold text-ink">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
