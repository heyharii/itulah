import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input, Textarea } from "@/components/ui/field"
import { MiniTable } from "@/components/ui/rows"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import {
  EmptyState,
  LoadingState,
  Problem,
  Receipt,
} from "@/components/ui/states"
import { dc } from "@/lib/api"
import { SHOW_MISSING } from "@/lib/features"
import { count, day, quantity } from "@/lib/format"
import { keys } from "@/lib/operations/keys"
import { useEdgeActor } from "@/lib/edge-session"
import { idempotencyKey } from "@itulah/contract/client"

/// The receive flow for a store's return, shared by the two screens that open
/// one: Receiving's return tab and the return-from-store board. One delivery:
/// blind while IN_TRANSIT, its per-SKU comparison once RECEIVED.
export function DeliverySheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const actor = useEdgeActor()
  const client = useQueryClient()
  const [epcs, setEpcs] = useState("")
  /// Owner, 29 Sep 2026: receiving needs no RFID. "By count" is the default —
  /// a blind count per SKU, scanned or typed — with "By handheld" kept for a
  /// bay that still sweeps EPCs.
  const [mode, setMode] = useState<"count" | "epcs">("count")
  const [justReceived, setJustReceived] = useState(false)

  const detail = useQuery({
    queryKey: keys.storeInboundDetail(id ?? ""),
    queryFn: ({ signal }) => dc.storeInboundDetail(id!, signal),
    enabled: id !== null,
  })

  const afterReceive = () => {
    setJustReceived(true)
    void client.invalidateQueries({ queryKey: keys.storeInbound("ALL") })
    void client.invalidateQueries({
      queryKey: keys.storeInbound("IN_TRANSIT"),
    })
    void client.invalidateQueries({ queryKey: keys.storeInbound("RECEIVED") })
    void client.invalidateQueries({ queryKey: keys.storeInboundDetail(id!) })
    void client.invalidateQueries({ queryKey: keys.pools() })
  }

  const receive = useMutation({
    mutationFn: () =>
      dc.receiveStoreInbound(id!, {
        epcs: epcs
          .split(/[\s,]+/)
          .map((value) => value.trim().toUpperCase())
          .filter((value) => value !== ""),
        actor_id: actor,
        // One receipt per delivery: applied twice would book every tag a
        // second time, which is why the handheld's own retry uses the same
        // key rather than minting a new one.
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: afterReceive,
  })

  const delivery = detail.data?.delivery
  const epcCount = epcs
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => value !== "").length

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(open) => !open && onClose()}
      id={delivery?.shipment_reference ?? id ?? undefined}
      title={
        delivery === undefined ? "Delivery" : `From ${delivery.source_site_id}`
      }
    >
      {detail.isPending ? (
        <LoadingState>Reading the delivery…</LoadingState>
      ) : delivery === undefined ? (
        <EmptyState>That delivery could not be read.</EmptyState>
      ) : (
        <div className="flex flex-col gap-5">
          <Facts>
            <Fact term="Store">{delivery.source_site_id}</Fact>
            <Fact term="Delivery note">
              {delivery.shipment_reference ?? "—"}
            </Fact>
            <Fact term="Cartons">{count(delivery.koli_count)}</Fact>
            <Fact term="Sent on">{day(delivery.departed_at)}</Fact>
          </Facts>

          {delivery.status === "IN_TRANSIT" ? (
            <div className="flex flex-col gap-3">
              <Toolbar>
                <Segmented
                  options={
                    [
                      { value: "count", label: "By count" },
                      { value: "epcs", label: "By handheld" },
                    ] as const
                  }
                  value={mode}
                  onChange={setMode}
                />
              </Toolbar>
              {mode === "count" ? (
                <CountReceive id={id!} onReceived={afterReceive} />
              ) : (
                <>
                  <Textarea
                    value={epcs}
                    onChange={(event) => setEpcs(event.target.value)}
                    rows={8}
                  />
                  <p className="text-meta text-mute">
                    {count(epcCount)} tag{epcCount === 1 ? "" : "s"} read
                  </p>
                  <Problem error={receive.error} />
                  <Button
                    variant="primary"
                    disabled={epcCount === 0 || receive.isPending}
                    onClick={() => receive.mutate()}
                  >
                    Submit count
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {justReceived && (
                <Receipt>This delivery is recorded as received.</Receipt>
              )}
              <div>
                <MiniTable
                  head={[
                    "SKU",
                    "Expected",
                    "Received",
                    ...(SHOW_MISSING ? ["Missing"] : []),
                    "Extra",
                  ]}
                >
                  {(detail.data?.lines ?? []).map((line) => (
                    <tr
                      key={line.sku_code}
                      className="h-16 border-t border-hairline"
                    >
                      <td className="py-3.5 pr-2 font-mono text-[0.875rem] text-ink">
                        {line.name ?? line.sku_code}
                      </td>
                      <td className="py-3.5 text-right">
                        {count(line.expected)}
                      </td>
                      <td className="py-3.5 text-right">
                        {count(line.received)}
                      </td>
                      {SHOW_MISSING && (
                        <td className="py-3.5 text-right">
                          {line.missing > 0 ? (
                            <span className="text-warn">
                              {count(line.missing)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      )}
                      <td className="py-3.5 text-right">
                        {line.extra > 0 ? (
                          <span className="text-warn">{count(line.extra)}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </MiniTable>
              </div>
              {(detail.data?.skipped_epcs.length ?? 0) > 0 && (
                <p className="text-meta text-mute">
                  {count(detail.data!.skipped_epcs.length)} tag
                  {detail.data!.skipped_epcs.length === 1 ? "" : "s"} not booked
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}

/// Receive a return without a reader: a blind count per SKU, scanned or
/// typed. Never shown what was sent — only the running total of what this
/// screen has counted so far, exactly as the store app's own count sheet
/// works (owner, 29 Sep 2026: receiving needs no RFID).
function CountReceive({
  id,
  onReceived,
}: {
  id: string
  onReceived: () => void
}) {
  const actor = useEdgeActor()
  const [counts, setCounts] = useState<Readonly<Record<string, number>>>({})
  const [entry, setEntry] = useState("")

  const receive = useMutation({
    mutationFn: () =>
      dc.receiveInboundByCount(id, {
        counts: Object.entries(counts).map(([sku_code, quantity]) => ({
          sku_code,
          quantity,
        })),
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: () => {
      setCounts({})
      onReceived()
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

  const addOne = () => {
    const sku = entry.trim().toUpperCase()
    if (sku === "") return
    setCounts((current) => ({ ...current, [sku]: (current[sku] ?? 0) + 1 }))
    setEntry("")
  }

  const lines = Object.entries(counts)
  const total = lines.reduce((sum, [, qty]) => sum + qty, 0)

  return (
    <div className="flex flex-col gap-3">
      <Input
        autoFocus
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Scan a barcode or type a SKU"
        value={entry}
        onChange={(event) => setEntry(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return
          event.preventDefault()
          addOne()
        }}
      />
      {lines.length === 0 ? (
        <p className="text-meta text-mute">Nothing counted.</p>
      ) : (
        <MiniTable head={["SKU", "Quantity", ""]}>
          {lines.map(([sku, qty]) => (
            <tr key={sku} className="h-16 border-t border-hairline">
              <td className="py-3.5 pr-2 font-mono text-[0.875rem] text-ink">
                {sku}
              </td>
              <td className="py-3.5 pr-2 text-right">
                <Input
                  className="w-20 text-right"
                  inputMode="numeric"
                  aria-label={`Quantity for ${sku}`}
                  value={String(qty)}
                  onChange={(event) => {
                    const digits = event.target.value.replace(/\D/g, "")
                    setQty(sku, digits === "" ? 0 : Number(digits))
                  }}
                />
              </td>
              <td className="py-3.5 text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setQty(sku, 0)}
                >
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </MiniTable>
      )}
      <p className="text-meta text-mute">{quantity(total)} counted</p>
      <Problem error={receive.error} />
      <Button
        variant="primary"
        disabled={lines.length === 0 || receive.isPending}
        onClick={() => receive.mutate()}
      >
        Submit count
      </Button>
    </div>
  )
}
