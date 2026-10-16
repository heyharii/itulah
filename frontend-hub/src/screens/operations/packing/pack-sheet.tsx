import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { ChevronDown, Plus, Undo2 } from "lucide-react"
import { useEffect, useId, useState } from "react"

import { useShopName } from "@/components/operations/outbound-papers"
import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { Thumbnail } from "@/components/ui/thumbnail"
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Problem,
} from "@/components/ui/states"
import { dc } from "@/lib/api"
import { count, quantity } from "@/lib/format"
import { useColourwayFill } from "@/lib/colourway-fill"
import { divisionName, useCatalogue } from "@/lib/operations/catalogue"
import { keys } from "@/lib/operations/keys"
import { loadPrinter } from "@/lib/operations/printer"
import {
  dcChangesQuery,
  koliManifestQuery,
  koliQuery,
  picklistsToPickQuery,
} from "@/lib/operations/queries"
import { useSeenOnOpen } from "@/lib/operations/acknowledge"
import { useEdgeActor } from "@/lib/edge-session"
import { useSheet } from "@/lib/sheets"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { ArticleSheet } from "@/screens/master/detail"
import { MoveBackDialog } from "@/screens/operations/board/move-back"
import { ArticlePhotos } from "@/screens/operations/board/photos"
import { Stepper } from "@/screens/operations/picking/pick-lines"
import type { MoveBackTarget } from "@/screens/operations/board/owed"
import { idempotencyKey } from "@itulah/contract/client"

/// **Pack: the store's picked pile goes into koli the packer adds by hand.**
///
/// Owner, 12 Oct 2026: koli differ in size, so the app never splits the pile
/// by capacity. The sheet opens with Koli 1 holding everything; **Add koli**
/// opens an empty one and makes it the one being filled; a row in any other
/// koli moves whole with **→ Koli N**, and the stepper in the koli being
/// filled keeps part of a row — the rest waits under **Not in a koli**. Each
/// koli is packed on its own (**Pack koli N**, the label prints); the others
/// stay open, even after the sheet is closed, like boxes left on the table.

interface DraftKoli {
  readonly no: number
  /// Pieces in this koli, by SKU code.
  items: Record<string, number>
}
interface Draft {
  koli: DraftKoli[]
  active: number | null
}

/// The open koli of every store, kept while the hub is open and in this
/// browser's storage, so a reload leaves them where they are. An entry goes
/// once the store has nothing left to pack.
const drafts = new Map<string, Draft>()
const draftKey = (shopId: string) => `central.pack-draft.${shopId}`

function readDraft(shopId: string): Draft | undefined {
  const held = drafts.get(shopId)
  if (held !== undefined) return held
  try {
    const text = window.localStorage.getItem(draftKey(shopId))
    if (text === null) return undefined
    const parsed = JSON.parse(text) as Draft
    if (!Array.isArray(parsed.koli)) return undefined
    drafts.set(shopId, parsed)
    return parsed
  } catch {
    return undefined
  }
}

function writeDraft(shopId: string, draft: Draft) {
  drafts.set(shopId, draft)
  try {
    if (draft.koli.length === 0)
      window.localStorage.removeItem(draftKey(shopId))
    else window.localStorage.setItem(draftKey(shopId), JSON.stringify(draft))
  } catch {
    // Storage is a convenience; the draft still lives in memory.
  }
}

const sumOf = (values: Iterable<number>) => {
  let total = 0
  for (const value of values) total += value
  return total
}
const koliPieces = (koli: DraftKoli) => sumOf(Object.values(koli.items))

/// The draft, fitted to what is actually left: pieces that left the pile
/// (put back, MD, packed elsewhere) come out of the newest koli first.
function fitted(draft: Draft, left: ReadonlyMap<string, number>): Draft {
  const koli = draft.koli.map((one) => ({
    no: one.no,
    items: { ...one.items },
  }))
  for (const one of koli)
    for (const sku of Object.keys(one.items))
      if (!left.has(sku) || !one.items[sku]) delete one.items[sku]
  for (const [sku, n] of left) {
    let have = sumOf(koli.map((one) => one.items[sku] ?? 0))
    for (let i = koli.length - 1; i >= 0 && have > n; i--) {
      const one = koli[i]!
      const take = Math.min(one.items[sku] ?? 0, have - n)
      one.items[sku] = (one.items[sku] ?? 0) - take
      have -= take
      if (!one.items[sku]) delete one.items[sku]
    }
  }
  if (left.size === 0) return { koli: [], active: null }
  const active = koli.some((one) => one.no === draft.active)
    ? draft.active
    : (koli.at(-1)?.no ?? null)
  return { koli, active }
}

