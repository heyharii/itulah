import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ChevronRight, X } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { ScanField } from "@/components/ui/scan-field"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { ErrorState, LoadingState, Problem } from "@/components/ui/states"
import { count, day } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  inboundDeliveryKey,
  inboundListKey,
  receiveInboundByCount,
} from "@/lib/queries"
import { cn } from "@/lib/utils"
import {
  byTrouble,
  deliveryName,
  useInboundDelivery,
  verdictOf,
} from "@/screens/stock/inbound"
import { useHeld } from "@/screens/stock/open-record"
import { Code, FOOT, SheetSection } from "@/screens/stock/parts"
import { sourceName, useRange } from "@/screens/stock/shared"
import { idempotencyKey } from "@itulah/contract/client"
import type { StoreInboundDelivery, StoreInboundLine } from "@itulah/contract"

/// One delivery, opened over its list: a count to take while it is in transit,
/// and the items with what was packed against what was counted once it is in.
///
/// Two different sheets under one frame, because a delivery is two different
/// things to a shop depending on where it is:
///
///  - **in transit** it is a job — the facts somebody needs, and a blind count
///    per SKU, scanned or typed, no reader required (owner, 29 Sep 2026). The
///    count is the sheet's whole body and **what was packed is NOT here**: the
///    node does not send it until the count is in, and nothing on this sheet
///    would draw it if it did.
///  - **received** it is a result — the totals, then every SKU with what was
///    packed against what was counted, the problems first, each one opening
///    onto the tags behind its missing units.
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
  onClose,
}: {
  delivery: StoreInboundDelivery | undefined
  onClose: () => void
}) {
  const held = useHeld(delivery)
  if (held === undefined) return null
  return (
    <DeliverySheetFor
      key={held.delivery_id}
      delivery={held}
      open={delivery !== undefined}
      onClose={onClose}
    />
  )
}

function DeliverySheetFor({
  delivery,
  open,
  onClose,
}: {
  delivery: StoreInboundDelivery
  open: boolean
  onClose: () => void
}) {
  const verdict = verdictOf(delivery)
  const received = delivery.status === "RECEIVED"
  const taking = useCountReceive(delivery)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={deliveryName(delivery)}
      caption={
        received
          ? `Received ${day(delivery.received_at)}${
              delivery.received_by === null ? "" : ` by ${delivery.received_by}`
            }`
          : `Departed ${day(delivery.departed_at)}`
      }
      badge={<Pill tone={verdict.tone}>{verdict.label}</Pill>}
      width="wide"
      footer={
        received ? undefined : (
          <div className="flex items-center justify-end gap-3">
            <Button
              variant="primary"
              className={FOOT}
              pending={taking.receive.isPending}
              disabled={taking.counted.length === 0}
              onClick={() => taking.receive.mutate()}
            >
              {taking.receive.isPending ? "Sending…" : "Submit count"}
            </Button>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-6">
        <DeliveryFacts delivery={delivery} />
        {received ? (
          <Received delivery={delivery} />
        ) : (
          <CountReceive taking={taking} />
        )}
      </div>
    </Sheet>
  )
}

// ── In transit ──────────────────────────────────────────────────────────────

/// The state of a blind count: a quantity per SKU, scanned or typed, and the
/// request that books it. Held by the sheet so its foot can send it.
function useCountReceive(delivery: StoreInboundDelivery) {
  const client = useQueryClient()
  const [counts, setCounts] = useState<Readonly<Record<string, number>>>({})

  /// What goes to the node: the SKUs with something counted. A box a person has
  /// emptied to type a new figure is still a row — it only leaves on Remove — so
  /// the number pad is not taken away from under their thumb.
  const counted = Object.entries(counts).filter(([, quantity]) => quantity > 0)

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
      setCounts({})
      void client.invalidateQueries({ queryKey: inboundListKey("ALL") })
      void client.invalidateQueries({
        queryKey: inboundDeliveryKey(delivery.delivery_id),
      })
    },
  })

  const setQty = (sku: string, qty: number) => {
    setCounts((current) =>
      current[sku] === qty ? current : { ...current, [sku]: Math.max(0, qty) },
    )
  }
  const remove = (sku: string) => {
    setCounts((current) => {
      if (current[sku] === undefined) return current
      const rest = { ...current }
      delete rest[sku]
      return rest
    })
  }

  /// A scan is a SKU, optionally with a trailing quantity someone typed —
  /// `"00000012345 x3"` or `"00000012345*3"` — for a shelf counted by the
  /// carton rather than piece by piece. Anything else adds one.
  const onScan = (raw: string) => {
    const match = raw.trim().match(/^(.*?)(?:[\s*xX]+(\d+))?$/)
    const sku = (match?.[1] ?? raw).trim().toUpperCase()
    if (sku === "") return
    const qty = match?.[2] ? Number(match[2]) : 1
    setCounts((current) => ({ ...current, [sku]: (current[sku] ?? 0) + qty }))
  }

  const total = counted.reduce((sum, [, qty]) => sum + qty, 0)
  return { counts, counted, setQty, remove, onScan, total, receive }
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

