import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { useBasket } from "@/lib/basket"
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
export function BasketSheet({ children }: { children: React.ReactNode }) {
  return (
    <Sheet>
      <SheetTrigger render={children as never} />
      <SheetContent side="right" className="sm:max-w-xl">
        {/* The panel brings its own header; these name the sheet for a screen
            reader, which the visible heading alone does not do. */}
        <SheetTitle className="sr-only">Basket</SheetTitle>
        <SheetDescription className="sr-only">
          What you have picked out, grouped by the supplier each order will go to.
        </SheetDescription>
        <BasketPanel />
      </SheetContent>
    </Sheet>
  )
}

/// How many pieces are waiting, for a trigger that has to say so before it is
/// pressed.
export function useBasketPieces(): number {
  const basket = useBasket()
  return (basket.data ?? []).reduce((sum, line) => sum + line.quantity, 0)
}

export function BasketRailIcon({ pieces }: { pieces: number }) {
  return (
    <>
      <ShoppingBasket className={cn("size-5", pieces > 0 && "text-emerald-600")} />
      {pieces > 0 && (
        <span className="bg-emerald-600 absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full px-1 font-mono text-[10px] leading-4 font-medium text-white">
          {pieces}
        </span>
      )}
    </>
  )
}
