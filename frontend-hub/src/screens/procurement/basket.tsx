import { useForm, useStore } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Trash2 } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardStrip } from "@/components/ui/card"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { MiniTable, TotalsLadder } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { count, money } from "@/lib/format"
import {
  clearBasket,
  createCatalogPurchaseOrder,
  procurementKeys,
  purchaseDestinations,
  readBasket,
  removeFromBasket,
  setBasketQuantity,
  type CatalogPurchaseOrderReceipt,
} from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { LinkButton } from "@/screens/procurement/controls"
import { useIdempotencyKey } from "@/screens/procurement/shared"
import type { BasketLine } from "@itulah/contract"

/// The basket: picked out, not yet ordered.
///
/// Kept by the server rather than in `localStorage`, which is why there is a
/// screen for it at all — a basket in a browser is a property of a machine, does
/// not follow anyone to a second desk, and cannot be seen by the person asked to
/// approve it. Every route here is scoped to the caller by the session, so no
/// request names a user and none can reach anyone else's.
///
/// A purchase order belongs to ONE supplier, so the basket is grouped by
/// supplier and each group is a separate order. That is not a display choice: a
/// PO with two suppliers on it is not a document anybody can send.

/// One supplier's worth of basket.
interface Group {
  readonly supplierId: string
  readonly supplierName: string
  readonly lines: readonly BasketLine[]
  readonly pieces: number
  readonly value: number
}

function groupBySupplier(lines: readonly BasketLine[]): readonly Group[] {
  const groups = new Map<string, BasketLine[]>()
  for (const line of lines) {
    const key = line.supplier.supplier_id
    const existing = groups.get(key)
    if (existing) existing.push(line)
    else groups.set(key, [line])
  }
  return [...groups.entries()]
    .map(([supplierId, groupLines]) => ({
      supplierId,
      supplierName: groupLines[0].supplier.name,
      lines: groupLines,
      pieces: groupLines.reduce((sum, line) => sum + line.quantity, 0),
      value: groupLines.reduce(
        (sum, line) => sum + line.quantity * line.item.unit_price_minor,
        0
      ),
    }))
    .sort((a, b) => b.value - a.value)
}