/// A name over a quieter second line (the article over its SKU).
function TwoLines({
  top,
  bottom,
}: {
  top: React.ReactNode
  bottom?: React.ReactNode
}) {
  return (
    <span className="flex min-h-11 min-w-0 flex-col justify-center py-1">
      <span className="block truncate text-[0.9375rem] leading-[1.4] font-medium text-ink">
        {top}
      </span>
      {bottom !== undefined && (
        <span className="mt-1 block truncate font-mono text-[0.875rem] leading-[1.4] text-mute">
          {bottom}
        </span>
      )}
    </span>
  )
}

/// A blind count per SKU — scanned or typed, Enter adds one — with nothing
/// about `delivery` shown while it is being taken. Owner, 29 Sep 2026:
/// receiving needs no RFID, so this replaces the handheld as the ordinary way
/// a delivery is received; the node turns each count into that many of the
/// delivery's own manifest pieces and books them exactly as a sweep would.
///
/// It reads like the DC's count sheet (owner, 9 Oct 2026: one UI), with one
/// difference that is the point: the DC's rows are listed from the order, and
/// here a row exists only once its SKU has been scanned or typed. Nothing of
/// the manifest — no SKU, no name, no quantity — reaches this sheet before the
/// count is in. The name beside a SKU is the shop's own catalogue book, which
/// every till holds anyway.
///
/// A quantity on a phone is picked on the number pad (the `Input` opens it), so
/// the keyboard never covers the row being counted.
function CountReceive({ taking }: { taking: Taking }) {
  const { bySku } = useRange()
  const phone = useLayout() === "phone"
  const lines = Object.entries(taking.counts)

  return (
    <SheetSection title="Count">
      <ScanField
        // A phone's keyboard would rise over the sheet the moment it opened.
        autoFocus={!phone}
        onScan={taking.onScan}
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
            <span className={cn(COUNT_HEAD, "text-right")}>In pieces</span>
          </div>

          <div className="divide-y divide-hairline">
            {lines.length === 0 ? (
              <p className="flex min-h-11 items-center px-4 py-3.5 text-meta text-mute">
                Nothing counted yet.
              </p>
            ) : (
              lines.map(([sku, qty]) => {
                const name = bySku.get(sku)?.name
                return (
                  <div key={sku} className={cn(COUNT_ROW, "py-3.5")}>
                    <TwoLines
                      top={name ?? sku}
                      bottom={name === undefined ? undefined : sku}
                    />

                    <div className="flex items-center gap-2 max-md:order-last max-md:col-span-2">
                      <Input
                        className="h-11 w-24 text-center font-semibold"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="0"
                        aria-label={`Quantity for ${name ?? sku}`}
                        padLabel={`${name ?? sku} · pcs`}
                        // A box a person has emptied to type a new figure
                        // stays a row, empty, until Remove.
                        value={qty === 0 ? "" : String(qty)}
                        onChange={(event) => {
                          const digits = event.target.value.replace(/\D/g, "")
                          taking.setQty(sku, digits === "" ? 0 : Number(digits))
                        }}
                      />
                      <span className="w-8 text-[0.875rem] text-body">pcs</span>
                      <Button
                        variant="quiet"
                        size="lg"
                        className="w-11 px-0"
                        aria-label={`Remove ${name ?? sku}`}
                        onClick={() => taking.remove(sku)}
                      >
                        <X />
                      </Button>
                    </div>

                    <span
                      className={cn(
                        "flex min-h-11 items-center justify-end text-right tabular-nums",
                        qty === 0 ? "text-mute" : "font-medium text-ink",
                      )}
                    >
                      {qty === 0 ? "—" : pcs(qty)}
                    </span>
                  </div>
                )
              })
            )}
          </div>

          {/* The counted amounts added up — in the same column as each row's
              own figure. */}
          <div
            className={cn(
              COUNT_ROW,
              "border-t border-hairline bg-soft py-3.5",
            )}
          >
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
            {line.sku_code}
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
      <Fact term="From">{sourceName(delivery.source_site_id)}</Fact>
      <Fact term="Cartons">{count(delivery.koli_count)}</Fact>
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
