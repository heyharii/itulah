import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useBasketActions } from "@/lib/basket"
import { money } from "@/lib/money"
import { ApiError } from "@itulah/contract/client"
import { Check, Minus, Plus, ShoppingBasket } from "lucide-react"
import { useState } from "react"
import { StatusDot, Tag } from "./columns"
import type { SourcingRow } from "./rows"

/// One candidate, looked at properly.
///
/// The list is for comparing; this is for deciding. It shows the things a
/// buyer needs before committing a quantity and that the row has no room for —
/// the photo at a size you can judge a garment by, the supplier's own
/// description, the full tag set, and whether head office has matched it to one
/// of our articles yet.
export function ItemDetail({
  row,
  inBasket,
  onClose,
}: {
  row: SourcingRow | null
  /// How many of this are already in the basket, so the button can say "add
  /// more" rather than pretending the basket is empty.
  inBasket: number
  onClose: () => void
}) {
  if (row === null) return null
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] gap-0 overflow-auto p-0 sm:max-w-3xl">
        {/* Keyed by the item, so opening a second one starts from a fresh
            quantity and a fresh confirmation rather than inheriting the last
            item's. A different item is a different decision. */}
        <Body key={row.id} row={row} inBasket={inBasket} />
      </DialogContent>
    </Dialog>
  )
}

function Body({ row, inBasket }: { row: SourcingRow; inBasket: number }) {
  const { add } = useBasketActions()
  const [quantity, setQuantity] = useState(1)
  const [added, setAdded] = useState(false)
  const onHold = row.status !== "ACTIVE"

  return (
    <>
        <div className="grid gap-0 sm:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <div className="bg-muted">
            {row.image === null ? (
              <div className="text-muted-foreground grid aspect-4/5 place-items-center text-xs">
                no photo
              </div>
            ) : (
              <img
                src={row.image}
                alt={row.name}
                className="aspect-4/5 w-full object-cover"
              />
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-3 p-5">
            <div className="min-w-0">
              <DialogTitle className="text-base leading-tight font-semibold">
                {row.name}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground pt-1 font-mono text-[11px]">
                {row.code}
              </DialogDescription>
            </div>

            <div className="font-mono text-2xl font-semibold tabular-nums">
              {money(row.price, row.currency)}
              <span className="text-muted-foreground pl-1.5 font-sans text-[11px] font-normal">
                per piece, as quoted
              </span>
            </div>

            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
              <Row label="Supplier">
                {row.supplier}
                <span className="text-muted-foreground pl-1.5 font-mono text-[10.5px]">
                  {row.supplierCode}
                </span>
              </Row>
              <Row label="Division">{row.division}</Row>
              <Row label="Status">
                <StatusDot status={row.status} />
              </Row>
              <Row label="Our article">
                {row.article ?? (
                  // Not an error and not "none": nobody has matched this
                  // supplier's item to one of our own articles yet, which is
                  // the normal state for something newly offered.
                  <span className="text-muted-foreground">not matched yet</span>
                )}
              </Row>
            </dl>

            {row.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {row.tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </div>
            )}

            {row.description !== null && (
              <p className="text-muted-foreground text-xs leading-relaxed">{row.description}</p>
            )}

            <div className="mt-auto flex flex-col gap-2 pt-2">
              {inBasket > 0 && (
                <p className="text-muted-foreground text-[11px]">
                  {inBasket} already in your basket.
                </p>
              )}
              {onHold ? (
                <p className="text-[11.5px] text-amber-600">
                  This item is on hold, so it cannot go on an order. The supplier has to put
                  it back in line first.
                </p>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-sm"
                      variant="outline"
                      aria-label="One fewer"
                      onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                    >
                      <Minus className="size-3.5" />
                    </Button>
                    <Input
                      value={quantity}
                      inputMode="numeric"
                      aria-label="Quantity to add"
                      onChange={(event) => {
                        const parsed = Number.parseInt(event.target.value, 10)
                        setQuantity(Number.isFinite(parsed) && parsed > 0 ? parsed : 1)
                      }}
                      className="h-8 w-16 text-center font-mono text-xs"
                    />
                    <Button
                      size="icon-sm"
                      variant="outline"
                      aria-label="One more"
                      onClick={() => setQuantity((current) => current + 1)}
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  </div>
                  <Button
                    className="flex-1"
                    disabled={add.isPending}
                    onClick={() => {
                      add.mutate(
                        { supplier_item_id: row.id, quantity },
                        { onSuccess: () => setAdded(true) },
                      )
                    }}
                  >
                    {added ? (
                      <>
                        <Check className="size-3.5" />
                        In the basket
                      </>
                    ) : (
                      <>
                        <ShoppingBasket className="size-3.5" />
                        {add.isPending ? "Adding…" : "Add to basket"}
                      </>
                    )}
                  </Button>
                </div>
              )}
              {add.isError && (
                <p className="text-destructive text-[11.5px]">
                  {add.error instanceof ApiError
                    ? add.error.message
                    : "It could not be added to the basket."}
                </p>
              )}
              <p className="text-muted-foreground text-[10.5px]">
                Adding does not order anything. An order is raised from the basket, per
                supplier, and priced by the server from this catalogue.
              </p>
            </div>
          </div>
        </div>
    </>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </>
  )
}
