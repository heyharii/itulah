import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronRight, X } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { confirm } from "@/components/ui/confirm"
import { Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { Photograph } from "@/screens/catalogue-parts"
import { ScanField } from "@/components/ui/scan-field"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { ErrorState, LoadingState, Problem } from "@/components/ui/states"
import { articleId, count, day, sku as skuText } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  fetchIdentities,
  fetchOnHold,
  identitiesKey,
  inboundDeliveryKey,
  inboundListKey,
  inventoryKey,
  onHoldKey,
  receiveInboundByCount,
} from "@/lib/queries"
import { cn } from "@/lib/utils"
import {
  byTrouble,
  fromName,
  useInboundDelivery,
  verdictOf,
} from "@/screens/stock/inbound"
import { useHeld } from "@/screens/stock/open-record"
import { Code, FOOT, SheetSection } from "@/screens/stock/parts"
import { useRange } from "@/screens/stock/shared"
import { shapeBook } from "@/lib/variants"
import { idempotencyKey } from "@itulah/contract/client"
import type {
  CatalogRow,
  StoreInboundDelivery,
  StoreInboundDetail,
  StoreInboundKoli,
  StoreInboundLine,
} from "@itulah/contract"

/// One delivery, opened over its list: a count to take while it is in transit,
/// and the items with what was packed against what was counted once it is in.
///
/// Two different sheets under one frame, because a delivery is two different
/// things to a shop depending on where it is:
///
///  - **in transit** it is a job — the facts somebody needs, and a count per
///    SKU, no reader required (owner, 29 Sep 2026). The count is **no longer
///    blind** (owner, 23 Oct 2026): every SKU is listed with what was packed
///    and a box already holding that figure, and the shop changes only the
///    rows that differ — scanned or typed — then submits.
///  - **received** it is a result — the totals, then every SKU with what was
///    packed against what was counted, the problems first, each one opening
///    onto the tags behind its missing units.
///
/// Both carry the **Koli** the delivery came in, each with what was packed in
/// it (owner, 23 Oct 2026): a koli label scanned on the Receive screen opens
/// the delivery with that koli unfolded.
///
/// The sheet follows the list rather than holding a copy: a delivery open in
/// transit turns into its result the moment the list's poll sees it received,
/// without anybody closing and reopening it.
///
/// `delivery` is the one asked for; `undefined` is closed. The sheet keeps the
/// last one while it slides away, and starts afresh for a different delivery
/// (its own count, its own request).
export function DeliverySheet({
  delivery,
  koliId = null,
  onClose,
}: {
  delivery: StoreInboundDelivery | undefined
  /// The koli a scanned label named, to unfold on arrival.
  koliId?: string | null
  onClose: () => void
}) {
  const held = useHeld(delivery)
  if (held === undefined) return null
  return (
    <DeliverySheetFor
      key={held.delivery_id}
      delivery={held}
      koliId={koliId}
      open={delivery !== undefined}
      onClose={onClose}
    />
  )
}

