import {
  Sheet,
  SheetBody,
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
///
/// # Why this used to render as a bare list on white
///
/// Three things were missing and they compounded. The sheet portals to
/// `document.body`, outside every `data-cloudhub` subtree, so it resolved none
/// of the `--os-*` properties and none of the `[data-cloudhub]` rules —
/// `.os-card` stopped being a card, and what painted instead were the stale
/// `var(--os-…, #fallback)` second arguments. `SheetContent` now sets the
/// attribute itself, which fixes that for every sheet at once. On top of it
/// this was the deprecated flush square-cornered column rather than the
/// floating panel, and `BasketPanel` passes `card={false}` to `ScreenBody`, so
/// the supplier groups sat at `x=0` against the edge. Hence `float` and the
/// measured 20/18 gutters here.
export function BasketSheet() {
  const sheet = useBasketSheet()
  return (
    <Sheet open={sheet.isOpen} onOpenChange={(open) => !open && sheet.close()}>
      <SheetContent side="right" float>
        {/* The panel brings its own header; these name the sheet for a screen
            reader, which the visible heading alone does not do. */}
        <SheetTitle className="sr-only">Basket</SheetTitle>
        <SheetDescription className="sr-only">
          What you have picked out, grouped by the supplier each order will go
          to.
        </SheetDescription>
        {/* `.drawer-b` — the panel has no gutter of its own, so the sheet
            supplies it. `BasketPanel` is a fragment, so its `ScreenHeader` is
            the first child here: the extra right pad on it is the lane the
            close circle sits in, which is what "Empty basket" collided with. */}
        <SheetBody className="flex flex-col pt-[0.875rem] [&>*:first-child]:pr-8">
          <BasketPanel />
        </SheetBody>
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