/// What has been picked out, over whatever the buyer was doing.
///
/// It stopped being a screen in the menu: a basket is not a place you navigate
/// to, it is a thing you open, glance at and close without losing the shelf you
/// were standing in front of. `?cart=true` keeps it linkable and survives a
/// reload all the same.
export function BasketSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const composer = useSheet("basket")
  const [receipt, setReceipt] = useState<CatalogPurchaseOrderReceipt | null>(
    null
  )

  const basket = useQuery({
    queryKey: procurementKeys.basket(),
    queryFn: ({ signal }) => readBasket(signal),
  })

  const lines = useMemo(() => basket.data ?? [], [basket.data])
  const groups = useMemo(() => groupBySupplier(lines), [lines])
  const pieces = lines.reduce((sum, line) => sum + line.quantity, 0)
  const value = lines.reduce(
    (sum, line) => sum + line.quantity * line.item.unit_price_minor,
    0
  )

  const settle = () =>
    client.invalidateQueries({ queryKey: procurementKeys.basket() })

  const setQuantity = useMutation({
    mutationFn: ({ id, quantity }: { id: string; quantity: number }) =>
      setBasketQuantity(id, quantity),
    // Only the basket moved. The server's answer is believed rather than
    // predicted: the quantity shown is the quantity stored.
    onSuccess: settle,
  })

  const remove = useMutation({
    mutationFn: (id: string) => removeFromBasket(id),
    onSuccess: settle,
  })

  const empty = useMutation({
    mutationFn: () => clearBasket(),
    onSuccess: settle,
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Basket"
      // Wider than the record rail: the basket carries a five-column table and
      // a four-up strip, and at the default width the item names wrap to three
      // lines while the money column runs off the edge.
      className="w-[52rem]"
      actions={
        <div className="flex items-center gap-1.5">
          <Button
            variant="danger"
            disabled={lines.length === 0 || empty.isPending}
            onClick={() => empty.mutate()}
          >
            <Trash2 />
            Empty
          </Button>
          <Button
            variant="dark"
            disabled={lines.length === 0}
            onClick={() => composer.open(true)}
          >
            Raise an order
          </Button>
        </div>
      }
    >
      {receipt && (
        <Banner tone="ok" className="mb-4" onDismiss={() => setReceipt(null)}>
          {receipt.po_number} raised for {money(receipt.net_minor)} and sent to{" "}
          {receipt.sent_to_origin}.{" "}
          <LinkButton
            to="/procurement/orders"
            sheet={{ key: "order", value: receipt.purchase_order_id }}
            className="ml-1 h-6 px-2 text-[0.71875rem]"
          >
            Open it
          </LinkButton>
        </Banner>
      )}

      {(empty.isError || setQuantity.isError || remove.isError) && (
        <Banner tone="bad" className="mb-4">
          {
            ((empty.error ?? setQuantity.error ?? remove.error) as Error)
              .message
          }
        </Banner>
      )}

      <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
        <Kpi label="Suppliers" value={count(groups.length)} />
        <Kpi label="Lines" value={count(lines.length)} />
        <Kpi label="Pieces" value={count(pieces)} />
        <Kpi label="At catalogue prices" value={money(value)} />
      </KpiStrip>

      {queryState(basket, {
        loading: "Reading the basket…",
        render: () =>
          groups.length === 0 ? (
            <Card>
              <EmptyState
                action={
                  <LinkButton to="/procurement">Go to sourcing</LinkButton>
                }
              >
                Nothing has been picked out yet.
              </EmptyState>
            </Card>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map((group) => (
                <Card key={group.supplierId} className="overflow-hidden">
                  <CardStrip>
                    <span className="flex-1 text-card-title font-semibold text-ink">
                      {group.supplierName}
                    </span>
                    <span className="text-[0.75rem] text-mute tabular-nums">
                      {count(group.pieces)} pieces · {money(group.value)}
                    </span>
                  </CardStrip>
                  <div className="px-4 py-3.5">
                    <MiniTable head={["Item", "Unit", "Qty", "Value", ""]}>
                      {group.lines.map((line) => (
                        <tr
                          key={line.item.supplier_item_id}
                          className="border-t border-hairline"
                        >
                          <td className="py-2 pr-2">
                            <span className="block text-[0.8125rem] text-ink">
                              {line.item.name}
                            </span>
                            <span className="font-mono text-[0.65625rem] text-mute">
                              {line.item.supplier_item_code}
                            </span>
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {money(line.item.unit_price_minor)}
                          </td>
                          <td className="py-2 text-right">
                            <Input
                              type="number"
                              min={0}
                              defaultValue={line.quantity}
                              // Zero takes the line out, which is what the
                              // server does with it — there is no "quantity 0"
                              // line to draw.
                              onBlur={(event) => {
                                const next = Number.parseInt(
                                  event.target.value,
                                  10
                                )
                                if (
                                  Number.isFinite(next) &&
                                  next >= 0 &&
                                  next !== line.quantity
                                ) {
                                  setQuantity.mutate({
                                    id: line.item.supplier_item_id,
                                    quantity: next,
                                  })
                                }
                              }}
                              className="ml-auto h-7 w-16 text-right"
                              aria-label={`Pieces of ${line.item.name}`}
                            />
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {money(line.quantity * line.item.unit_price_minor)}
                          </td>
                          <td className="py-2 pl-2 text-right">
                            <Button
                              variant="quiet"
                              size="sm"
                              aria-label={`Take ${line.item.name} out`}
                              disabled={remove.isPending}
                              onClick={() =>
                                remove.mutate(line.item.supplier_item_id)
                              }
                            >
                              <Trash2 />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </MiniTable>
                  </div>
                </Card>
              ))}
            </div>
          ),
      })}

      <Composer
        open={composer.value === true}
        groups={groups}
        onClose={composer.close}
        onRaised={(raised) => {
          setReceipt(raised)
          composer.close()
        }}
      />
    </Sheet>
  )
}

/// Turning one supplier's basket into a purchase order.
///
/// Prices are not sent. The server snapshots each line from the supplier item
/// it names, so a buyer cannot order at a price the catalogue does not hold —
/// which is also why there is nothing to edit here but the discount, the
/// destination and the number the order will be known by.
interface OrderDraft {
  supplierId: string
  poNumber: string
  destination: string
  discount: string
  notes: string
}

/// A discount is whole rupiah off the order, or nothing at all. A negative or
/// unreadable one is not a surcharge — it is a typo, and it comes to zero.
function discountOf(text: string): number {
  const off = Number.parseInt(text, 10)
  return Number.isFinite(off) && off > 0 ? off : 0
}

function Composer({
  open,
  groups,
  onClose,
  onRaised,
}: {
  open: boolean
  groups: readonly Group[]
  onClose: () => void
  onRaised: (receipt: CatalogPurchaseOrderReceipt) => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()

  const destinations = useQuery({
    queryKey: procurementKeys.destinations(),
    queryFn: ({ signal }) => purchaseDestinations(signal),
    enabled: open,
  })

  /// Which basket the order is being raised from. An unchosen supplier means
  /// the first one, which is the whole basket when there is only ever one.
  const groupFor = (supplierId: string) =>
    groups.find((each) => each.supplierId === supplierId) ?? groups[0]

  const raise = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: OrderDraft) => {
      const group = groupFor(draft.supplierId)
      const discountMinor = discountOf(draft.discount)
      return createCatalogPurchaseOrder(
        {
          po_number: draft.poNumber.trim(),
          supplier_id: group.supplierId,
          // Absent takes the node's configured default, which is the ordinary
          // case while the company runs one DC.
          destination_site_id:
            draft.destination === "" ? null : draft.destination,
          notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
          discount_minor: discountMinor === 0 ? null : discountMinor,
          lines: group.lines.map((line) => ({
            supplier_item_id: line.item.supplier_item_id,
            quantity: line.quantity,
            promised_date: null,
            unit_price_minor: null,
            article_name: null,
            image_url: null,
            division_code: null,
            tags: null,
          })),
        },
        idempotency.key
      )
    },
    onSuccess: (receipt) => {
      // The order exists, so the order book changed; the lines that became it
      // are no longer in the basket. Both, named — not a blanket prefix.
      void client.invalidateQueries({ queryKey: procurementKeys.orders() })
      void client.invalidateQueries({ queryKey: procurementKeys.basket() })
      idempotency.rotate()
      // Everything that belongs to this one order. The supplier and the
      // destination are where the next order is raised from too.
      form.setFieldValue("poNumber", "")
      form.setFieldValue("notes", "")
      form.setFieldValue("discount", "")
      onRaised(receipt)
    },
  })

  const form = useForm({
    defaultValues: {
      supplierId: "",
      poNumber: "",
      destination: "",
      discount: "",
      notes: "",
    } as OrderDraft,
    onSubmit: ({ value }) => raise.mutate(value),
  })

  // Subscribed rather than read off `form.state`: the sheet's own header names
  // the supplier, and a value read during render without subscribing would go
  // stale the moment somebody picked a different basket.
  const supplierId = useStore(form.store, (state) => state.values.supplierId)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Raise an order"
      id={groupFor(supplierId)?.supplierName}
      footer={
        <form.Subscribe
          selector={(state) =>
            groupFor(state.values.supplierId) !== undefined &&
            state.values.poNumber.trim() !== ""
          }
        >
          {(ready) => (
            <Button
              variant="dark"
              className="w-full"
              disabled={!ready || raise.isPending}
              onClick={() => form.handleSubmit()}
            >
              {raise.isPending ? "Raising…" : "Raise the order"}
            </Button>
          )}
        </form.Subscribe>
      }
    >
      <form.Subscribe
        selector={(state) => ({
          supplierId: state.values.supplierId,
          discount: state.values.discount,
        })}
      >
        {(chosen) => {
          const group = groupFor(chosen.supplierId)
          const discountMinor = discountOf(chosen.discount)
          return group === undefined ? (
            <EmptyState>
              The basket is empty, so there is no order to raise.
            </EmptyState>
          ) : (
            <form
              // The button is in the sheet's footer, outside this element, so
              // its disabled state cannot block an Enter keypress.
              onSubmit={(event) => {
                event.preventDefault()
                if (
                  form.state.values.poNumber.trim() !== "" &&
                  !raise.isPending
                ) {
                  form.handleSubmit()
                }
              }}
              className="flex flex-col gap-4"
            >
              {raise.isError && (
                <Banner tone="bad">{(raise.error as Error).message}</Banner>
              )}

              <form.Field name="supplierId">
                {(field) => (
                  <Field
                    label="Supplier"
                    hint="One order, one supplier. A PO with two suppliers on it is not a document anybody can send."
                  >
                    <Select
                      value={group.supplierId}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                    >
                      {groups.map((each) => (
                        <option key={each.supplierId} value={each.supplierId}>
                          {each.supplierName} — {each.lines.length} lines
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </form.Field>

              <form.Field name="poNumber">
                {(field) => (
                  <Field
                    label="PO number"
                    hint="What the supplier will quote back."
                  >
                    <Input
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      placeholder="PO-2026-0001"
                    />
                  </Field>
                )}
              </form.Field>

              <form.Field name="destination">
                {(field) => (
                  <Field
                    label="Destination"
                    hint="Where the goods land. Leave it on the default while the company runs one DC."
                  >
                    <Select
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                    >
                      <option value="">The node's default</option>
                      {(destinations.data ?? []).map((each) => (
                        <option key={each.site_id} value={each.site_id}>
                          {each.label} ({each.node_role})
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </form.Field>

              <form.Field name="discount">
                {(field) => (
                  <Field
                    label="Discount"
                    hint="Agreed off the whole order, in rupiah. On the order rather than the lines, because that is how it is negotiated and how an invoice states it."
                  >
                    <Input
                      type="number"
                      min={0}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      placeholder="0"
                    />
                  </Field>
                )}
              </form.Field>

              <form.Field name="notes">
                {(field) => (
                  <Field label="Notes">
                    <Textarea
                      rows={3}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      placeholder="Anything the warehouse should know."
                    />
                  </Field>
                )}
              </form.Field>

              <div>
                <h4 className="mb-2 text-card-title font-semibold text-ink">
                  Lines
                </h4>
                <MiniTable head={["Item", "Qty", "Value"]}>
                  {group.lines.map((line) => (
                    <tr
                      key={line.item.supplier_item_id}
                      className="border-t border-hairline"
                    >
                      <td className="py-2 pr-2 text-[0.8125rem] text-ink">
                        {line.item.name}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {count(line.quantity)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {money(line.quantity * line.item.unit_price_minor)}
                      </td>
                    </tr>
                  ))}
                </MiniTable>
                <TotalsLadder
                  className="mt-3"
                  rows={[
                    { label: "At catalogue prices", value: money(group.value) },
                    { label: "Discount", value: money(-discountMinor) },
                  ]}
                  total={{
                    label: "The supplier will invoice",
                    value: money(group.value - discountMinor),
                  }}
                />
              </div>
            </form>
          )
        }}
      </form.Subscribe>
    </Sheet>
  )
}