function DeliverySheetFor({
  delivery,
  koliId,
  open,
  onClose,
}: {
  delivery: StoreInboundDelivery
  koliId: string | null
  open: boolean
  onClose: () => void
}) {
  const verdict = verdictOf(delivery)
  const received = delivery.status === "RECEIVED"
  const detail = useInboundDelivery(delivery.delivery_id, true)
  const taking = useCountReceive(delivery, detail.data)
  /// The koli unfolded: the one a scan named, then whatever is tapped.
  const [unfolded, setUnfolded] = useState<readonly string[]>(
    koliId === null ? [] : [koliId],
  )
  const [seenKoli, setSeenKoli] = useState(koliId)
  if (seenKoli !== koliId) {
    setSeenKoli(koliId)
    if (koliId !== null) setUnfolded((now) => [...new Set([...now, koliId])])
  }
  const toggleKoli = (id: string) =>
    setUnfolded((now) =>
      now.includes(id) ? now.filter((one) => one !== id) : [...now, id],
    )
  /// A koli label scanned into the count opens that koli instead of becoming
  /// a SKU.
  const scanned = (raw: string) => {
    const label = koliLabel(raw)
    const hit = (detail.data?.koli ?? []).find(
      (one) => one.koli_number?.toUpperCase() === label,
    )
    if (hit === undefined) return taking.onScan(raw)
    setUnfolded((now) => [...new Set([...now, hit.koli_id])])
    document
      .getElementById(`koli-${hit.koli_id}`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={`Receive / ${delivery.shipment_reference ?? delivery.delivery_id}`}
      title={`From ${fromName(delivery.source_site_id)}`}
      caption={
        received
          ? `Received ${day(delivery.received_at)}${
              delivery.received_by === null ? "" : ` by ${delivery.received_by}`
            }`
          : undefined
      }
      badge={<Pill tone={verdict.tone}>{verdict.label}</Pill>}
      width="wide"
      footer={
        received ? undefined : (
          <div className="flex items-center justify-end gap-3">
            {taking.unknown.size > 0 && (
              <span className="mr-auto text-[0.9375rem] text-bad">
                Check the red rows
              </span>
            )}
            <Button
              variant="primary"
              className={FOOT}
              pending={taking.receive.isPending}
              disabled={taking.unknown.size > 0 || !taking.ready}
              onClick={async () => {
                // Nothing came off the lorry is still a count: every piece
                // of the delivery goes to MD as missing (owner, 17 Oct 2026).
                if (
                  taking.counted.length === 0 &&
                  !(await confirm({
                    title: "Nothing arrived?",
                    body: "Every piece on this delivery goes to MD as missing.",
                    action: "Submit 0 pcs",
                  }))
                )
                  return
                taking.receive.mutate()
              }}
            >
              {taking.receive.isPending ? "Sending…" : "Submit count"}
            </Button>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-6">
        <DeliveryFacts delivery={delivery} />
        {received && delivery.in_review === true ? (
          <InReview delivery={delivery} />
        ) : received ? (
          <Received delivery={delivery} />
        ) : (
          <CountReceive taking={taking} onScan={scanned} />
        )}
        <KoliSection
          koli={detail.data?.koli ?? []}
          book={taking.book}
          unfolded={unfolded}
          onToggle={toggleKoli}
        />
      </div>
    </Sheet>
  )
}

// ── In transit ──────────────────────────────────────────────────────────────

/// The state of the count: a quantity per SKU, prefilled with what was packed
/// (owner, 23 Oct 2026 — the count is no longer blind), changed where the shop
/// finds a difference, and the request that books it. Held by the sheet so its
/// foot can send it.
function useCountReceive(
  delivery: StoreInboundDelivery,
  detail: StoreInboundDetail | undefined,
) {
  const client = useQueryClient()
  const { catalogue, bySku } = useRange()
  /// What the shop changed or added: a SKU with no entry here is counted as
  /// packed.
  const [changed, setChanged] = useState<Readonly<Record<string, number>>>({})
  /// What was packed, per SKU.
  const packed = useMemo(() => {
    const out = new Map<string, number>()
    for (const line of detail?.lines ?? [])
      if (line.expected > 0) out.set(line.sku_code, line.expected)
    return out
  }, [detail])
  const manifest = useMemo(() => [...packed.keys()], [packed])
  const ready = detail !== undefined
  /// The figure in every box: the change, else the packed quantity.
  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const [sku, qty] of packed) out[sku] = qty
    for (const [sku, qty] of Object.entries(changed)) out[sku] = qty
    return out
  }, [packed, changed])
  /// Articles the shop added by search: on no list, found in the koli.
  const [added, setAdded] = useState<readonly string[]>([])

  /// What goes to the node: the SKUs with something counted. A box a person has
  /// emptied to type a new figure is still a row — it only leaves on Remove — so
  /// the number pad is not taken away from under their thumb.
  const counted = Object.entries(counts).filter(([, quantity]) => quantity > 0)

  /// The shop catalogue drops every SKU that has no price, so a delivery's
  /// unpriced garments are named from the node's identity table instead.
  const missing = useMemo(
    () =>
      [...new Set([...manifest, ...Object.keys(changed)])]
        .filter((sku) => !bySku.has(sku))
        .sort(),
    [manifest, changed, bySku],
  )
  const identities = useQuery({
    queryKey: identitiesKey(missing),
    queryFn: ({ signal }) => fetchIdentities(missing, signal),
    enabled: catalogue.data !== undefined && missing.length > 0,
    staleTime: 5 * 60_000,
  })
  /// The catalogue's rows, then the identity rows it lacked (shaped like
  /// them, so the same reader splits name, colour and size).
  const book = useMemo(() => {
    const extra = (identities.data ?? [])
      .filter((one) => !bySku.has(one.sku_code))
      .map(
        (one) =>
          ({
            sku_code: one.sku_code,
            name: one.name,
            article_code: one.article_code,
            division_code: one.division_code,
            barcode: one.barcode,
            has_image: one.image_url !== null,
            tags: one.tags,
          }) as unknown as CatalogRow,
      )
    const rows = [...(catalogue.data?.items ?? []), ...extra]
    const all = new Map<string, CatalogRow>()
    for (const row of rows) all.set(row.sku_code, row)
    return { all, shapes: shapeBook(rows) }
  }, [catalogue.data, identities.data, bySku])

  /// A SKU the shop's catalogue does not know is a mistyped or misread code,
  /// never a piece of the delivery: it turns red and holds the Submit until it
  /// is removed (owner, 11 Oct 2026). Counted silently, it made a short
  /// delivery add up — 12 real pieces and one bad code came to the 13 sent
  /// (17 Oct 2026). Judged only once the catalogue is in.
  const unknown = new Set(
    catalogue.data === undefined || identities.isLoading
      ? []
      : Object.keys(changed).filter(
          (sku) => !packed.has(sku) && !book.all.has(sku),
        ),
  )

  const receive = useMutation({
    mutationFn: () =>
      receiveInboundByCount(delivery.delivery_id, {
        counts: counted.map(([sku_code, quantity]) => ({
          sku_code,
          quantity,
        })),
        // Replaced by the signed-in principal when the node enforces auth.
        actor_id: "",
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: () => {
      setChanged({})
      void client.invalidateQueries({ queryKey: inboundListKey("ALL") })
      void client.invalidateQueries({
        queryKey: inboundDeliveryKey(delivery.delivery_id),
      })
      void client.invalidateQueries({ queryKey: onHoldKey() })
      // What was booked is stock now: balances and ledger read again.
      void client.invalidateQueries({ queryKey: inventoryKey() })
    },
  })

  const setQty = (sku: string, qty: number) => {
    setChanged((current) =>
      current[sku] === qty ? current : { ...current, [sku]: Math.max(0, qty) },
    )
  }
  const remove = (sku: string) => {
    setChanged((current) => {
      if (current[sku] === undefined) return current
      const rest = { ...current }
      delete rest[sku]
      return rest
    })
  }

  /// A scan is a SKU, optionally with a trailing quantity someone typed —
  /// `"00000012345 x3"` or `"00000012345*3"` — for a shelf counted by the
  /// carton rather than piece by piece. A SKU on the list is already counted
  /// as packed, so a scan only takes the shop to its box (or sets it, when a
  /// quantity came with it); any other SKU is added, one at a time.
  const onScan = (raw: string) => {
    const match = raw.trim().match(/^(.*?)(?:[\s*xX]+(\d+))?$/)
    const sku = (match?.[1] ?? raw).replace(/·/g, "").trim().toUpperCase()
    if (sku === "") return
    if (packed.has(sku)) {
      if (match?.[2]) setQty(sku, Number(match[2]))
      window.setTimeout(() => {
        const box = document.querySelector<HTMLInputElement>(
          `[data-count="${sku}"] input`,
        )
        box?.scrollIntoView({ block: "center", behavior: "smooth" })
        box?.focus()
        box?.select()
      }, 0)
      return
    }
    const qty = match?.[2] ? Number(match[2]) : 1
    setChanged((current) => ({
      ...current,
      [sku]: (current[sku] ?? 0) + qty,
    }))
  }

  const addArticle = (key: string) =>
    setAdded((current) => (current.includes(key) ? current : [...current, key]))
  /// An added article taken off again, with whatever was counted of it.
  const removeArticle = (key: string) => {
    setAdded((current) => current.filter((one) => one !== key))
    setChanged((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([sku]) => (book.all.get(sku)?.article_code ?? sku) !== key,
        ),
      ),
    )
  }

  const total = counted.reduce((sum, [, qty]) => sum + qty, 0)
  const totalPacked = [...packed.values()].reduce((sum, qty) => sum + qty, 0)
  return {
    counts,
    packed,
    totalPacked,
    ready,
    counted,
    unknown,
    setQty,
    remove,
    onScan,
    total,
    receive,
    manifest,
    book,
    added,
    addArticle,
    removeArticle,
  }
}

type Taking = ReturnType<typeof useCountReceive>

/// The count sheet's three tracks — the article, the amount counted, and what
/// that comes to — shared by its header, every row and the total so the columns
/// hold. This is the DC's count sheet (`frontend-hub` › Operations › Receiving,
/// `CountSheet`), drawn from this app's tokens: the same card, header row, row
/// anatomy and total row. The amount track is narrower than the hub's because a
/// shop counts in pieces only — there is no unit to pick, so it holds the
/// figure, "pcs" and the remove button.
///
/// Under 48rem (this app's phone) the three do not fit beside each other: the
/// article and its figure share the first line, and the amount takes the whole
/// of the line under it.
const COUNT_ROW =
  "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 px-4 md:grid-cols-[minmax(0,1fr)_11.75rem_6rem]"

/// A column heading as the hub sets one: sentence case, medium, the quiet body
/// colour.
const COUNT_HEAD = "text-eyebrow font-medium whitespace-nowrap text-body"

/// "1 pc", "12 pcs" — a figure of this sheet.
function pcs(n: number): string {
  return `${count(n)} ${n === 1 ? "pc" : "pcs"}`
}

/// A name over a quieter second line (the article over its colour and size).
/// `plain` sets the second line in the body face rather than mono.
function TwoLines({
  top,
  bottom,
  plain = false,
}: {
  top: React.ReactNode
  bottom?: React.ReactNode
  plain?: boolean
}) {
  return (
    <span className="flex min-h-11 min-w-0 flex-col justify-center py-1">
      <span className="block truncate text-[0.9375rem] leading-[1.4] font-medium text-ink">
        {top}
      </span>
      {bottom !== undefined && bottom !== "" && (
        <span
          className={cn(
            "mt-1 block truncate text-[0.9375rem] leading-[1.4] text-mute",
            !plain && "font-mono",
          )}
        >
          {bottom}
        </span>
      )}
    </span>
  )
}

/// A SKU's photograph as a 48px tile — or the colourway stand-in when the node
/// holds none — as the hub's count sheet rows.
function ArticleThumb({
  name,
  sku,
  has,
}: {
  name: string
  sku: string | undefined
  has: boolean
}) {
  return (
    <span className="size-12 shrink-0 overflow-hidden rounded-inner bg-soft-2">
      <Photograph sku={sku ?? ""} has={has} name={name} />
    </span>
  )
}

/// The count, by SKU (owner, 20 Oct 2026), **no longer blind** (owner, 23 Oct
/// 2026): one row per SKU the delivery carries — the article's name over its
/// colour · size, what was packed, and a box already holding that figure. The
/// shop changes only the rows that differ, and a row that differs says so in a
/// word under what was packed. An article the shop finds that is on no list is
/// added by a scan and counted the same way (Packed reads "—"). A scan of a
/// SKU on the list takes the shop to its box. It reads like the hub's PO count
/// sheet (`frontend-hub` › Receiving `CountSheet`).
///
/// A SKU's code is never a title: names come from the shop catalogue, or from
/// the node's identity table for the unpriced SKUs the catalogue drops.
///
/// What the shop counts beyond what was sent is not booked: it waits on hold
/// until MD answers (this sheet's In review; Stock › To be returned › Over
/// delivery).
///
/// A quantity on a phone is picked on the number pad (the `Input` opens it), so
/// the keyboard never covers the row being counted.
function CountReceive({
  taking,
  onScan,
}: {
  taking: Taking
  onScan: (raw: string) => void
}) {
  const phone = useLayout() === "phone"
  const { all, shapes } = taking.book
  const keyOf = (sku: string) => all.get(sku)?.article_code ?? sku
  /// An article's SKUs in the order its colours and sizes read.
  const skusOf = (key: string): string[] => {
    const shape = shapes.get(key)
    if (shape === undefined) return [key]
    const order = shape.colours.flatMap((colour) =>
      colour.skus.map((row) => row.sku_code),
    )
    const sizeRank = (sku: string) =>
      shape.sizes.indexOf(shape.variant.get(sku)?.size ?? "")
    const colourRank = (sku: string) =>
      shape.colours.findIndex((c) => c.skus.some((r) => r.sku_code === sku))
    return [...order].sort(
      (a, b) => colourRank(a) - colourRank(b) || sizeRank(a) - sizeRank(b),
    )
  }
  const isUnknown = (sku: string) => taking.unknown.has(sku)
  /// Every row: all the delivery carries, then what the shop added or scanned
  /// beyond it (owner, 23 Oct 2026: the list is shown up front, where the 21
  /// Oct rule had it hidden). Grouped by article, in reading order.
  const listedSkus = new Set(taking.manifest)
  const wanted = new Set<string>([
    ...taking.manifest,
    ...taking.added.flatMap(skusOf),
    ...Object.keys(taking.counts).filter((sku) => !isUnknown(sku)),
  ])
  const keys = [...new Set([...wanted].map(keyOf))]
  const grouped = keys.flatMap((key) =>
    skusOf(key).filter((sku) => wanted.has(sku)),
  )
  /// SKUs the book never named and that sit in no article: rows all the same.
  const strays = [...wanted].filter((sku) => !grouped.includes(sku))
  const rows = [...grouped, ...strays]
  const unknownRows = Object.keys(taking.counts).filter(isUnknown)

  const amount = (sku: string, label: string, removeKey: string | null) => {
    const qty = taking.counts[sku] ?? 0
    const sent = taking.packed.get(sku) ?? 0
    const gap = qty - sent
    return (
      <>
        <div
          data-count={sku}
          className="flex items-center gap-2 max-md:order-last max-md:col-span-2"
        >
          <Input
            className="h-11 w-24 text-center font-semibold"
            inputMode="numeric"
            autoComplete="off"
            placeholder="0"
            aria-label={`Quantity for ${label}`}
            padLabel={`${label} · pcs`}
            value={qty === 0 ? "" : String(qty)}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, "")
              taking.setQty(sku, digits === "" ? 0 : Number(digits))
            }}
          />
          <span className="w-8 text-[0.9375rem] text-body">pcs</span>
          {removeKey !== null && (
            <Button
              variant="quiet"
              size="lg"
              className="w-11 px-0"
              aria-label={`Remove ${label}`}
              onClick={() => taking.removeArticle(removeKey)}
            >
              <X />
            </Button>
          )}
        </div>
        <span className="flex min-h-11 flex-col items-end justify-center text-right tabular-nums">
          <span className={sent === 0 ? "text-mute" : "text-ink"}>
            {sent === 0 ? "—" : pcs(sent)}
          </span>
          {sent > 0 && gap !== 0 && (
            <span
              className={cn(
                "text-[0.9375rem]",
                gap < 0 ? "text-bad-fg" : "text-ok-fg",
              )}
            >
              {count(Math.abs(gap))} {gap < 0 ? "missing" : "extra"}
            </span>
          )}
        </span>
      </>
    )
  }

  return (
    <SheetSection title="Count">
      <ScanField
        // A phone's keyboard would rise over the sheet the moment it opened.
        autoFocus={!phone}
        onScan={onScan}
        placeholder="Scan a barcode or type a SKU"
      />

      <div className="mt-3 flex min-w-0 flex-col gap-4">
        {/* One grid, header and rows sharing the same tracks: what, what was
            counted, and what that comes to. */}
        <Card>
          <div
            className={cn(
              COUNT_ROW,
              "h-10 items-center border-b border-hairline bg-soft",
            )}
          >
            <span className={COUNT_HEAD}>Article</span>
            <span className={cn(COUNT_HEAD, "max-md:hidden")}>Counted</span>
            <span className={cn(COUNT_HEAD, "text-right")}>Packed</span>
          </div>

          <div className="divide-y divide-hairline">
            {!taking.ready && <LoadingState>Reading the delivery…</LoadingState>}
            {taking.ready && rows.length === 0 && unknownRows.length === 0 && (
              <p className="flex min-h-11 items-center px-4 py-3.5 text-meta text-mute">
                This delivery lists no items.
              </p>
            )}
            {rows.map((sku) => {
              const row = all.get(sku)
              const key = keyOf(sku)
              const shape = shapes.get(key)
              const variant = shape?.variant.get(sku)
              const title = shape?.name ?? row?.name ?? "Unnamed article"
              const detail = [variant?.colour, variant?.size]
                .filter(Boolean)
                .join(" · ")
              const codes = `${articleId(row?.article_code, sku)} · ${skuText(sku)}`
              const added = !listedSkus.has(sku) && taking.added.includes(key)
              return (
                <div key={sku} className={cn(COUNT_ROW, "py-3")}>
                  <span className="flex min-w-0 items-center gap-3">
                    <ArticleThumb
                      name={title}
                      sku={sku}
                      has={row?.has_image ?? false}
                    />
                    <TwoLines
                      top={title}
                      bottom={detail === "" ? codes : `${codes} · ${detail}`}
                      plain
                    />
                  </span>
                  {amount(
                    sku,
                    detail === "" ? title : `${title} ${detail}`,
                    added ? key : null,
                  )}
                </div>
              )
            })}
            {unknownRows.map((sku) => (
              <div key={sku} className={cn(COUNT_ROW, "py-3.5")}>
                <TwoLines
                  top={<span className="text-bad">No SKU {skuText(sku)}</span>}
                />
                <div className="flex items-center gap-2 max-md:order-last max-md:col-span-2">
                  <span className="w-24 text-center font-semibold tabular-nums">
                    {count(taking.counts[sku] ?? 0)}
                  </span>
                  <Button
                    variant="quiet"
                    size="lg"
                    className="w-11 px-0"
                    aria-label={`Remove ${skuText(sku)}`}
                    onClick={() => taking.remove(sku)}
                  >
                    <X />
                  </Button>
                </div>
                <span />
              </div>
            ))}
          </div>

          {/* Both totals, in the same column as each row's packed figure. */}
          <div
            className={cn(COUNT_ROW, "border-t border-hairline bg-soft py-3.5")}
          >
            <span className="flex min-h-11 items-center text-body">
              Total Packed
            </span>
            <span className="max-md:hidden" />
            <span className="flex min-h-11 items-center justify-end text-right text-ink tabular-nums">
              {pcs(taking.totalPacked)}
            </span>
            <span className="flex min-h-11 items-center font-medium text-ink">
              Total Counted
            </span>
            <span className="max-md:hidden" />
            <span className="flex min-h-11 items-center justify-end text-right font-medium text-ink tabular-nums">
              {pcs(taking.total)}
            </span>
          </div>
        </Card>

        <Problem error={taking.receive.error} />
      </div>
    </SheetSection>
  )
}

