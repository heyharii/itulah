import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Trash2 } from "lucide-react"
import { useMemo } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardStrip } from "@/components/ui/card"
import { Input } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { MiniTable } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { count, money } from "@/lib/format"
import {
  clearBasket,
  procurementKeys,
  readBasket,
  removeFromBasket,
  setBasketQuantity,
} from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { OrderComposer, type Group } from "@/screens/procurement/composer"
import { LinkButton } from "@/screens/procurement/controls"
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
  onReopen,
}: {
  open: boolean
  onClose: () => void
  /// Put the basket back. Raising an order closes it and the composer opens on
  /// top of nothing, so dismissing the composer has to be able to undo that —
  /// otherwise "Raise an order" is a one-way door out of the basket.
  onReopen: () => void
}) {
  const client = useQueryClient()
  const composer = useSheet("basket")

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
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => !next && onClose()}
        title="Basket"
        // Wider than the record rail: the basket carries a five-column table and
        // a four-up strip, and at the default width the item names wrap to three
        // lines while the money column runs off the edge.
        //
        // `wide` and `md:`, for the same reason the composer needs them: the
        // rail's own `md:w-[27.5rem]` beats a bare `w-[52rem]` at every width
        // except a phone's, so this sheet was the rail width it says here it
        // cannot be — item names on three lines, money off the edge, exactly
        // the thing this comment claimed to have fixed.
        width="wide"
        className="md:w-[52rem]"
        actions={
          <div className="flex items-center gap-1.5">
            <Button
              variant="danger"
              pending={empty.isPending}
              disabled={lines.length === 0}
              onClick={() => empty.mutate()}
            >
              <Trash2 />
              Empty
            </Button>
            <Button
              variant="primary"
              disabled={lines.length === 0}
              onClick={() => {
                composer.open(true)
                // The basket gets out of the way. The composer is a wide table
                // somebody edits line by line, and two stacked sheets left it
                // reading the width of a rail with a dead copy of the same
                // basket showing through beside it.
                onClose()
              }}
            >
              Raise an order
            </Button>
          </div>
        }
      >
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
                    <LinkButton to="/procurement/sourcing">
                      Go to sourcing
                    </LinkButton>
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
                      <span className="text-[0.875rem] text-mute tabular-nums">
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
                              <span className="block text-[0.875rem] text-ink">
                                {line.item.name}
                              </span>
                              <span className="font-mono text-[0.875rem] text-mute">
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
                              {money(
                                line.quantity * line.item.unit_price_minor
                              )}
                            </td>
                            <td className="py-2 pl-2 text-right">
                              <Button
                                variant="quiet"
                                size="sm"
                                aria-label={`Take ${line.item.name} out`}
                                pending={remove.isPending}
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
      </Sheet>

      {/* Outside the sheet, not inside it. The basket closes when this opens, and
        a composer nested in the basket's own body would unmount with it. */}
      <OrderComposer
        open={composer.value === true}
        basket={groups}
        onClose={() => {
          composer.close()
          onReopen()
        }}
        onRaised={() => {
          composer.close()
          onReopen()
        }}
      />
    </>
  )
}
