import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Check } from "lucide-react"
import { useRef, useState } from "react"

import { useShopName } from "@/components/operations/outbound-papers"
import { Button } from "@/components/ui/button"
import { ScanField } from "@/components/ui/scan-field"
import { Sheet } from "@/components/ui/sheet"
import { Problem } from "@/components/ui/states"
import { Thumbnail } from "@/components/ui/thumbnail"
import { dc } from "@/lib/api"
import { useColourwayFill } from "@/lib/colourway-fill"
import { useEdgeActor } from "@/lib/edge-session"
import { useLayout } from "@/lib/layout"
import { count, quantity, sku as skuNumber } from "@/lib/format"
import type { ArticlePick } from "@/lib/operations/article-picks"
import { divisionName, useCatalogueIdentity } from "@/lib/operations/catalogue"
import { keys } from "@/lib/operations/keys"
import { toast } from "@/lib/toast"
import { idempotencyKey } from "@itulah/contract/client"

/// **Scan a tag, see what every store wants of it** (owner, 23 Oct 2026:
/// "scan barang a, lalu si ops nya bisa tau ini di pick berapa harusnya").
///
/// The barcode on a tag is the SKU code, so a scan names one colour · size of
/// one article. The sheet it opens is the whole article across every store
/// still waiting on it: colour · size, then each store with its pieces and a
/// Pick. Pick takes that store's full quantity and turns into Picked ·
/// Unpick, as on a picklist; Done sends what is Picked on to Picked, one
/// round per allotment × store. Nothing is reported short from here — what
/// is not Picked stays on its picklist.
export function ScanPick({
  picks,
  source,
  canAccept,
}: {
  picks: readonly ArticlePick[]
  source: string | null
  canAccept: boolean
}) {
  const catalogue = useCatalogueIdentity()
  // A phone's own keyboard would open over the list on arrival.
  const phone = useLayout() === "phone"
  const [problem, setProblem] = useState<string | null>(null)
  const [scanned, setScanned] = useState<{
    article: string
    sku: string | null
  } | null>(null)

  function onScan(raw: string) {
    // A typed 8·3 code, or one with its zeros dropped, is still the code.
    const digits = raw.replace(/[·.\s-]/g, "")
    const asSku = /^\d+$/.test(digits) ? digits.padStart(11, "0") : digits
    const bySku = picks.find((pick) =>
      pick.lines.some((line) => line.sku_code === asSku)
    )
    if (bySku) {
      setProblem(null)
      setScanned({ article: bySku.article_code, sku: asSku })
      return
    }
    const code = raw.trim().toUpperCase()
    const byArticle = picks.find(
      (pick) => pick.article_code.toUpperCase() === code
    )
    if (byArticle) {
      setProblem(null)
      setScanned({ article: byArticle.article_code, sku: null })
      return
    }
    const known = catalogue.get(asSku)
    setProblem(
      known
        ? `${known.article_name} · ${skuNumber(asSku)} is not on any picklist`
        : `${raw} is not a known tag`
    )
  }

  const mine = scanned
    ? picks.filter((pick) => pick.article_code === scanned.article)
    : []

  return (
    <>
      <ScanField
        action="Scan"
        placeholder="Scan a tag"
        autoFocus={!phone}
        className="border-b border-hairline"
        problem={problem}
        onSubmit={onScan}
      />
      <ScanSheet
        picks={mine}
        first={scanned?.sku ?? null}
        source={source}
        canAccept={canAccept}
        onClose={() => setScanned(null)}
      />
    </>
  )
}

/// One store's want of one SKU: the row a Pick stands on.
type Want = {
  readonly key: string
  readonly pick: ArticlePick
  readonly sku: string
  readonly pieces: number
}

