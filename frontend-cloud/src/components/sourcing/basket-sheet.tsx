import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import { useBasketSheet } from "@/lib/sheets/system"
import { cn } from "@/lib/utils"
import { ShoppingBasket } from "lucide-react"
import { BasketPanel } from "./basket-view"

/// The basket, opened over whatever the buyer was looking at.
///
/// It was a nav destination, which is the wrong shape for it: picking things
/// out and looking at what you have picked are one activity, and a route change
/// discards the scroll position and the filters that made the picking possible.
/// A sheet keeps the range behind it, so closing the basket returns to exactly
/// the shelf the buyer was standing at.
///
/// No trigger and no props: it is mounted once by `GlobalSheets` and opens
/// because `?basket` is in the URL. That is what lets the rail open it from a
/// screen it is not an ancestor of, and what makes a half-filled basket
/// something a buyer can send to a colleague.
///
/// It keeps the raw sheet rather than `SheetShell` because `BasketPanel`
/// brings its own header — the same panel is the whole of the `/basket` route,
/// where that header is the screen's.
export function BasketSheet() {
  const sheet = useBasketSheet()
  return (
    <Sheet open={sheet.isOpen} onOpenChange={(open) => !open && sheet.close()}>
      <SheetContent side="right" className="sm:max-w-xl">
        {/* The panel brings its own header; these name the sheet for a screen
            reader, which the visible heading alone does not do. */}
        <SheetTitle className="sr-only">Basket</SheetTitle>
        <SheetDescription className="sr-only">
          What you have picked out, grouped by the supplier each order will go
          to.
        </SheetDescription>
        <BasketPanel />
      </SheetContent>
    </Sheet>
  )
}

export function BasketRailIcon({ pieces }: { pieces: number }) {
  return (
    <>
      <ShoppingBasket
        className={cn("size-5", pieces > 0 && "text-[var(--os-accent,#059669)]")}
      />
      {pieces > 0 && (
        <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-[var(--os-accent,#059669)] px-1 font-mono text-[10px] leading-4 font-medium text-white">
          {pieces}
        </span>
      )}
    </>
  )
}
