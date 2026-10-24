import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Check, ChevronDown, Download, Printer } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import {
  DEFAULT_PACKING_PAPER,
  PackingListPrint,
  useShopName,
} from "@/components/operations/outbound-papers"
import { Button } from "@/components/ui/button"
import { PhotoViewer } from "@/components/ui/photo-viewer"
import { Sheet } from "@/components/ui/sheet"
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Problem,
} from "@/components/ui/states"
import { Thumbnail } from "@/components/ui/thumbnail"
import { TintButton } from "@/components/ui/tint-button"
import { dc } from "@/lib/api"
import { useColourwayFill } from "@/lib/colourway-fill"
import { useEdgeActor } from "@/lib/edge-session"
import { count, quantity, sku as skuNumber } from "@/lib/format"
import { useCatalogue } from "@/lib/operations/catalogue"
import { moveBack } from "@/lib/operations/changes"
import { keys } from "@/lib/operations/keys"
import { loadPrinter } from "@/lib/operations/printer"
import {
  dcChangesQuery,
  koliManifestQuery,
  koliQuery,
  picklistsToPickQuery,
} from "@/lib/operations/queries"
import { useSeenOnOpen } from "@/lib/operations/acknowledge"
import { toast } from "@/lib/toast"
import { PrintMenu } from "@/screens/procurement/print-menu"
import type { Paper } from "@/screens/procurement/po-print"
import type { Koli } from "@itulah/contract"
import { idempotencyKey } from "@itulah/contract/client"

import { playFx, rowRect, type Fx } from "./pack-motion"
import {
  BackDialog,
  Everything,
  KoliChip,
  PutDialog,
  QuantityPad,
  SealTag,
  SkuRow,
  type SkuInfo,
} from "./pack-parts"
import { useTouchPad } from "./use-touch-pad"

/// **Pack: Picked, then every koli, one row per SKU.**
///
/// Owner, 18 Oct 2026 (pack-sheet-options.html, H · Ask only if 2 open): the
/// sheet opens on **Picked** — one row per SKU, its picture, "article ·
/// colour · size", the code, the quantity and a tinted **Put in**. With no
/// koli open the put makes Koli 1; with one it asks only how many; with two or
/// more it asks which koli first. A koli tab shows only what is in it, with
/// **Take out** and **+ Add to Koli N**, a layer over the sheet that holds the
/// picked rows.
///
/// There is no Submit. **Seal & print Koli N** seals that one koli (it prints
/// its label), switches to the sealed tab and opens the print dialog for its
/// packing list; **Back to Pick** moves pieces back to the racks at once; a
/// sealed koli can be **Unpacked**. **Done** closes the sheet and the koli
/// still open stay as saved drafts.
///
/// Koli differ in size (owner, 12 Oct 2026), so the app never splits the
/// pile by capacity: the packer adds koli by hand. Client rule (18 Oct 2026):
/// nothing here is a plain word — secondary actions are tinted, destructive
/// ones red-tinted, and exactly one is solid.

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
/// once no koli is open.
const drafts = new Map<string, Draft>()
const draftKey = (shopId: string) => `central.pack-draft.${shopId}`
const emptyDraft = (): Draft => ({ koli: [], active: null })