function ScanSheet({
  picks,
  first,
  source,
  canAccept,
  onClose,
}: {
  picks: readonly ArticlePick[]
  /// The SKU that was scanned: its colour · size stands first.
  first: string | null
  source: string | null
  canAccept: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const actor = useEdgeActor()
  const shopName = useShopName()
  const catalogue = useCatalogueIdentity()
  const fill = useColourwayFill()
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  /// One key per round, kept while the same picks are retried, so a Done
  /// that failed half-way does not take the stock off the rack twice.
  const rounds = useRef(new Map<string, string>())

  const open = picks.length > 0
  const head = picks[0]
  const identity = catalogue.get(head?.lines[0]?.sku_code ?? "")

  // Colour · size, then the stores that want it.
  const bySku = new Map<string, Want[]>()
  for (const pick of picks)
    for (const line of pick.lines) {
      if (line.outstanding <= 0) continue
      const list = bySku.get(line.sku_code) ?? []
      list.push({
        key: `${pick.allotment_id}~${pick.destination_id}~${line.sku_code}`,
        pick,
        sku: line.sku_code,
        pieces: line.outstanding,
      })
      bySku.set(line.sku_code, list)
    }
  const skus = [...bySku.keys()].sort((left, right) =>
    left === first ? -1 : right === first ? 1 : left.localeCompare(right)
  )
  const wants = skus.flatMap((code) => bySku.get(code) ?? [])
  const want = wants.reduce((sum, one) => sum + one.pieces, 0)
  const chosen = wants.filter((one) => picked.has(one.key))
  const got = chosen.reduce((sum, one) => sum + one.pieces, 0)

  function close() {
    setPicked(new Set())
    rounds.current.clear()
    onClose()
  }

  const done = useMutation({
    mutationFn: async () => {
      // One round per allotment × store, as a picklist's Done sends it.
      const groups = new Map<string, { pick: ArticlePick; lines: Want[] }>()
      for (const one of chosen) {
        const id = `${one.pick.allotment_id}~${one.pick.destination_id}`
        const group = groups.get(id) ?? { pick: one.pick, lines: [] }
        group.lines.push(one)
        groups.set(id, group)
      }
      let refused = 0
      for (const [id, group] of groups) {
        const lines = group.lines.map((one) => ({
          sku_code: one.sku,
          quantity: one.pieces,
        }))
        const signature = JSON.stringify([id, source, lines])
        const key = rounds.current.get(signature) ?? idempotencyKey()
        rounds.current.set(signature, key)
        const result = await dc.createPicklist({
          source_pool_id: source!,
          lines,
          actor_id: actor,
          note: null,
          idempotency_key: key,
          destination_id: group.pick.destination_id,
          allotment_id: group.pick.allotment_id,
        })
        refused += result.refused.reduce((sum, line) => sum + line.quantity, 0)
      }
      return refused
    },
    onSuccess: (refused) => {
      void client.invalidateQueries({ queryKey: keys.picklists() })
      void client.invalidateQueries({ queryKey: keys.picklistsToPick() })
      void client.invalidateQueries({ queryKey: keys.pools() })
      if (refused > 0)
        toast.warning(`${quantity(refused)} not on the rack`, {
          description: "still on the picklist",
        })
      else toast.success(`${quantity(got)} picked`, { description: "now in Picked" })
      close()
    },
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      title={
        head ? `Pick · ${head.article_name ?? head.article_code}` : "Pick"
      }
      footer={
        <div className="flex items-center justify-end gap-3">
          <Button
            variant="ghost"
            disabled={got > 0 && (!canAccept || source === null)}
            pending={done.isPending}
            onClick={() => (got > 0 ? done.mutate() : close())}
          >
            {done.isPending
              ? "Submitting…"
              : got > 0
                ? `Done · ${quantity(got)}`
                : "Done"}
          </Button>
        </div>
      }
    >
      {head && (
        <div className="flex flex-col">
          <div className="flex items-center gap-3">
            <Thumbnail
              url={identity?.image_url ?? null}
              name={identity?.article_name ?? ""}
              division={identity?.division_code}
              colours={fill(identity?.colour ?? null)}
              className="size-[2.875rem] shrink-0 rounded-[9px]"
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-semibold text-ink">
                {head.article_name ?? head.article_code}
              </span>
              <span className="text-body">
                {head.article_code}
                {identity?.division_code && (
                  <> · {divisionName(identity.division_code)}</>
                )}
              </span>
            </div>
            <div className="shrink-0 text-[1.5rem] leading-[1.4] font-bold text-ink tabular-nums">
              {count(want)}
              <span className="text-[1.0625rem] font-medium text-body">
                {" "}
                {want === 1 ? "pc" : "pcs"}
              </span>
            </div>
          </div>

          {skus.map((code) => {
            const one = catalogue.get(code)
            const name =
              [one?.colour, one?.size].filter(Boolean).join(" · ") ||
              skuNumber(code)
            const rows = bySku.get(code) ?? []
            const total = rows.reduce((sum, row) => sum + row.pieces, 0)
            return (
              <section key={code} className="mt-6 flex flex-col">
                <div className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">
                      {name}
                    </span>
                    <span className="block text-body tabular-nums">
                      {skuNumber(code)}
                    </span>
                  </span>
                  <span className="shrink-0 text-body tabular-nums">
                    {count(total)}
                  </span>
                </div>
                {rows.map((row) => (
                  <div
                    key={row.key}
                    className="border-row-line flex min-h-16 items-center gap-3 border-t"
                  >
                    <span className="min-w-0 flex-1 truncate text-ink">
                      {shopName(row.pick.destination_id)}
                    </span>
                    <span className="shrink-0 text-[1.0625rem] font-semibold text-ink tabular-nums">
                      {count(row.pieces)}
                    </span>
                    {picked.has(row.key) ? (
                      <span className="flex w-[9.5rem] items-center justify-end gap-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 font-semibold text-ok-fg">
                          <Check className="size-4" aria-hidden />
                          Picked
                        </span>
                        <button
                          type="button"
                          disabled={done.isPending}
                          onClick={() =>
                            setPicked((now) => {
                              const next = new Set(now)
                              next.delete(row.key)
                              return next
                            })
                          }
                          className="font-semibold text-bad-fg hover:underline disabled:opacity-50"
                        >
                          Unpick
                        </button>
                      </span>
                    ) : (
                      <span className="flex w-[9.5rem] justify-end">
                        <Button
                          variant="primary"
                          size="card"
                          disabled={done.isPending}
                          onClick={() =>
                            setPicked((now) => new Set(now).add(row.key))
                          }
                        >
                          Pick
                        </Button>
                      </span>
                    )}
                  </div>
                ))}
              </section>
            )
          })}

          <Problem error={done.error} />
        </div>
      )}
    </Sheet>
  )
}