export function PackSheet({
  shopId,
  onClose,
}: {
  shopId: string | null
  onClose: () => void
}) {
  const actor = useEdgeActor()
  const shopName = useShopName()
  const client = useQueryClient()
  const opened = useSheet("koli")
  const { identities: catalogue } = useCatalogue()
  const fill = useColourwayFill()
  const [moving, setMoving] = useState<MoveBackTarget | null>(null)
  /// The article master sheet, without stock (owner, 16 Oct 2026).
  const [article, setArticle] = useState<string | null>(null)
  /// Which packed koli are unfolded; all folded by default.
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set())
  /// Bumped whenever the module-level draft changes, so the sheet redraws.
  const [, setVersion] = useState(0)

  const picklists = useQuery({
    queryKey: keys.picklists(),
    queryFn: ({ signal }) => dc.picklists(signal),
    enabled: shopId !== null,
  })
  const koliList = useQuery({ ...koliQuery(), enabled: shopId !== null })
  // Opening the store's pack is seeing what MD changed for it (no "Got it").
  // A change whose picklist is still to pick sits on that Pick card instead.
  const changes = useQuery({ ...dcChangesQuery(), enabled: shopId !== null })
  const toPick = useQuery({
    ...picklistsToPickQuery(),
    enabled: shopId !== null,
  })
  useSeenOnOpen(
    (changes.data ?? []).filter(
      (one) =>
        one.destination_id === shopId &&
        !(toPick.data ?? []).some(
          (pick) =>
            pick.allotment_id === one.allotment_id &&
            pick.destination_id === one.destination_id
        )
    ),
    shopId !== null && toPick.data !== undefined
  )

  const shopRounds = (picklists.data ?? []).filter(
    (round) => round.destination_id === shopId && round.waiting > 0
  )
  const sessionQueries = useQueries({
    queries: shopRounds.map((round) => ({
      queryKey: keys.pickRound(round.session.session_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        dc.pickSession(round.session.session_id, signal),
      enabled: shopId !== null,
    })),
  })
  const sessionsLoaded = sessionQueries.every((one) => one.data !== undefined)

  /// What is left to pack, by SKU, over every picklist this store has
  /// waiting — the picked pile on the table.
  const left = new Map<string, number>()
  for (const query of sessionQueries)
    for (const line of query.data?.lines ?? [])
      if (line.waiting > 0)
        left.set(line.sku_code, (left.get(line.sku_code) ?? 0) + line.waiting)

  /// Koli already packed for this store and not yet on a trip, oldest first —
  /// numbered from 1 as the board numbers them.
  const packed = (koliList.data ?? [])
    .filter(
      (one) =>
        one.destination_store_id === shopId &&
        one.sealed_at !== null &&
        (one.position === "PACKED" || one.position === "SHIPMENT")
    )
    .sort((a, b) => (a.sealed_at ?? "").localeCompare(b.sealed_at ?? ""))
  const manifests = useQueries({
    queries: packed.map((one) => ({
      ...koliManifestQuery(one.koli_id),
      staleTime: 60_000,
    })),
  })

  const ready = shopId !== null && sessionsLoaded && koliList.data !== undefined
  let draft: Draft =
    shopId === null
      ? { koli: [], active: null }
      : fitted(readDraft(shopId) ?? { koli: [], active: null }, left)
  const nextNo = () =>
    Math.max(packed.length, ...draft.koli.map((one) => one.no)) + 1
  /// The number a koli still open SHOWS: after every koli already packed for
  /// this store, in the order they were added (`no` is only its identity).
  const shownNo = (no: number) =>
    packed.length + draft.koli.findIndex((one) => one.no === no) + 1
  const pileOf = (d: Draft) =>
    [...left]
      .map(([sku, n]) => ({
        sku,
        n: n - sumOf(d.koli.map((one) => one.items[sku] ?? 0)),
      }))
      .filter((one) => one.n > 0)

  const save = (next: Draft) => {
    if (shopId === null) return
    writeDraft(shopId, next)
    setVersion((v) => v + 1)
  }

  // Opening Pack with no koli open: Koli N starts with everything left — one
  // koli is the usual case. Once per opening, not after every koli packed.
  const [openedFor, setOpenedFor] = useState<string | null>(null)
  if (shopId === null && openedFor !== null) setOpenedFor(null)
  if (ready && shopId !== null && openedFor !== shopId) {
    setOpenedFor(shopId)
    if (draft.koli.length === 0 && left.size > 0) {
      const no = packed.length + 1
      draft = { koli: [{ no, items: Object.fromEntries(left) }], active: no }
    }
    writeDraft(shopId, draft)
  }

  const pile = pileOf(draft)
  const pilePieces = sumOf(pile.map((one) => one.n))
  const active = draft.koli.find((one) => one.no === draft.active) ?? null
  const leftPieces = sumOf(left.values())

  const addKoli = () => {
    const no = nextNo()
    save({ koli: [...draft.koli, { no, items: {} }], active: no })
  }
  const pickKoli = (no: number) => save({ ...draft, active: no })
  const removeKoli = (no: number) => {
    const koli = draft.koli.filter((one) => one.no !== no)
    save({
      koli,
      active: draft.active === no ? (koli.at(-1)?.no ?? null) : draft.active,
    })
  }
  const allToActive = () => {
    if (active === null) return
    const koli = draft.koli.map((one) => ({
      no: one.no,
      items: { ...one.items },
    }))
    const to = koli.find((one) => one.no === active.no)!
    for (const one of pile) to.items[one.sku] = (to.items[one.sku] ?? 0) + one.n
    save({ koli, active: draft.active })
  }
  const setInActive = (sku: string, qty: number) => {
    if (active === null) return
    const koli = draft.koli.map((one) =>
      one.no === active.no
        ? {
            no: one.no,
            items: Object.fromEntries(
              Object.entries({ ...one.items, [sku]: qty }).filter(
                ([, n]) => n > 0
              )
            ),
          }
        : one
    )
    save({ koli, active: draft.active })
  }

  const printSticker = useMutation({
    mutationFn: (koliId: string) => {
      const printer = loadPrinter()
      return dc.printKoliLabel(koliId, {
        printer_host: printer.host,
        printer_port: printer.port,
        label_width_mm: printer.widthMm,
        label_height_mm: printer.heightMm,
      })
    },
  })

  const pack = useMutation({
    mutationFn: (koli: DraftKoli) => {
      if (shopId === null) throw new Error("No store chosen.")
      return dc.pack({
        destination_store_id: shopId,
        lines: Object.entries(koli.items)
          .map(([sku_code, qty]) => ({
            sku_code,
            quantity: Math.min(qty, left.get(sku_code) ?? 0),
          }))
          .filter((line) => line.quantity > 0),
        actor_id: actor,
        // One koli, one seal. Applied twice the second attempt would pack a
        // second koli from the same picklists.
        idempotency_key: idempotencyKey(),
        seal: true,
        pick_session_ids: shopRounds.map((round) => round.session.session_id),
      })
    },
    onSuccess: (manifest, koli) => {
      const rest = draft.koli.filter((one) => one.no !== koli.no)
      save({
        koli: rest,
        active:
          draft.active === koli.no ? (rest.at(-1)?.no ?? null) : draft.active,
      })
      if (manifest.koli.koli_id) printSticker.mutate(manifest.koli.koli_id)
      toast(
        `Koli ${packed.length + 1} packed · ${quantity(manifest.koli.unit_count)} · label printing`
      )
      void client.invalidateQueries({ queryKey: ["dc", "koli"] })
      void client.invalidateQueries({ queryKey: keys.picklists() })
      void client.invalidateQueries({ queryKey: ["dc", "pick-session"] })
      void client.invalidateQueries({ queryKey: keys.pools() })
    },
  })

  // A refusal from the last store must not still be sitting under this one.
  useEffect(() => {
    if (shopId !== null) pack.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId])

  const nameOf = (sku: string) => {
    const identity = catalogue.get(sku)
    return {
      article: identity?.article_name ?? sku,
      code: identity?.article_code ?? "",
      variant:
        [identity?.colour, identity?.size].filter(Boolean).join(" · ") || sku,
    }
  }

  /// One koli's (or the pile's) rows, grouped by article.
  const rows = (
    entries: readonly (readonly [string, number])[],
    _from: number | "pile",
    filling: boolean
  ) => {
    const byArticle = new Map<string, (readonly [string, number])[]>()
    for (const entry of [...entries].sort((a, b) => a[0].localeCompare(b[0]))) {
      const key = catalogue.get(entry[0])?.article_code ?? entry[0]
      byArticle.set(key, [...(byArticle.get(key) ?? []), entry])
    }
    // Laid out as the Pick sheet is (owner, 16 Oct 2026): the article with
    // its photo, then a block per colour, Size beside the same stepper.
    return (
      <div className="flex flex-col gap-5">
        {[...byArticle.values()].map((list) => {
          const head = nameOf(list[0]![0])
          const identity = catalogue.get(list[0]![0])
          const colours = new Map<string, (readonly [string, number])[]>()
          for (const entry of list) {
            const colour = catalogue.get(entry[0])?.colour ?? "—"
            colours.set(colour, [...(colours.get(colour) ?? []), entry])
          }
          return (
            <div key={`${list[0]![0]}-article`} className="flex flex-col gap-3">
              <div className="flex items-center gap-3.5">
                <ArticlePhotos skus={list.map(([sku]) => sku)} className="" />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <button
                    type="button"
                    disabled={head.code === ""}
                    onClick={() => setArticle(head.code)}
                    className="w-fit max-w-full text-left text-[1.0625rem] leading-[1.375rem] font-semibold text-ink hover:underline"
                  >
                    {head.article}
                  </button>
                  <div className="text-[0.9375rem] text-body">
                    <span className="font-mono">{head.code}</span>
                    {identity?.division_code && (
                      <> · {divisionName(identity.division_code)}</>
                    )}
                  </div>
                </div>
              </div>
              {/* One row per colour · size (owner, 16 Oct 2026: "Black · M",
              "White · M", "White · L" — no colour blocks, no table head). */}
              <div className="flex flex-col">
                {[...colours].flatMap(([colour, lines]) =>
                  lines.map(([sku, n]) => {
                    const name = nameOf(sku)
                    const free = pile.find((one) => one.sku === sku)?.n ?? 0
                    return (
                      <div
                        key={sku}
                        className="flex items-center gap-3 border-t border-hairline py-2.5"
                      >
                        <span
                          aria-hidden
                          className="size-3 shrink-0 rounded-full border border-hairline"
                          style={{
                            background: fill(colour === "—" ? null : colour)[0],
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-[0.9375rem] font-medium text-ink">
                            {name.variant}
                          </div>
                          <div className="font-mono text-[0.9375rem] break-all text-mute">
                            {sku}
                          </div>
                        </div>
                        {filling ? (
                          <Stepper
                            name="In koli"
                            warnUnder={false}
                            label={`${name.article} · ${name.variant}`}
                            value={n}
                            max={n + free}
                            onChange={(qty) => setInActive(sku, qty)}
                          />
                        ) : (
                          // A koli not being filled only reads: pick it to
                          // change it.
                          <b className="font-semibold text-ink tabular-nums">
                            {count(n)}
                          </b>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const putBack = (
    <Button
      variant="danger"
      onClick={() =>
        shopId !== null && setMoving({ from: "picked", destinationId: shopId })
      }
    >
      <Undo2 />
      Put back
    </Button>
  )

  const packedPieces = sumOf(packed.map((one) => one.unit_count))
  let footer: React.ReactNode = undefined
  if (shopId !== null && ready) {
    if (active)
      footer = (
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-auto text-[0.9375rem] text-mute">
            {pilePieces > 0 ? `${quantity(pilePieces)} not in a koli` : ""}
          </span>
          {putBack}
          <Button
            variant="primary"
            disabled={koliPieces(active) === 0}
            pending={pack.isPending}
            onClick={() => pack.mutate(active)}
          >
            {/* Packs and seals the koli being filled. */}
            {pack.isPending ? "Submitting…" : "Submit"}
          </Button>
        </div>
      )
    else if (leftPieces > 0)
      footer = (
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-auto" />
          {putBack}
          <Button variant="primary" onClick={addKoli}>
            Add koli
          </Button>
        </div>
      )
    else
      footer = (
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-auto text-[0.9375rem] text-mute">
            {packed.length > 0
              ? `${count(packed.length)} koli · ${quantity(packedPieces)}`
              : ""}
          </span>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      )
  }

  return (
    <Sheet
      open={shopId !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      width="table"
      title={shopId ? `Pack · ${shopName(shopId)}` : "Pack"}
      footer={footer}
    >
      {shopId === null ? null : picklists.isPending ? (
        <LoadingState>Reading the picklists…</LoadingState>
      ) : picklists.isError ? (
        <ErrorState
          error={picklists.error}
          onRetry={() => picklists.refetch()}
        />
      ) : !ready ? (
        <LoadingState>Reading what is picked…</LoadingState>
      ) : (
        <div className="flex flex-col gap-3">
          {pile.length > 0 && (
            <div className="rounded-card border border-dashed border-hairline-2 bg-soft-2 px-3.5 pt-3 pb-1">
              <div className="mb-2 flex flex-wrap items-center gap-2.5">
                <b className="text-[0.9375rem] font-semibold text-ink">
                  Not in a koli
                </b>
                <span className="text-[0.9375rem] text-mute tabular-nums">
                  {quantity(pilePieces)}
                </span>
                <span className="flex-1" />
                {active && (
                  <Button variant="tint" size="sm" onClick={allToActive}>
                    All to koli {shownNo(active.no)}
                  </Button>
                )}
              </div>
              {rows(
                pile.map((one) => [one.sku, one.n] as const),
                "pile",
                false
              )}
            </div>
          )}

          {draft.koli.map((koli) => {
            const on = koli.no === active?.no
            const pieces = koliPieces(koli)
            const entries = Object.entries(koli.items).filter(([, n]) => n > 0)
            return (
              <div
                key={koli.no}
                className={cn(
                  "rounded-card px-3.5 pt-3 pb-1 transition-colors duration-150",
                  on ? "border-[1.5px] border-accent" : "border border-hairline"
                )}
              >
                <div
                  className={cn(
                    "mb-2 flex flex-wrap items-center gap-2.5",
                    !on && "-mx-3.5 -mt-3 cursor-pointer px-3.5 pt-3"
                  )}
                  {...(on
                    ? {}
                    : {
                        role: "button",
                        tabIndex: 0,
                        onClick: () => pickKoli(koli.no),
                        onKeyDown: (event: React.KeyboardEvent) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            pickKoli(koli.no)
                          }
                        },
                      })}
                >
                  <i
                    aria-hidden="true"
                    className={cn(
                      "grid size-[18px] place-items-center rounded-full border-[1.5px]",
                      on ? "border-accent" : "border-hairline-2"
                    )}
                  >
                    {on && <span className="size-2 rounded-full bg-accent" />}
                  </i>
                  <b className="text-[0.9375rem] font-semibold text-ink">
                    Koli {shownNo(koli.no)}
                  </b>
                  <span className="text-[0.9375rem] text-mute tabular-nums">
                    {quantity(pieces)}
                  </span>
                  <span className="flex-1" />
                  {pieces === 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation()
                        removeKoli(koli.no)
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </div>
                {entries.length > 0 && rows(entries, koli.no, on)}
              </div>
            )
          })}

          {leftPieces > 0 && (
            <button
              type="button"
              onClick={addKoli}
              className="flex h-12 items-center justify-center gap-1.5 rounded-card border-[1.5px] border-dashed border-hairline-2 bg-canvas text-[0.9375rem] font-medium text-accent transition-[background-color,transform] duration-150 hover:bg-accent-bg active:scale-[0.98] [&_svg]:size-4"
            >
              <Plus />
              Add koli
            </button>
          )}

          {packed.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              <div className="text-[0.9375rem] text-mute">
                Packed · {count(packed.length)} koli
              </div>
              {packed.map((one, index) => (
                <PackedKoliFold
                  key={one.koli_id}
                  number={one.koli_number}
                  no={index + 1}
                  pieces={one.unit_count}
                  lines={manifests[index]?.data?.lines ?? []}
                  open={unfolded.has(one.koli_id)}
                  onFold={() =>
                    setUnfolded((held) => {
                      const next = new Set(held)
                      if (!next.delete(one.koli_id)) next.add(one.koli_id)
                      return next
                    })
                  }
                  onOpenKoli={() => opened.open(one.koli_id)}
                  onArticle={setArticle}
                />
              ))}
            </div>
          )}

          {leftPieces === 0 && packed.length === 0 && (
            <EmptyState>Nothing left to pack for this store.</EmptyState>
          )}

          <Problem error={pack.error} />
          <MoveBackDialog target={moving} onClose={() => setMoving(null)} />
          <ArticleSheet
            articleCode={article}
            open={article !== null}
            onClose={() => setArticle(null)}
            stock={false}
            readOnly
          />
        </div>
      )}
    </Sheet>
  )
}

/// One packed koli as a fold card, the way New allotment folds a supplier
/// (`SupplierFold`): the heading folds it, and inside each article is a row
/// card (`ArticleChoice`) that opens the article's master sheet.
function PackedKoliFold({
  no,
  number,
  pieces,
  lines,
  open,
  onFold,
  onOpenKoli,
  onArticle,
}: {
  no: number
  number: string
  pieces: number
  lines: readonly { sku_code: string; quantity: number }[]
  open: boolean
  onFold: () => void
  onOpenKoli: () => void
  onArticle: (code: string) => void
}) {
  const body = useId()
  const { identities: catalogue } = useCatalogue()
  const fill = useColourwayFill()

  // Article → colour → size × pieces, in the order the manifest names them.
  const articles = new Map<
    string,
    {
      name: string
      first: string
      pieces: number
      colours: Map<string, Map<string, number>>
    }
  >()
  for (const line of lines) {
    const identity = catalogue.get(line.sku_code)
    const code = identity?.article_code ?? line.sku_code
    const one = articles.get(code) ?? {
      name: identity?.article_name ?? line.sku_code,
      first: line.sku_code,
      pieces: 0,
      colours: new Map<string, Map<string, number>>(),
    }
    one.pieces += line.quantity
    const sizes = one.colours.get(identity?.colour ?? "") ?? new Map()
    const size = identity?.size ?? "—"
    sizes.set(size, (sizes.get(size) ?? 0) + line.quantity)
    one.colours.set(identity?.colour ?? "", sizes)
    articles.set(code, one)
  }

  return (
    <section
      aria-label={`Koli ${no}`}
      className="rounded-[0.625rem] border border-hairline bg-canvas"
    >
      <button
        type="button"
        onClick={onFold}
        aria-expanded={open}
        aria-controls={body}
        className="flex min-h-14 w-full min-w-0 items-center gap-3 rounded-[0.625rem] px-4 py-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40 [@media(hover:hover)]:hover:bg-soft"
      >
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-mute transition-transform duration-200 ease-out",
            !open && "-rotate-90"
          )}
        />
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5">
          <b className="text-[1.0625rem] font-semibold text-ink">Koli {no}</b>
          <span className="font-mono text-[0.9375rem] break-all text-mute">
            {number}
          </span>
        </span>
        <span className="text-right text-[0.9375rem] text-mute tabular-nums">
          {articles.size > 0 && (
            <>
              {count(articles.size)}{" "}
              {articles.size === 1 ? "article" : "articles"} ·{" "}
            </>
          )}
          {quantity(pieces)}
        </span>
      </button>
      <div
        id={body}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-2 px-4 pb-4">
            {[...articles].map(([code, one]) => {
              const identity = catalogue.get(one.first)
              const colours = [...one.colours]
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => onArticle(code)}
                  className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[0.625rem] border border-hairline bg-canvas px-3 py-3 text-left transition-[background-color,transform] duration-150 ease-out active:scale-[0.99] [@media(hover:hover)]:hover:bg-soft"
                >
                  <Thumbnail
                    url={identity?.image_url ?? null}
                    name={one.name}
                    division={identity?.division_code}
                    colours={fill(colours[0]?.[0] || null)}
                    className="size-12 shrink-0 rounded-[0.5rem] border border-hairline"
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[0.9375rem] font-medium break-words text-ink">
                      {one.name}
                    </span>
                    <span className="font-mono text-[0.9375rem] text-mute">
                      {code}
                    </span>
                    <span className="text-[0.9375rem] text-body">
                      {colours.map(([colour, sizes]) => {
                        const hex = fill(colour || null)[0]
                        return (
                          <span key={colour} className="mr-2.5 inline-block">
                            {colour !== "" && (
                              <span
                                aria-hidden
                                className="mr-1.5 inline-block size-2.5 rounded-full border border-hairline-strong align-[0.05em]"
                                style={
                                  hex ? { backgroundColor: hex } : undefined
                                }
                              />
                            )}
                            {colour !== "" && `${colour} · `}
                            {[...sizes]
                              .map(([size, n]) => `${size} ${count(n)}`)
                              .join(" · ")}
                          </span>
                        )
                      })}
                    </span>
                  </span>
                  <b className="text-[0.9375rem] font-semibold whitespace-nowrap text-ink tabular-nums">
                    {quantity(one.pieces)}
                  </b>
                </button>
              )
            })}
            <Button
              variant="tint"
              size="sm"
              className="self-start"
              onClick={onOpenKoli}
            >
              Open koli
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
