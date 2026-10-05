import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ChevronRight } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { Pill } from "@/components/ui/pill"
import { RecordSheet } from "@/components/ui/record-sheet"
import { ScanField } from "@/components/ui/scan-field"
import { Banner, ErrorState, LoadingState } from "@/components/ui/states"
import { describe } from "@/lib/errors"
import { count, day } from "@/lib/format"
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
import { Code, Fact, Facts } from "@/screens/stock/parts"
import { useRange } from "@/screens/stock/shared"
import { idempotencyKey } from "@itulah/contract/client"
import type {
  CatalogRow,
  StoreInboundDelivery,
  StoreInboundLine,
} from "@itulah/contract"

/// One delivery, opened under its row in the list: a count to take while it is
/// in transit, and the items with what was packed against what was counted once
/// it is in.
///
/// Two different sheets under one frame, because a delivery is two different
/// things to a shop depending on where it is:
///
///  - **in transit** it is a job — the facts somebody needs, and a Receive
///    action that takes a blind count per SKU, scanned or typed, no reader
///    required (owner, 29 Sep 2026). What was packed is NOT here: the count
///    is blind, and the node does not send it.
///  - **received** it is a result — the totals, then every SKU with what was
///    packed against what was counted, the problems first, each one opening
///    onto the tags behind its missing units.
///
/// The sheet follows the list rather than holding a copy: a delivery open in
/// transit turns into its result the moment the list's poll sees it received,
/// without anybody closing and reopening it.
export function DeliverySheet({
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
  return (
    <RecordSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={delivery.delivery_id}
      title={deliveryName(delivery)}
      caption={
        received
          ? `Received ${day(delivery.received_at)}${
              delivery.received_by === null ? "" : ` by ${delivery.received_by}`
            }`
          : `Departed ${day(delivery.departed_at)}`
      }
      badge={<Pill tone={verdict.tone}>{verdict.label}</Pill>}
      width={received ? "wide" : "rail"}
    >
      <DeliveryFacts delivery={delivery} />
      <div className="mt-8">
        {received ? (
          <Received delivery={delivery} />
        ) : (
          <InTransit delivery={delivery} startCounting />
        )}
      </div>
    </RecordSheet>
  )
}

// ── In transit ──────────────────────────────────────────────────────────────

function InTransit({
  delivery,
  startCounting = false,
}: {
  delivery: StoreInboundDelivery
  /// Opened from the row's Count receive: straight into the count.
  startCounting?: boolean
}) {
  const [counting, setCounting] = useState(startCounting)
  return (
    <>
      <DeliveryFacts delivery={delivery} />

      {counting ? (
        <CountReceive delivery={delivery} onCancel={() => setCounting(false)} />
      ) : (
        <section className="mt-8">
          <Button variant="primary" onClick={() => setCounting(true)}>
            Receive
          </Button>
        </section>
      )}
    </>
  )
}

/// A blind count per SKU — scanned or typed, Enter adds one — with nothing
/// about `delivery` shown while it is being taken. Owner, 29 Sep 2026:
/// receiving needs no RFID, so this replaces the handheld as the ordinary way
/// a delivery is received; the node turns each count into that many of the
/// delivery's own manifest pieces and books them exactly as a sweep would.
function CountReceive({
  delivery,
  onCancel,
}: {
  delivery: StoreInboundDelivery
  onCancel: () => void
}) {
  const client = useQueryClient()
  const [counts, setCounts] = useState<Readonly<Record<string, number>>>({})

  const receive = useMutation({
    mutationFn: () =>
      receiveInboundByCount(delivery.delivery_id, {
        counts: Object.entries(counts).map(([sku_code, quantity]) => ({
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
    setCounts((current) => {
      if (qty <= 0) {
        if (current[sku] === undefined) return current
        const rest = { ...current }
        delete rest[sku]
        return rest
      }
      if (current[sku] === qty) return current
      return { ...current, [sku]: qty }
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

  const lines = Object.entries(counts)
  const total = lines.reduce((sum, [, qty]) => sum + qty, 0)

  return (
    <section className="mt-7">
      <h3 className="text-card-title font-semibold text-ink">Receive it</h3>
      <p className="mt-1 text-meta text-body">
        Scan a barcode or type a SKU and press Enter to add one.
      </p>
      <ScanField
        className="mt-3.5"
        onScan={onScan}
        placeholder="Scan a barcode or type a SKU"
      />

      {lines.length === 0 ? (
        <p className="mt-3 text-meta text-mute">Nothing counted yet.</p>
      ) : (
        <ul className="mt-3.5 flex flex-col gap-2">
          {lines.map(([sku, qty]) => (
            <li
              key={sku}
              className="flex items-center gap-2.5 rounded-inner border border-hairline px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-cell text-ink">
                {sku}
              </span>
              <Input
                className="w-16 text-right"
                inputMode="numeric"
                aria-label={`Quantity for ${sku}`}
                value={String(qty)}
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, "")
                  setQty(sku, digits === "" ? 0 : Number(digits))
                }}
              />
              <Button variant="quiet" onClick={() => setQty(sku, 0)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-meta text-mute tabular-nums">
        {count(total)} {total === 1 ? "piece" : "pieces"} counted
      </p>

      {receive.error !== null && (
        <Banner tone="bad" className="mt-3">
          {describe(receive.error)}
        </Banner>
      )}

      <div className="mt-4 flex items-center gap-2">
        <Button
          variant="ghost"
          onClick={onCancel}
          disabled={receive.isPending}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={lines.length === 0 || receive.isPending}
          onClick={() => receive.mutate()}
        >
          {receive.isPending ? "Receiving…" : "Receive"}
        </Button>
      </div>
    </section>
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
    <div className="flex flex-col gap-3 pb-2">
      <div className="overflow-hidden rounded-card border border-hairline bg-canvas">
        {detail.isPending ? (
          <LoadingState>Reading the count…</LoadingState>
        ) : detail.isError ? (
          <ErrorState
            error={detail.error}
            onRetry={() => void detail.refetch()}
          />
        ) : (
          <ListTable
            roomy
            rows={lines}
            columns={lineColumns(bySku)}
            rowKey={(line) => line.sku_code}
            detail={(line) => <LineTags line={line} />}
            empty="The node holds no lines for this delivery."
          />
        )}
      </div>
      {skipped.length > 0 && <Skipped epcs={skipped} />}
    </div>
  )
}

/// The delivery's own facts — the same in transit and received, so the two
/// sheets read as one record at two moments. The id is in the sheet's header.
function DeliveryFacts({
  delivery,
  className,
}: {
  delivery: StoreInboundDelivery
  className?: string
}) {
  return (
    <Facts className={className}>
      <Fact term="Surat jalan">
        {delivery.shipment_reference ?? (
          <span className="text-mute">None given</span>
        )}
      </Fact>
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

/// The per-item columns. The four figures are the desk's; a phone gets the
/// difference as a pill and the two counts as one line.
function lineColumns(
  bySku: ReadonlyMap<string, CatalogRow>,
): readonly ListColumn<StoreInboundLine>[] {
  const figure = (value: number, tone?: string) => (
    <span className={cn("tabular-nums", value === 0 ? "text-mute" : tone)}>
      {count(value)}
    </span>
  )
  return [
    {
      id: "item",
      header: "Item",
      className: "max-w-[15rem]",
      cell: (line) => {
        const name = line.name ?? bySku.get(line.sku_code)?.name ?? null
        return (
          <span className="block min-w-0">
            <span className="block truncate font-medium text-ink">
              {name ?? "Not in this shop's book"}
            </span>
            <span className="block truncate font-mono text-id font-normal text-body">
              {line.sku_code}
            </span>
          </span>
        )
      },
    },
    {
      id: "expected",
      header: "Sent",
      align: "right",
      card: "hide",
      cell: (line) => figure(line.expected, "text-text"),
    },
    {
      id: "received",
      header: "Counted",
      align: "right",
      card: "hide",
      // Green when more came than was sent, red when fewer, plain when they
      // match.
      cell: (line) => (
        <span
          className={cn(
            "font-medium tabular-nums",
            line.received > line.expected
              ? "text-ok-fg"
              : line.received < line.expected
                ? "text-bad-fg"
                : "text-ink",
          )}
        >
          {count(line.received)}
        </span>
      ),
    },
    {
      // The phone's: one pill for the line's difference. Hidden on a desk,
      // where the two coloured columns already say it.
      id: "difference",
      header: "",
      card: "status",
      className: "hidden",
      cell: (line) =>
        line.missing > 0 ? (
          <Pill tone="bad">{count(line.missing)} missing</Pill>
        ) : (
          <Pill tone="ok">Complete</Pill>
        ),
    },
    {
      id: "counts",
      header: "",
      card: "meta",
      className: "hidden",
      cell: (line) =>
        `${count(line.received)} of ${count(line.expected)} counted`,
    },
  ]
}

/// What opens under an item: the tags behind its difference. These are what
/// somebody reads out to the DC, or looks for on a rail.
function LineTags({ line }: { line: StoreInboundLine }) {
  if (line.missing_epcs.length === 0) {
    return (
      <p className="pt-1 text-meta text-body">
        Everything was counted.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-3.5 pt-1">
      {line.missing_epcs.length > 0 && (
        <TagList
          title="Missing — packed, not found"
          tone="text-bad-fg"
          epcs={line.missing_epcs}
        />
      )}
    </div>
  )
}

function TagList({
  title,
  tone,
  epcs,
}: {
  title: string
  tone: string
  epcs: readonly string[]
}) {
  return (
    <div>
      <div className={cn("mb-1.5 text-meta font-medium", tone)}>
        {title} · <span className="tabular-nums">{count(epcs.length)}</span>
      </div>
      <ul className="grid gap-x-4 gap-y-1 rounded-inner border border-hairline bg-canvas px-3 py-2 lg:grid-cols-2">
        {epcs.map((epc) => (
          <li key={epc} className="min-w-0">
            <Code>{epc}</Code>
          </li>
        ))}
      </ul>
    </div>
  )
}

/// Tags the handheld read and the node did not count either way. Folded,
/// because they are rarely what anybody came to the sheet for — but said,
/// because a number that quietly left some tags out is a number nobody can
/// check.
function Skipped({ epcs }: { epcs: readonly string[] }) {
  return (
    <details className="group mt-6 rounded-inner border border-hairline">
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

/// What a delivery's row unfolds to: its items, or the count to take.
export function DeliveryDetail({ delivery }: { delivery: StoreInboundDelivery }) {
  return delivery.status === "RECEIVED" ? (
    <Received delivery={delivery} />
  ) : (
    <InTransit delivery={delivery} />
  )
}
