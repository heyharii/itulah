import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, ScanLine, X } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox, Input, Textarea } from "@/components/ui/field"
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
import { count, day, quantity, sku as skuNumber } from "@/lib/format"
import { keys } from "@/lib/operations/keys"
import { useEdgeActor } from "@/lib/edge-session"
import { useShopName } from "@/components/operations/outbound-papers"
import { cn } from "@/lib/utils"
import { COUNT_HEAD, COUNT_ROW } from "@/screens/operations/intake/receiving"
import { TwoLines } from "@/screens/operations/two-lines"
import { idempotencyKey } from "@itulah/contract/client"
import type { StoreInboundManifestItem } from "@itulah/contract"

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
  const shop = useShopName()
  const [epcs, setEpcs] = useState("")
  /// Owner, 29 Sep 2026: receiving needs no RFID. "By count" is the default —
  /// a blind count per SKU, scanned or typed — with "By handheld" kept for a
  /// bay that still sweeps EPCs.
  const [mode, setMode] = useState<"count" | "epcs">("count")
  const [justReceived, setJustReceived] = useState(false)
  /// The blind count, by SKU: held here so its Submit sits in the foot, as
  /// Receiving PO's does.
  const [counts, setCounts] = useState<Readonly<Record<string, number>>>({})

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

  const receiveByCount = useMutation({
    mutationFn: () =>
      dc.receiveInboundByCount(id!, {
        counts: Object.entries(counts).map(([sku_code, quantity]) => ({
          sku_code,
          quantity,
        })),
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: () => {
      setCounts({})
      afterReceive()
    },
  })

  const delivery = detail.data?.delivery
  const epcCount = epcs
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => value !== "").length
  const counting = delivery?.status === "IN_TRANSIT"
  const byCount = mode === "count"
  const pending = byCount ? receiveByCount.isPending : receive.isPending

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(open) => !open && onClose()}
      id={delivery?.shipment_reference ?? id ?? undefined}
      title={
        delivery === undefined
          ? "Delivery"
          : shop(delivery.source_site_id) || delivery.source_site_id
      }
      width="table"
      footer={
        counting && (
          <div className="flex items-center justify-end gap-3">
            <Button
              variant="primary"
              pending={pending}
              disabled={
                (byCount ? Object.keys(counts).length === 0 : epcCount === 0) ||
                pending
              }
              onClick={() =>
                byCount ? receiveByCount.mutate() : receive.mutate()
              }
            >
              {pending ? "Sending…" : "Submit count"}
            </Button>
          </div>
        )
      }
    >
      {detail.isPending ? (
        <LoadingState>Reading the delivery…</LoadingState>
      ) : delivery === undefined ? (
        <EmptyState>That delivery could not be read.</EmptyState>
      ) : (
        <div className="flex flex-col gap-5">
          <Facts>
            <Fact term="Store">
              {shop(delivery.source_site_id) || delivery.source_site_id}
            </Fact>
            <Fact term="Delivery note">
              {delivery.shipment_reference ?? "—"}
            </Fact>
            <Fact term="Koli">{count(delivery.koli_count)}</Fact>
            <Fact term="Sent on">{day(delivery.departed_at)}</Fact>
          </Facts>

          {counting ? (
            <div className="flex flex-col gap-4">
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
                <>
                  <CountReceive
                    items={detail.data?.manifest_items ?? []}
                    counts={counts}
                    onChange={setCounts}
                  />
                  <Problem error={receiveByCount.error} />
                </>
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
                      className="border-t border-hairline md:h-16"
                    >
                      <td className="py-3.5 pr-2 font-mono text-[0.9375rem] text-ink">
                        {line.name ?? skuNumber(line.sku_code)}
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
              <InspectSection id={id!} />
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}

/// **Inspect** — what this return booked into the store's return pool, piece
/// by piece: good goes back to the racks, a piece ticked damaged to reject
/// (e2e 20 Oct 2026: the Inspect screen was gone, so a store's return stood
/// In review for ever and never reached stock again).
function InspectSection({ id }: { id: string }) {
  const actor = useEdgeActor()
  const client = useQueryClient()
  const [damaged, setDamaged] = useState<ReadonlySet<string>>(new Set())
  const detail = useQuery({
    queryKey: keys.returnInspection(id),
    queryFn: ({ signal }) => dc.returnInspection(id, signal),
  })
  const inspect = useMutation({
    mutationFn: () =>
      dc.inspectReturn(id, {
        damaged_epcs: Array.from(damaged),
        epcs: null,
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: () => {
      setDamaged(new Set())
      void client.invalidateQueries({ queryKey: keys.returnInspections() })
      void client.invalidateQueries({ queryKey: keys.returnInspection(id) })
      void client.invalidateQueries({ queryKey: keys.storeInbound("ALL") })
      void client.invalidateQueries({ queryKey: keys.pools() })
    },
  })
  const units = detail.data?.units ?? []
  if (units.length === 0 && !inspect.isSuccess) return null
  const good = units.length - damaged.size
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-[0.9375rem] font-semibold text-ink">
        Inspect <span className="font-normal text-mute">{count(units.length)}</span>
      </h3>
      {units.length > 0 && (
        <div className="flex flex-col divide-y divide-hairline rounded-inner border border-hairline">
          {units.map((unit) => (
            <div
              key={unit.epc}
              className="flex items-center justify-between gap-3 px-3.5 py-2.5"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-ink">
                  {unit.name ?? skuNumber(unit.sku_code)}
                </span>
                <span className="truncate font-mono text-mute">
                  {skuNumber(unit.sku_code)}
                </span>
              </span>
              <Checkbox
                label="Damaged"
                checked={damaged.has(unit.epc)}
                onChange={(checked) =>
                  setDamaged((now) => {
                    const next = new Set(now)
                    if (checked) next.add(unit.epc)
                    else next.delete(unit.epc)
                    return next
                  })
                }
              />
            </div>
          ))}
        </div>
      )}
      {inspect.isSuccess && (
        <Receipt>
          {count(inspect.data.good_units)} back to the racks
          {inspect.data.damaged_units > 0 &&
            `, ${count(inspect.data.damaged_units)} to reject`}
          .
        </Receipt>
      )}
      <Problem error={inspect.error} />
      {units.length > 0 && (
        <Button
          variant="primary"
          disabled={inspect.isPending}
          onClick={() => inspect.mutate()}
        >
          {damaged.size === 0
            ? `Put ${count(good)} back on the racks`
            : `Racks ${count(good)} · reject ${count(damaged.size)}`}
        </Button>
      )}
    </section>
  )
}

/// Receive a return without a reader: a blind count per SKU, scanned or
/// typed, set out as Receiving PO's count is — one table, and the total in a
/// box at the right. Never shown what was sent, only what has been counted
/// (owner, 29 Sep 2026: receiving needs no RFID).
function CountReceive({
  items,
  counts,
  onChange,
}: {
  /// The articles the return carries — what, never how many.
  items: readonly StoreInboundManifestItem[]
  counts: Readonly<Record<string, number>>
  onChange: (next: Readonly<Record<string, number>>) => void
}) {
  const [entry, setEntry] = useState("")
  /// The scan box for pieces the return did not list, opened on demand.
  const [adding, setAdding] = useState(items.length === 0)

  const setQty = (sku: string, qty: number) => {
    if (qty <= 0) {
      if (counts[sku] === undefined) return
      const rest = { ...counts }
      delete rest[sku]
      onChange(rest)
      return
    }
    if (counts[sku] !== qty) onChange({ ...counts, [sku]: qty })
  }

  const addOne = () => {
    const sku = entry.trim().toUpperCase()
    if (sku === "") return
    onChange({ ...counts, [sku]: (counts[sku] ?? 0) + 1 })
    setEntry("")
  }

  const lines = Object.entries(counts)
  const total = lines.reduce((sum, [, qty]) => sum + qty, 0)
  /// The return's own articles first, each with an empty box, then whatever
  /// was scanned that the return did not list.
  const listed = new Set(items.map((item) => item.sku_code))
  const rows = [
    ...items.map((item) => ({ ...item, listed: true })),
    ...lines
      .filter(([sku]) => !listed.has(sku))
      .map(([sku_code]) => ({
        sku_code,
        name: null,
        color: null,
        size: null,
        listed: false,
      })),
  ]

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* Set out as Receiving PO's count: one grid, header and rows sharing
          the same three tracks — what, what was counted, in pieces. */}
      <Card className="overflow-hidden">
        <div
          className={cn(
            COUNT_ROW,
            "h-10 items-center border-b border-hairline bg-soft"
          )}
        >
          <span className={COUNT_HEAD}>Article</span>
          <span className={cn(COUNT_HEAD, "max-sm:hidden")}>Counted</span>
          <span className={cn(COUNT_HEAD, "text-right")}>In pieces</span>
        </div>
        <div className="divide-y divide-hairline">
          {rows.map((row) => {
            const qty = counts[row.sku_code]
            return (
              <div key={row.sku_code} className={cn(COUNT_ROW, "py-3.5")}>
                {row.name !== null ? (
                  <TwoLines
                    top={row.name}
                    bottom={[skuNumber(row.sku_code), row.color, row.size]
                      .filter((part) => part)
                      .join(" · ")}
                    className="min-h-11"
                  />
                ) : (
                  <span className="flex min-h-11 items-center truncate font-mono text-ink">
                    {skuNumber(row.sku_code)}
                  </span>
                )}
                <div className="flex items-center gap-2 max-sm:order-last max-sm:col-span-2">
                  <Input
                    className="h-11 w-24 text-center font-semibold"
                    inputMode="numeric"
                    autoComplete="off"
                    aria-label={`Counted ${skuNumber(row.sku_code)}`}
                    value={qty === undefined ? "" : String(qty)}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, "")
                      setQty(row.sku_code, digits === "" ? 0 : Number(digits))
                    }}
                  />
                  <span className="w-28 text-[0.9375rem] text-body">pcs</span>
                  {!row.listed && (
                    <Button
                      variant="quiet"
                      size="sm"
                      aria-label={`Remove ${skuNumber(row.sku_code)}`}
                      onClick={() => setQty(row.sku_code, 0)}
                    >
                      <X />
                    </Button>
                  )}
                </div>
                <span
                  className={cn(
                    "flex min-h-11 items-center justify-end text-right tabular-nums",
                    qty === undefined ? "text-mute" : "font-medium text-ink"
                  )}
                >
                  {qty === undefined ? "—" : `${count(qty)} pcs`}
                </span>
              </div>
            )
          })}
          {/* What came back that the return did not list: scanned or typed,
              as Receiving PO's Not as Ordered. */}
          {adding ? (
            <div className="px-4 py-3">
              <div className="relative w-full md:w-96">
                <ScanLine
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mute"
                />
                <Input
                  autoFocus
                  autoCapitalize="off"
                  autoCorrect="off"
                  aria-label="Scan a barcode or type a SKU"
                  placeholder="Scan a barcode or type a SKU"
                  value={entry}
                  onChange={(event) => setEntry(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return
                    event.preventDefault()
                    addOne()
                  }}
                  className="pl-9"
                />
              </div>
            </div>
          ) : (
            <div className="px-2 py-1.5">
              <Button variant="quiet" size="sm" onClick={() => setAdding(true)}>
                <Plus />
                Not on the list
              </Button>
            </div>
          )}
        </div>
      </Card>

      <div className="flex justify-end">
        <dl className="grid w-full grid-cols-[1fr_auto] gap-x-12 rounded-card border border-hairline bg-soft px-5 py-2 tabular-nums md:w-auto md:min-w-[22rem]">
          <dt className="flex min-h-11 items-center text-[1rem] font-medium text-ink">
            Total counted
          </dt>
          <dd className="flex min-h-11 items-center justify-end text-right text-[1.0625rem] font-semibold text-ink">
            {quantity(total)}
          </dd>
        </dl>
      </div>
    </div>
  )
}