// ── Koli ────────────────────────────────────────────────────────────────────

/// The label number a scan carries — `KL-…` or the koli QR `K1:KL-…` — upper
/// cased, or null for any other code.
/// A scanned code as a koli label reads: the QR's `K1:` dropped, any case.
/// Whether it is one is up to the delivery's own koli numbers, whatever
/// prefix the DC prints.
function koliLabel(raw: string): string {
  return raw.trim().toUpperCase().replace(/^K1:/, "")
}

/// The koli the delivery came in (owner, 23 Oct 2026): each by its label number
/// with its pieces, and unfolded onto what was packed in it — name, colour ·
/// size, quantity. A koli the centre sent no label for reads "Koli 2/3".
function KoliSection({
  koli,
  book,
  unfolded,
  onToggle,
}: {
  koli: readonly StoreInboundKoli[]
  book: Taking["book"]
  unfolded: readonly string[]
  onToggle: (id: string) => void
}) {
  if (koli.length === 0) return null
  return (
    <SheetSection title="Koli" aside={count(koli.length)}>
      <ul className="divide-y divide-hairline border-y border-hairline">
        {koli.map((one, at) => {
          const open = unfolded.includes(one.koli_id)
          const pieces = one.lines.reduce((sum, line) => sum + line.quantity, 0)
          return (
            <li key={one.koli_id} id={`koli-${one.koli_id}`}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => onToggle(one.koli_id)}
                className="flex min-h-tap w-full cursor-pointer items-center gap-2.5 py-3 text-left"
              >
                <ChevronRight
                  aria-hidden
                  className={cn(
                    "size-4 shrink-0 text-line-ico transition-transform duration-200",
                    open && "rotate-90",
                  )}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-[0.9375rem] text-ink">
                  {one.koli_number ?? `Koli ${at + 1}/${koli.length}`}
                </span>
                <span className="text-[0.9375rem] text-body tabular-nums">
                  {pcs(pieces)}
                </span>
              </button>
              {open && (
                <ul className="pb-2 pl-6">
                  {one.lines.map((line) => {
                    const row = book.all.get(line.sku_code)
                    const variant = book.shapes
                      .get(row?.article_code ?? line.sku_code)
                      ?.variant.get(line.sku_code)
                    const detail = [variant?.colour, variant?.size]
                      .filter(Boolean)
                      .join(" · ")
                    return (
                      <li
                        key={line.sku_code}
                        className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-2"
                      >
                        <span className="min-w-0">
                          <span className="block text-[0.9375rem] font-medium break-words text-ink">
                            {line.name ?? row?.name ?? "Not in this shop's book"}
                          </span>
                          <span className="block truncate font-mono text-[0.9375rem] text-mute">
                            {articleId(null, line.sku_code)} ·{" "}
                            {skuText(line.sku_code)}
                            {detail !== "" && ` · ${detail}`}
                          </span>
                        </span>
                        <span className="text-right text-[0.9375rem] text-ink tabular-nums">
                          {pcs(line.quantity)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </SheetSection>
  )
}

// ── In review ───────────────────────────────────────────────────────────────

/// Counted, and the count differs from what was sent. What matched went into
/// stock when it was counted; what came beyond it is on hold until MD answers
/// the trip's review (owner, 20 Oct 2026). Each article says both, and
/// nothing about what was sent.
function InReview({ delivery }: { delivery: StoreInboundDelivery }) {
  const detail = useInboundDelivery(delivery.delivery_id, true)
  const onHold = useQuery({
    queryKey: onHoldKey(),
    queryFn: ({ signal }) => fetchOnHold(signal),
    refetchInterval: 15_000,
  })
  const held = (onHold.data ?? []).filter(
    (line) => line.delivery_id === delivery.delivery_id,
  )
  const rows = new Map<
    string,
    { name: string | null; inStock: number; onHold: number }
  >()
  for (const line of detail.data?.lines ?? [])
    if (line.received > 0)
      rows.set(line.sku_code, {
        name: line.name,
        inStock: line.received,
        onHold: 0,
      })
  for (const line of held) {
    const row = rows.get(line.sku_code) ?? {
      name: line.name,
      inStock: 0,
      onHold: 0,
    }
    rows.set(line.sku_code, { ...row, onHold: row.onHold + line.on_hold })
  }
  const lines = [...rows.entries()]
  const total = lines.reduce((sum, [, row]) => sum + row.inStock + row.onHold, 0)
  return (
    <SheetSection title="Counted · waiting for MD">
      <Card>
        <div
          className={cn(
            COUNT_ROW,
            "h-10 items-center border-b border-hairline bg-soft",
          )}
        >
          <span className={COUNT_HEAD}>Article</span>
          <span className={cn(COUNT_HEAD, "max-md:hidden")} />
          <span className={cn(COUNT_HEAD, "text-right")}>Counted</span>
        </div>
        <div className="divide-y divide-hairline">
          {(detail.isPending || onHold.isPending) && <LoadingState />}
          {lines.map(([sku, row]) => {
            const where = [
              row.inStock > 0 && `${pcs(row.inStock)} in stock`,
              row.onHold > 0 && `${pcs(row.onHold)} on hold`,
            ]
              .filter(Boolean)
              .join(" · ")
            return (
            <div key={sku} className={cn(COUNT_ROW, "py-3")}>
              {/* A phone has no middle column: where the pieces are goes
                  under the name instead. */}
              <TwoLines
                top={row.name ?? skuText(sku)}
                bottom={
                  <>
                    <span className="max-md:hidden">
                      {articleId(null, sku)} · {skuText(sku)}
                    </span>
                    <span className="md:hidden">
                      {articleId(null, sku)} · {skuText(sku)} · {where}
                    </span>
                  </>
                }
              />
              <span className="flex min-h-11 items-center text-mute max-md:hidden">
                {where}
              </span>
              <span className="flex min-h-11 items-center justify-end font-medium text-ink tabular-nums">
                {pcs(row.inStock + row.onHold)}
              </span>
            </div>
            )
          })}
        </div>
        <div
          className={cn(COUNT_ROW, "border-t border-hairline bg-soft py-3.5")}
        >
          <span className="flex min-h-11 items-center font-medium text-ink">
            Total Counted
          </span>
          <span className="max-md:hidden" />
          <span className="flex min-h-11 items-center justify-end font-medium text-ink tabular-nums">
            {pcs(total)}
          </span>
        </div>
      </Card>
    </SheetSection>
  )
}

// ── Received ────────────────────────────────────────────────────────────────

function Received({ delivery }: { delivery: StoreInboundDelivery }) {
  const detail = useInboundDelivery(delivery.delivery_id, true)
  const { bySku } = useRange()
  // Only what was on the delivery: a piece found that was not packed is not a
  // line of it.
  const lines = (detail.data?.lines ?? [])
    .filter((line) => line.expected > 0)
    .sort(byTrouble)
  const skipped = detail.data?.skipped_epcs ?? []

  return (
    <>
      <SheetSection
        title="Items"
        aside={detail.data === undefined ? undefined : count(lines.length)}
      >
        {detail.isPending ? (
          <LoadingState>Reading the count…</LoadingState>
        ) : detail.isError ? (
          <ErrorState
            error={detail.error}
            onRetry={() => void detail.refetch()}
          />
        ) : lines.length === 0 ? (
          <p className="text-meta text-mute">
            The node holds no lines for this delivery.
          </p>
        ) : (
          <div>
            {/* The desk reads the two figures across; a phone gets them as one
                line under the name. */}
            <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] gap-3 border-b border-hairline pb-2 text-[0.875rem] font-medium text-body max-md:hidden">
              <span>Item</span>
              <span className="text-right">Sent</span>
              <span className="text-right">Counted</span>
            </div>
            <ul className="divide-y divide-hairline border-b border-hairline md:border-b-0">
              {lines.map((line) => (
                <ItemRow
                  key={line.sku_code}
                  line={line}
                  name={
                    line.name ??
                    bySku.get(line.sku_code)?.name ??
                    "Not in this shop's book"
                  }
                />
              ))}
            </ul>
          </div>
        )}
      </SheetSection>
      {skipped.length > 0 && <Skipped epcs={skipped} />}
    </>
  )
}

/// One item: its name over its SKU, what was packed against what was counted,
/// and — when something is missing — the tags behind it, folded.
function ItemRow({ line, name }: { line: StoreInboundLine; name: string }) {
  const tone =
    line.received > line.expected
      ? "text-ok-fg"
      : line.received < line.expected
        ? "text-bad-fg"
        : "text-ink"
  return (
    <li className="py-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 md:grid-cols-[minmax(0,1fr)_5rem_5rem]">
        <span className="min-w-0">
          <span className="block text-[0.9375rem] font-medium break-words text-ink">
            {name}
          </span>
          <span className="block truncate font-mono text-[0.875rem] text-mute">
            {articleId(null, line.sku_code)} · {skuText(line.sku_code)}
          </span>
        </span>
        {/* A phone: one line, counted of sent, and the difference under it. */}
        <span className="flex flex-col items-end text-right tabular-nums md:hidden">
          <span className={cn("text-[0.9375rem] font-medium", tone)}>
            {count(line.received)} of {count(line.expected)}
          </span>
          <Difference line={line} />
        </span>
        <span className="hidden self-start text-right text-[0.9375rem] text-text tabular-nums md:block">
          {count(line.expected)}
        </span>
        <span
          className={cn(
            "hidden self-start text-right text-[0.9375rem] font-medium tabular-nums md:block",
            tone,
          )}
        >
          {count(line.received)}
          <Difference line={line} className="block font-normal" />
        </span>
      </div>
      {line.missing_epcs.length > 0 && (
        <details className="group mt-2">
          <summary className="flex min-h-tap cursor-pointer list-none items-center gap-1.5 text-[0.875rem] font-medium text-bad-fg [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden
              className="size-4 shrink-0 transition-transform duration-200 group-open:rotate-90"
            />
            Tags missing
            <span className="tabular-nums">
              · {count(line.missing_epcs.length)}
            </span>
          </summary>
          <ul className="grid gap-x-4 gap-y-1 pb-1 pl-5 lg:grid-cols-2">
            {line.missing_epcs.map((epc) => (
              <li key={epc} className="min-w-0">
                <Code>{epc}</Code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  )
}

/// What an item's count came to against what was packed, in words.
function Difference({
  line,
  className,
}: {
  line: StoreInboundLine
  className?: string
}) {
  if (line.missing > 0) {
    return (
      <span className={cn("text-[0.875rem] text-bad-fg", className)}>
        {count(line.missing)} missing
      </span>
    )
  }
  if (line.received > line.expected) {
    return (
      <span className={cn("text-[0.875rem] text-ok-fg", className)}>
        {count(line.received - line.expected)} extra
      </span>
    )
  }
  return (
    <span className={cn("text-[0.875rem] text-mute", className)}>Complete</span>
  )
}

/// The delivery's own facts — the same in transit and received, so the two
/// sheets read as one record at two moments. The surat jalan number is the
/// sheet's title.
function DeliveryFacts({ delivery }: { delivery: StoreInboundDelivery }) {
  return (
    <Facts>
      <Fact term="From">{fromName(delivery.source_site_id)}</Fact>
      <Fact term="Delivery note">{delivery.shipment_reference ?? "—"}</Fact>
      <Fact term="Koli">{count(delivery.koli_count)}</Fact>
      <Fact term="Departed">{day(delivery.departed_at)}</Fact>
      {delivery.status === "RECEIVED" && (
        <>
          <Fact term="Received">{day(delivery.received_at)}</Fact>
          {delivery.received_by !== null && (
            <Fact term="Received by">{delivery.received_by}</Fact>
          )}
        </>
      )}
    </Facts>
  )
}

/// Tags the handheld read and the node did not count either way. Folded,
/// because they are rarely what anybody came to the sheet for — but said,
/// because a number that quietly left some tags out is a number nobody can
/// check.
function Skipped({ epcs }: { epcs: readonly string[] }) {
  return (
    <details className="group rounded-inner border border-hairline">
      <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2.5 px-3.5 py-2.5 text-meta text-body [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-line-ico transition-transform duration-200 group-open:rotate-90"
        />
        <span className="min-w-0 flex-1">
          <span className="font-medium text-ink tabular-nums">
            {count(epcs.length)} {epcs.length === 1 ? "tag" : "tags"} skipped
          </span>{" "}
          — not counted either way
        </span>
      </summary>
      <ul className="grid gap-x-4 gap-y-1 border-t border-hairline px-3.5 py-2.5 lg:grid-cols-2">
        {epcs.map((epc) => (
          <li key={epc} className="min-w-0">
            <Code>{epc}</Code>
          </li>
        ))}
      </ul>
    </details>
  )
}
