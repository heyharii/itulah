import { PoDraftPanel } from "@/components/po/po-draft"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { useState } from "react"

/// Raising an order, over whatever the buyer was looking at.
///
/// A route would be the wrong shape. An order is raised in the middle of
/// looking at the range — the buyer wants to check one more price, add one more
/// line, see what else that supplier offers — and every one of those is a
/// reason to still have the catalogue behind them. The sheet keeps it there,
/// and closing returns to the shelf they were standing at rather than to
/// wherever the router decided.
///
/// Wide on purpose: this is a table with editable rows, not a form. A narrow
/// panel would put the quantity and the price on separate lines and turn
/// checking an order into scrolling one.
export function PoSheet({
  supplierId,
  children,
}: {
  supplierId: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={children as never} />
      <SheetContent side="right" className="w-full sm:max-w-5xl">
        <SheetTitle className="sr-only">Draft purchase order</SheetTitle>
        <SheetDescription className="sr-only">
          The lines, quantities and prices this order will be raised at.
        </SheetDescription>
        {/* Mounted only while open, so each opening starts from the basket as
            it is now rather than from a draft left half-edited an hour ago. */}
        {open && (
          <PoDraftPanel supplierId={supplierId} onLeave={() => setOpen(false)} />
        )}
      </SheetContent>
    </Sheet>
  )
}