function readDraft(shopId: string): Draft | undefined {
  const held = drafts.get(shopId)
  if (held !== undefined) return held
  try {
    const text = window.localStorage.getItem(draftKey(shopId))
    if (text === null) return undefined
    const parsed = JSON.parse(text) as Draft
    if (!Array.isArray(parsed.koli)) return undefined
    // Drafts of the Submit days also held take-outs; they were never sent.
    const draft = { koli: parsed.koli, active: parsed.active ?? null }
    drafts.set(shopId, draft)
    return draft
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
const withoutZeros = (items: Record<string, number>) =>
  Object.fromEntries(Object.entries(items).filter(([, n]) => n > 0))

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
  const active = koli.some((one) => one.no === draft.active)
    ? draft.active
    : (koli.at(-1)?.no ?? null)
  return { koli, active }
}

/// What the sheet shows: the picked pile, a koli still open (its `no`), or a
/// koli already sealed (its id).
type View =
  | { readonly kind: "picked" }
  | { readonly kind: "open"; readonly no: number }
  | { readonly kind: "packed"; readonly id: string }
const PICKED: View = { kind: "picked" }

/// A put in progress: which SKUs, whether it is all of them, and where. `to`
/// is null while the koli is still to be chosen.
interface Put {
  readonly skus: readonly string[]
  readonly all: boolean
  readonly to: number | "new" | null
  /// The choice was not asked (0 or 1 koli open, or the layer): Back closes.
  readonly skipped: boolean
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
  const { identities: catalogue } = useCatalogue()
  const fill = useColourwayFill()
  const touch = useTouchPad()
  const [view, setView] = useState<View>(PICKED)
  /// Bumped whenever the module-level draft changes, so the sheet redraws.
  const [version, setVersion] = useState(0)
  const [put, setPut] = useState<Put | null>(null)
  const [take, setTake] = useState<{ no: number; sku: string } | null>(null)
  /// The koli (its `no`) whose "Add to" layer is up, and whether it still is:
  /// it stays in hand while it drops away.
  const [layer, setLayer] = useState<{ no: number; open: boolean } | null>(null)
  const [backOpen, setBackOpen] = useState(false)
  /// Pack on a row asks how many (owner, 23 Oct 2026 sketch: Pack → QTY pad).
  const [packAsk, setPackAsk] = useState<{ sku: string; max: number } | null>(
    null
  )
  /// Review packing is up: what goes in the koli, read back before Finish.
  const [reviewing, setReviewing] = useState(false)
  /// The articles opened by hand; `null` until one is touched, when only the
  /// first stands open (owner, 23 Oct 2026 sketch: Artikel A open, B shut).
  const [unfolded, setUnfolded] = useState<ReadonlySet<string> | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  /// The sealed koli whose packing list is being printed.
  const [printing, setPrinting] = useState<{
    id: string
    number: string
  } | null>(null)
  const [printAsk, setPrintAsk] = useState(false)
  const [printPaper, setPrintPaper] = useState(false)
  /// The koli sealed a moment ago, held until the reads catch up: it shows as
  /// sealed at once, and its pieces stay out of Picked (owner, 19 Oct 2026 —
  /// a packer must never see a sealed koli fall back into Picked).
  const [justSealed, setJustSealed] = useState<{
    koli: Koli
    at: number
    items: Map<string, number>
  } | null>(null)
  /// The paper the packing list goes on: A5 portrait until the packer picks
  /// another in the print sheet.
  const [paper, setPaper] = useState<Paper>(DEFAULT_PACKING_PAPER)
  /// What the last change asks to be drawn once the tiles are there.
  const fx = useRef<Fx>({})
  useEffect(() => {
    playFx(fx.current)
    fx.current = {}
  }, [version])

  // Every opening starts on Picked.
  const [openedFor, setOpenedFor] = useState<string | null>(null)
  if (openedFor !== shopId) {
    setOpenedFor(shopId)
    setView(PICKED)
    setPut(null)
    setTake(null)
    setLayer(null)
    setBackOpen(false)
    setJustSealed(null)
    setPackAsk(null)
    setReviewing(false)
    setUnfolded(null)
  }

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

  /// What is waiting to be packed, by SKU, over every picklist this store
  /// has waiting.
  const left = new Map<string, number>()
  for (const query of sessionQueries)
    for (const line of query.data?.lines ?? [])
      if (line.waiting > 0)
        left.set(line.sku_code, (left.get(line.sku_code) ?? 0) + line.waiting)
  // Until the picklists are read again, what the koli just sealed took is
  // still counted as waiting there: take it off here, once.
  if (
    justSealed !== null &&
    sessionQueries.every((query) => query.dataUpdatedAt < justSealed.at)
  )
    for (const [sku, n] of justSealed.items)
      left.set(sku, Math.max(0, (left.get(sku) ?? 0) - n))

  /// Koli already sealed for this store and not yet on a trip, oldest first —
  /// numbered from 1 as the board numbers them. The one sealed a moment ago
  /// stands in until the list is read again.
  const koliRows =
    justSealed !== null &&
    !(koliList.data ?? []).some(
      (one) => one.koli_id === justSealed.koli.koli_id
    )
      ? [...(koliList.data ?? []), justSealed.koli]
      : (koliList.data ?? [])
  const packed = koliRows
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
  /// A sealed koli's pieces, by SKU, as its manifest says.
  const contentsOf = (index: number) => {
    const held = new Map<string, number>()
    for (const line of manifests[index]?.data?.lines ?? [])
      held.set(line.sku_code, (held.get(line.sku_code) ?? 0) + line.quantity)
    return held
  }

  const ready = shopId !== null && sessionsLoaded && koliList.data !== undefined

  const stored =
    (shopId !== null ? readDraft(shopId) : undefined) ?? emptyDraft()
  const draft: Draft = ready ? fitted(stored, left) : emptyDraft()
  const nextNo = () =>
    Math.max(packed.length, ...draft.koli.map((one) => one.no)) + 1
  /// The number a koli still open SHOWS: after every koli already sealed for
  /// this store, in the order they were added (`no` is only its identity).
  const shownNo = (no: number) =>
    packed.length + draft.koli.findIndex((one) => one.no === no) + 1
  const freeOf = (sku: string) =>
    (left.get(sku) ?? 0) - sumOf(draft.koli.map((one) => one.items[sku] ?? 0))
  const pile = [...left.keys()]
    .map((sku) => ({ sku, n: freeOf(sku) }))
    .filter((one) => one.n > 0)
    .sort((a, b) => a.sku.localeCompare(b.sku))
  const pilePieces = sumOf(pile.map((one) => one.n))
  /// The number a koli added now would show.
  const newNo = packed.length + draft.koli.length + 1
  const withItems = draft.koli.filter((one) => koliPieces(one) > 0)
  const openPieces = sumOf(draft.koli.map(koliPieces))

  const save = (next: Draft) => {
    if (shopId === null) return
    writeDraft(shopId, next)
    setVersion((v) => v + 1)
  }

  // ── Words and pictures ───────────────────────────────────────────────────
  /// One picture per article for a SKU that has none of its own.
  const articlePhoto = useMemo(() => {
    const byArticle = new Map<string, string>()
    for (const one of catalogue.values())
      if (one.image_url && !byArticle.has(one.article_code))
        byArticle.set(one.article_code, one.image_url)
    return byArticle
  }, [catalogue])
  const info = (sku: string): SkuInfo => {
    const identity = catalogue.get(sku)
    const variant = [identity?.colour, identity?.size]
      .filter(Boolean)
      .join(" · ")
    return {
      title: [identity?.article_name ?? sku, variant]
        .filter(Boolean)
        .join(" · "),
      code: skuNumber(sku),
      url:
        identity?.image_url ??
        (identity ? (articlePhoto.get(identity.article_code) ?? null) : null),
      name: identity?.article_name ?? "",
      division: identity?.division_code ?? null,
      colours: fill(identity?.colour ?? null),
    }
  }

  // ── Putting in and taking out ────────────────────────────────────────────
  /// Pieces of each SKU into a koli (`"new"` opens one for them). Nothing
  /// moving, nothing made: an empty koli is never created here. When that
  /// empties Picked, the view follows the pieces into the koli — unless the
  /// layer is up, which stays until Done. `from` is where a "+N" flies from.
  const putTo = (
    target: number | "new",
    wanted: readonly (readonly [string, number])[],
    from: DOMRect | null = null
  ) => {
    const moving = wanted
      .map(([sku, n]) => [sku, Math.min(n, freeOf(sku))] as const)
      .filter(([, n]) => n > 0)
    if (moving.length === 0) return
    const koli = draft.koli.map((one) => ({
      no: one.no,
      items: { ...one.items },
    }))
    const existing =
      target === "new" ? undefined : koli.find((one) => one.no === target)
    let to = existing
    if (!to) {
      to = { no: nextNo(), items: {} }
      koli.push(to)
    }
    for (const [sku, n] of moving) to.items[sku] = (to.items[sku] ?? 0) + n
    const moved = sumOf(moving.map(([, n]) => n))
    const tile = `open-${to.no}`
    fx.current = {
      born: existing ? undefined : tile,
      hit: tile,
      fly: { from, text: `+${moved}`, to: tile },
    }
    save({ koli, active: to.no })
  }
  /// Starts a put. `target` is the koli the layer already named.
  const startPut = (skus: readonly string[], all: boolean, target?: number) => {
    const to: Put["to"] =
      target !== undefined
        ? target
        : draft.koli.length === 0
          ? "new"
          : draft.koli.length === 1
            ? draft.koli[0]!.no
            : null
    const next: Put = { skus, all, to, skipped: to !== null }
    if (all && to !== null)
      putTo(
        to,
        skus.map((sku) => [sku, freeOf(sku)]),
        rowRect(null)
      )
    else setPut(next)
  }
  const choose = (to: number | "new") => {
    if (put === null) return
    if (put.all) {
      putTo(
        to,
        put.skus.map((sku) => [sku, freeOf(sku)]),
        rowRect(null)
      )
      setPut(null)
    } else setPut({ ...put, to })
  }
  const takeOutOfOpen = (no: number, sku: string, n: number) => {
    const koli = draft.koli.map((one) =>
      one.no === no
        ? {
            no,
            items: withoutZeros({
              ...one.items,
              [sku]: (one.items[sku] ?? 0) - n,
            }),
          }
        : one
    )
    save({ ...draft, koli })
  }
  const removeKoli = (no: number) => {
    const koli = draft.koli.filter((one) => one.no !== no)
    save({
      koli,
      active: draft.active === no ? (koli.at(-1)?.no ?? null) : draft.active,
    })
    setView(PICKED)
  }

  /// Reads again only what this sheet stands on: the koli lists, the
  /// picklists and their rounds, the pools. Not every DC read (twenty-odd,
  /// seconds on a busy Gudang), and never the manifest of a koli just opened
  /// again — that one is gone and would answer 404.
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({
        predicate: ({ queryKey }) =>
          queryKey[0] === "dc" &&
          ((queryKey[1] === "koli" && queryKey.length === 3) ||
            queryKey[1] === "picklists" ||
            queryKey[1] === "picklists-to-pick" ||
            queryKey[1] === "pick-session"),
      }),
      client.invalidateQueries({ queryKey: keys.pools() }),
    ])

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

  /// Seal & print: ONE open koli is packed and sealed (its label prints), the
  /// sheet switches to it, and the print dialog opens for its packing list.
  /// `shown` is the number the sealed koli will wear, for the toast.
  const seal = useMutation({
    mutationFn: async ({ no }: { no: number; shown: number }) => {
      if (shopId === null) throw new Error("No store chosen.")
      const shop = shopId
      const koli = (readDraft(shop) ?? emptyDraft()).koli.find(
        (one) => one.no === no
      )
      const lines = Object.entries(koli?.items ?? {})
        .filter(([, n]) => n > 0)
        .map(([sku_code, quantity]) => ({ sku_code, quantity }))
      if (lines.length === 0) throw new Error("This koli is empty.")
      const rounds = (await dc.picklists()).filter(
        (round) => round.destination_id === shop && round.waiting > 0
      )
      const manifest = await dc.pack({
        destination_store_id: shop,
        lines,
        actor_id: actor,
        // One koli, one seal. Applied twice the second attempt would pack a
        // second koli from the same picklists.
        idempotency_key: idempotencyKey(),
        seal: true,
        pick_session_ids: rounds.map((round) => round.session.session_id),
      })
      // Out of the draft at once, so the refresh below never trims another
      // koli of the same SKU for pieces this one took.
      const now = readDraft(shop) ?? emptyDraft()
      const rest = now.koli.filter((one) => one.no !== no)
      writeDraft(shop, {
        koli: rest,
        active: now.active === no ? (rest.at(-1)?.no ?? null) : now.active,
      })
      if (manifest.koli.koli_id) printSticker.mutate(manifest.koli.koli_id)
      return manifest
    },
    // The sealed koli shows, and its print opens, the moment the seal is
    // answered; the reads catch up behind it.
    onSuccess: (manifest, { shown }) => {
      const id = manifest.koli.koli_id
      const items = new Map<string, number>()
      for (const line of manifest.lines)
        items.set(line.sku_code, (items.get(line.sku_code) ?? 0) + line.quantity)
      if (id) {
        client.setQueryData(keys.manifest(id), manifest)
        setJustSealed({ koli: manifest.koli, at: Date.now(), items })
        fx.current = { seal: `packed-${id}` }
        setView({ kind: "picked" })
        setReviewing(false)
        setPrinting({ id, number: manifest.koli.koli_number })
      }
      setVersion((v) => v + 1)
      // No print sheet pops up on a seal (owner, 20 Oct 2026): the toast
      // offers it, and the sealed koli keeps its Print packing list.
      toast(
        `Koli ${shown} sealed · ${manifest.koli.koli_number}`,
        id
          ? {
              action: {
                label: "Print packing list",
                onClick: () => setPrintAsk(true),
              },
            }
          : undefined
      )
      void refresh()
    },
  })

  /// Pieces of Picked back to the racks, at once.
  const sendBack = useMutation({
    mutationFn: (lines: { sku_code: string; quantity: number }[]) =>
      moveBack({
        idempotency_key: idempotencyKey(),
        destination_id: shopId!,
        from: "picked",
        to: "pick",
        koli_id: null,
        lines,
      }),
    onSuccess: async (_result, lines) => {
      await refresh()
      setBackOpen(false)
      toast(
        `${quantity(sumOf(lines.map((line) => line.quantity)))} back to Pick`
      )
    },
  })

  /// A sealed koli opened again: everything in it back to Picked.
  const unpack = useMutation({
    mutationFn: ({
      id,
      lines,
    }: {
      id: string
      shown: number
      lines: { sku_code: string; quantity: number }[]
    }) =>
      moveBack({
        idempotency_key: idempotencyKey(),
        destination_id: shopId!,
        from: "packed",
        to: "picked",
        koli_id: id,
        lines,
      }),
    // The button stays busy until the reads are back, then the view moves:
    // the pieces land in Picked and the koli leaves in one step.
    onSuccess: async (_result, { id, shown }) => {
      client.removeQueries({ queryKey: keys.manifest(id) })
      if (justSealed?.koli.koli_id === id) setJustSealed(null)
      await refresh()
      setView(PICKED)
      toast(`Koli ${shown} unpacked`)
    },
  })

  // A refusal from the last store must not still be sitting under this one.
  useEffect(() => {
    if (shopId !== null) {
      seal.reset()
      sendBack.reset()
      unpack.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId])

  // ── Body: only what the chosen tile holds ────────────────────────────────
  const packedIndex =
    view.kind === "packed"
      ? packed.findIndex((one) => one.koli_id === view.id)
      : -1
  const openKoli =
    view.kind === "open"
      ? (draft.koli.find((one) => one.no === view.no) ?? null)
      : null

  const pickedRows = (target?: number) =>
    pile.map((one) => (
      <SkuRow
        key={one.sku}
        info={info(one.sku)}
        qty={one.n}
        onPhoto={() => setPhoto(one.sku)}
        action={{
          label: "Put in",
          icon: <Download />,
          tone: "solid",
          onClick: () => startPut([one.sku], false, target),
        }}
      />
    ))
  /// A line of nothing, as the lists say it.
  const nothing = (words: string) => (
    <div className="py-7 text-center text-[0.9375rem] text-mute">{words}</div>
  )
  /// The row above a list, where its one tinted button stands.
  const titleRow = "mt-[18px] mb-3 flex items-center justify-end gap-4"


  let body: React.ReactNode = null
  if (
    view.kind === "picked" ||
    (view.kind === "open" && !openKoli) ||
    (view.kind === "packed" && packedIndex < 0)
  ) {
    // Pack, pack, pack, Submit (owner, 21 Oct 2026): each row is marked
    // Packed whole, and Submit seals what is marked as ONE koli. No tiles,
    // no All in, nothing asked.
    const box = draft.koli.find((one) => koliPieces(one) > 0) ?? draft.koli[0]
    const inBox = box?.items ?? {}
    const rows = [
      ...new Set([...pile.map((one) => one.sku), ...Object.keys(inBox)]),
    ]
      .filter((sku) => (inBox[sku] ?? 0) > 0 || freeOf(sku) > 0)
      .sort((a, b) => a.localeCompare(b))
    /// The SKUs of one article together, in the order the rows run.
    const articleOf = (sku: string) => catalogue.get(sku)?.article_code ?? sku
    const groups: { code: string; skus: string[] }[] = []
    for (const sku of reviewing
      ? rows.filter((one) => (inBox[one] ?? 0) > 0)
      : rows) {
      const code = articleOf(sku)
      const group = groups.find((one) => one.code === code)
      if (group) group.skus.push(sku)
      else groups.push({ code, skus: [sku] })
    }
    const isOpen = (code: string) =>
      reviewing ||
      (unfolded === null ? code === groups[0]?.code : unfolded.has(code))
    const toggle = (code: string) =>
      setUnfolded((now) => {
        const next = new Set(
          now ?? (groups[0] ? [groups[0].code] : [])
        )
        if (next.has(code)) next.delete(code)
        else next.add(code)
        return next
      })
    /// A row inside its article says only colour · size.
    const variantInfo = (sku: string): SkuInfo => {
      const identity = catalogue.get(sku)
      const variant = [identity?.colour, identity?.size]
        .filter(Boolean)
        .join(" · ")
      return { ...info(sku), title: variant || info(sku).title }
    }
    body =
      rows.length > 0 ? (
        <div className="mt-[18px] flex flex-col gap-3">
          {groups.map((group) => {
            const identity = catalogue.get(group.skus[0]!)
            const total = sumOf(
              group.skus.map((sku) =>
                reviewing ? (inBox[sku] ?? 0) : (inBox[sku] ?? 0) + freeOf(sku)
              )
            )
            const allPacked = group.skus.every((sku) => freeOf(sku) === 0)
            const open = isOpen(group.code)
            return (
              <section
                key={group.code}
                className="rounded-card border border-hairline px-3.5"
              >
                <button
                  type="button"
                  aria-expanded={open}
                  disabled={reviewing}
                  onClick={() => toggle(group.code)}
                  className="flex min-h-[3.75rem] w-full items-center gap-3 text-left"
                >
                  <span className="min-w-0 flex-1 text-[0.9375rem] leading-[21px]">
                    <span className="block font-semibold text-ink">
                      {identity?.article_name ?? group.code}
                    </span>
                    <span className="block text-mute">
                      {identity?.article_code ?? group.code}
                    </span>
                  </span>
                  {allPacked && !reviewing && (
                    <Check className="size-4 text-ok-fg" aria-label="Packed" />
                  )}
                  <span className="text-[1.0625rem] font-semibold text-ink tabular-nums">
                    {count(total)}
                  </span>
                  {!reviewing && (
                    <ChevronDown
                      aria-hidden
                      className={`size-5 text-mute transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                    />
                  )}
                </button>
                {open &&
                  group.skus.map((sku) => {
                    const packedN = inBox[sku] ?? 0
                    const free = freeOf(sku)
                    if (reviewing)
                      return (
                        <SkuRow
                          key={sku}
                          info={variantInfo(sku)}
                          qty={packedN}
                          onPhoto={() => setPhoto(sku)}
                        />
                      )
                    const done = packedN > 0 && free === 0
                    return (
                      <SkuRow
                        key={sku}
                        info={variantInfo(sku)}
                        qty={packedN + free}
                        onPhoto={() => setPhoto(sku)}
                        // Pack asks how many when there is more than one
                        // (owner, 23 Oct 2026); Packed in green with a red
                        // Unpack beside it once the row is in whole.
                        action={
                          done
                            ? undefined
                            : {
                                label: "Pack",
                                tone: "solid",
                                onClick: () =>
                                  free > 1
                                    ? setPackAsk({ sku, max: free })
                                    : putTo(box?.no ?? "new", [[sku, free]], null),
                              }
                        }
                        end={
                          packedN > 0 ? (
                            <span className="flex items-center gap-3 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1 font-semibold text-ok-fg tabular-nums">
                                <Check className="size-4" aria-hidden />
                                {done ? "Packed" : count(packedN)}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  box && takeOutOfOpen(box.no, sku, packedN)
                                }
                                className="font-semibold text-bad-fg hover:underline"
                              >
                                Unpack
                              </button>
                            </span>
                          ) : undefined
                        }
                      />
                    )
                  })}
              </section>
            )
          })}
        </div>
      ) : packed.length > 0 ? (
        <Everything
          koli={packed.length}
          pieces={sumOf(packed.map((one) => one.unit_count))}
        />
      ) : (
        <EmptyState>Nothing left to pack for this store.</EmptyState>
      )
  } else if (openKoli) {
    const entries = Object.entries(openKoli.items)
      .filter(([, n]) => n > 0)
      .sort((a, b) => a[0].localeCompare(b[0]))
    body = (
      <>
        <div className={titleRow}>
          {pilePieces > 0 && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setLayer({ no: openKoli.no, open: true })}
            >
              + Add to Koli {shownNo(openKoli.no)}
            </Button>
          )}
        </div>
        {entries.length > 0 ? (
          <div>
            {entries.map(([sku, n]) => (
              <SkuRow
                key={sku}
                info={info(sku)}
                qty={n}
                onPhoto={() => setPhoto(sku)}
                action={{
                  label: "Take out",
                  tone: "solid-bad",
                  onClick: () => setTake({ no: openKoli.no, sku }),
                }}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center">
            {nothing("Empty")}
            <Button
              variant="destructive"
              onClick={() => removeKoli(openKoli.no)}
            >
              Remove Koli {shownNo(openKoli.no)}
            </Button>
          </div>
        )}
      </>
    )
  } else if (packedIndex >= 0) {
    const one = packed[packedIndex]!
    const held = contentsOf(packedIndex)
    const manifest = manifests[packedIndex]?.data
    body = (
      <>
        <div className={`${titleRow} flex-wrap justify-start gap-y-2`}>
          <SealTag>Sealed · {one.koli_number}</SealTag>
          <div className="flex-1" />
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setPrinting({ id: one.koli_id, number: one.koli_number })
              setPrintAsk(true)
            }}
          >
            <Printer />
            Print packing list
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={manifest === undefined || unpack.isPending}
            onClick={() =>
              unpack.mutate({
                id: one.koli_id,
                shown: packedIndex + 1,
                lines: [...held].map(([sku_code, quantity]) => ({
                  sku_code,
                  quantity,
                })),
              })
            }
          >
            Unpack
          </Button>
        </div>
        {manifest === undefined ? (
          <LoadingState>Reading the koli…</LoadingState>
        ) : (
          <div>
            {[...held]
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([sku, n]) => (
                <SkuRow
                  key={sku}
                  info={info(sku)}
                  qty={n}
                  onPhoto={() => setPhoto(sku)}
                />
              ))}
          </div>
        )}
      </>
    )
  }

  // ── Footer: the summary and the one next step ──────────────────────────
  /// The koli Seal & print would seal: the open one in view, or — with
  /// nothing left in Picked — the first one holding pieces.
  const sealTarget = withItems[0] ?? null
  const said = [
    withItems.length > 0
      ? `${count(withItems.length)} koli open · ${quantity(openPieces)}`
      : "",
    packed.length > 0 ? `${count(packed.length)} sealed` : "",
  ]
    .filter(Boolean)
    .join(" · ")
  let footer: React.ReactNode = undefined
  if (shopId !== null && ready)
    footer = (
      // The summary at the left, the next step at the right (prototype); Back
      // to Pick moved up beside All in. Each button sits in a box of its own, as
      // Dispatch's foot does: the White look sends every button a foot holds
      // straight to the right, and hides a spacer.
      <div className="flex w-full items-center gap-3">
        <span className="text-[0.9375rem] text-mute tabular-nums max-md:hidden">
          {said}
        </span>
        {sealTarget ? (
          <>
            {reviewing && (
              <TintButton
                disabled={seal.isPending}
                onClick={() => setReviewing(false)}
              >
                Back
              </TintButton>
            )}
            <div className="ml-auto max-md:flex-1 max-md:[&>button]:w-full">
              {reviewing ? (
                <Button
                  variant="primary"
                  pending={seal.isPending}
                  onClick={() =>
                    seal.mutate({
                      no: sealTarget.no,
                      shown: packed.length + 1,
                    })
                  }
                >
                  Finish packing · {quantity(koliPieces(sealTarget))}
                </Button>
              ) : (
                <Button variant="primary" onClick={() => setReviewing(true)}>
                  Review packing · {quantity(koliPieces(sealTarget))}
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className="ml-auto max-md:flex-1 max-md:[&>button]:w-full">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        )}
      </div>
    )

  // ── The questions ────────────────────────────────────────────────────────
  const putSku = put && !put.all ? put.skus[0]! : null
  const putMax = putSku !== null ? freeOf(putSku) : 0
  const putAll = put?.all ? sumOf(put.skus.map((sku) => freeOf(sku))) : 0
  const putKoliNo =
    put?.to == null ? 0 : put.to === "new" ? newNo : shownNo(put.to)
  const layerKoli =
    layer !== null
      ? (draft.koli.find((one) => one.no === layer.no) ?? null)
      : null
  const takeKoli = take ? draft.koli.find((one) => one.no === take.no) : null
  const takeMax = take && takeKoli ? (takeKoli.items[take.sku] ?? 0) : 0
  const closeLayer = () =>
    setLayer((was) => (was === null ? was : { ...was, open: false }))

  const askMax = packAsk ? Math.min(packAsk.max, freeOf(packAsk.sku)) : 0
  const packBox =
    draft.koli.find((one) => koliPieces(one) > 0) ?? draft.koli[0]
  const questions = (
    <>
      {packAsk !== null && askMax > 0 && (
        <QuantityPad
          key={`${packAsk.sku}-pack`}
          title={info(packAsk.sku).title}
          chip={<KoliChip>{info(packAsk.sku).code}</KoliChip>}
          max={askMax}
          label={(n) => (n > 0 ? `Pack ${count(n)}` : "Pack")}
          onClose={() => setPackAsk(null)}
          onConfirm={(n) => {
            putTo(packBox?.no ?? "new", [[packAsk.sku, n]], null)
            setPackAsk(null)
          }}
        />
      )}
      {put !== null &&
        !(touch && put.to !== null) &&
        (put.all || putMax > 0) && (
          <PutDialog
            title={put.all ? "All picked" : info(putSku!).title}
            sub={
              put.all
                ? quantity(putAll)
                : `${info(putSku!).code} · ${quantity(putMax)}`
            }
            step={put.to === null ? 1 : 2}
            max={put.all ? putAll : putMax}
            koli={draft.koli.map((one) => ({
              shown: shownNo(one.no),
              no: one.no,
              pieces: koliPieces(one),
            }))}
            newNo={newNo}
            onChoose={choose}
            onCancel={() => setPut(null)}
            chip={<KoliChip>Into Koli {putKoliNo}</KoliChip>}
            label={(n) => `Put ${quantity(n)} in Koli ${putKoliNo}`}
            onBack={() =>
              put.skipped ? setPut(null) : setPut({ ...put, to: null })
            }
            onConfirm={(n) => {
              putTo(put.to!, [[putSku!, n]], rowRect(info(putSku!).code))
              setPut(null)
            }}
          />
        )}
      {put !== null &&
        touch &&
        put.to !== null &&
        putSku !== null &&
        putMax > 0 && (
          <QuantityPad
            key={`${putSku}-${String(put.to)}`}
            title={info(putSku).title}
            chip={<KoliChip>Into Koli {putKoliNo}</KoliChip>}
            max={putMax}
            label={(n) =>
              n > 0
                ? `Put ${count(n)} in Koli ${putKoliNo}`
                : `Put in Koli ${putKoliNo}`
            }
            onClose={() => setPut(null)}
            onConfirm={(n) => {
              putTo(put.to!, [[putSku, n]], rowRect(info(putSku).code))
              setPut(null)
            }}
          />
        )}
      {take !== null &&
        takeKoli &&
        takeMax > 0 &&
        (touch ? (
          <QuantityPad
            key={`${take.sku}-out`}
            title={info(take.sku).title}
            chip={<KoliChip>Koli {shownNo(take.no)} → Picked</KoliChip>}
            max={takeMax}
            tone="bad"
            label={(n) => (n > 0 ? `Take ${count(n)} out` : "Take out")}
            onClose={() => setTake(null)}
            onConfirm={(n) => {
              takeOutOfOpen(take.no, take.sku, n)
              setTake(null)
            }}
          />
        ) : (
          <PutDialog
            title={info(take.sku).title}
            sub={`${info(take.sku).code} · ${quantity(takeMax)}`}
            step={2}
            max={takeMax}
            chip={<KoliChip>Koli {shownNo(take.no)} → Picked</KoliChip>}
            tone="bad"
            label={(n) => (n > 0 ? `Take ${quantity(n)} out` : "Take out")}
            onBack={() => setTake(null)}
            onConfirm={(n) => {
              takeOutOfOpen(take.no, take.sku, n)
              setTake(null)
            }}
          />
        ))}
      {backOpen && (
        <BackDialog
          rows={pile.map((one) => [one.sku, one.n] as const)}
          info={info}
          pending={sendBack.isPending}
          onPhoto={setPhoto}
          onClose={() => setBackOpen(false)}
          onConfirm={(lines) => sendBack.mutate(lines)}
        />
      )}
      <PhotoViewer
        open={photo !== null}
        onOpenChange={(next) => {
          if (!next) setPhoto(null)
        }}
        url={photo !== null ? (info(photo).url ?? "") : ""}
        name={photo !== null ? info(photo).title : undefined}
        placeholder={
          photo !== null ? (
            <Thumbnail
              url={null}
              name={info(photo).name}
              division={info(photo).division}
              colours={info(photo).colours}
              className="size-72 rounded-card"
            />
          ) : undefined
        }
      />
      <PrintMenu
        hideTrigger
        label="Print"
        title={printing ? `packing list ${printing.number}` : undefined}
        defaultPaper="A5-portrait"
        paperKey="packing"
        open={printAsk}
        onOpenChange={setPrintAsk}
        onChoose={(choice) => {
          setPaper(choice.paper)
          setPrintPaper(true)
        }}
      />
      <PackingListPrint
        koliIds={printing ? [printing.id] : []}
        paper={paper}
        open={printPaper && printing !== null}
        onClose={() => setPrintPaper(false)}
      />
    </>
  )

  return (
    <>
      <Sheet
        open={shopId !== null}
        onOpenChange={(next) => {
          // Esc reaches the sheet under a stack, not the layer on top of it:
          // while the layer is up, that close is the layer's.
          if (next) return
          if (layer?.open === true) closeLayer()
          else onClose()
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
          <div className="flex flex-col">
            {body}

            <Problem error={seal.error ?? sendBack.error ?? unpack.error} />
          </div>
        )}
      </Sheet>

      {/* The second layer: Picked, over one koli, each row straight into it —
          the same kind of layer as Dispatch's Add to Trip. */}
      <Sheet
        open={layer?.open === true}
        onOpenChange={(next) => {
          if (!next) closeLayer()
        }}
        size="rail"
        context={`Picked · ${quantity(pilePieces)}`}
        title={
          layerKoli ? `Add to Koli ${shownNo(layerKoli.no)}` : "Add to Koli"
        }
        caption={
          layerKoli
            ? `Koli ${shownNo(layerKoli.no)} · ${quantity(koliPieces(layerKoli))}`
            : undefined
        }
        footer={
          <div className="flex justify-end">
            <Button variant="primary" onClick={closeLayer}>
              Done
            </Button>
          </div>
        }
      >
        {layerKoli &&
          (pile.length > 0 ? (
            <div>{pickedRows(layerKoli.no)}</div>
          ) : (
            nothing("Nothing left")
          ))}
      </Sheet>
      {questions}
    </>
  )
}
