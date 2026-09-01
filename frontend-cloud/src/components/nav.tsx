import { BasketRailIcon, BasketSheet, useBasketPieces } from "@/components/sourcing/basket-sheet"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { allotmentListKey, listAllotments } from "@/lib/allotments"
import { pendingPriceAmendments } from "@/lib/purchase-orders"
import { cn } from "@/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { Link, useRouterState } from "@tanstack/react-router"
import { ClipboardList, ClipboardX, Shirt, Truck } from "lucide-react"

/// Where the buyer can go, and what is waiting for them there.
///
/// A rail of icons rather than a list of words. The buying surface has five
/// places and a buyer learns them in a day; after that the names are read
/// past, and the width they cost is width the filters and the range do not
/// get. The labels are still there on hover and for a screen reader — this
/// trades reading for space, it does not throw the words away.
///
/// The counts are the point as much as the links are: a basket with something
/// in it and an amendment queue with something in it are both unfinished work,
/// and a rail that only named the screens would make you go and look.
export function Nav() {
  const pieces = useBasketPieces()
  // Polled rather than fetched once: these arrive from a warehouse mid-shift,
  // and a buyer with the screen open should see one appear without reloading.
  const amendments = useQuery({
    queryKey: ["purchase-price-amendments"],
    queryFn: ({ signal }) => pendingPriceAmendments(signal),
    refetchInterval: 60_000,
  })
  const waiting = amendments.data?.length ?? 0
  // The same key and page the Allotments screen asks for, so opening it does
  // not fetch the list a second time.
  const allotments = useQuery({
    queryKey: allotmentListKey(),
    queryFn: ({ signal }) => listAllotments({ limit: 500 }, signal),
    refetchInterval: 60_000,
  })
  // Allotments still holding stock back. A completed one is not unfinished
  // work, and counting it here would make the number never go down.
  const reserving = (allotments.data?.items ?? []).filter(
    (row) => row.remaining_quantity > 0,
  ).length

  // Orders, one order, and a draft are three routes but one place as far as
  // somebody reading the nav is concerned.
  const path = useRouterState({ select: (state) => state.location.pathname })

  return (
    <TooltipProvider>
      <nav className="flex flex-col items-center gap-1 py-2" aria-label="Buying">
        <RailLink to="/" label="Sourcing" icon={<Shirt className="size-5" />} />

        {/* Not a destination. Picking things out and looking at what you have
            picked are one activity, and a route change would discard the
            filters that made the picking possible. */}
        <RailItem label="Basket" active={false}>
          <BasketSheet>
            <button type="button" className={RAIL_BUTTON} aria-label="Basket">
              <BasketRailIcon pieces={pieces} />
            </button>
          </BasketSheet>
        </RailItem>

        <RailLink
          to="/orders"
          label="Purchase orders"
          icon={<ClipboardList className="size-5" />}
          active={path.startsWith("/orders")}
        />
        <RailLink
          to="/allotments"
          label="Allotments"
          icon={<Truck className={cn("size-5", reserving > 0 && "text-amber-600")} />}
          active={path.startsWith("/allotments")}
          count={reserving}
        />
        <RailLink
          to="/amendments"
          label="Price amendments"
          icon={<ClipboardX className={cn("size-5", waiting > 0 && "text-amber-600")} />}
          count={waiting}
        />
      </nav>
    </TooltipProvider>
  )
}

const RAIL_BUTTON =
  "relative grid size-11 place-items-center rounded-2xl transition-all hover:rounded-xl hover:bg-muted"

/// The label, and the pill that marks where you are.
///
/// The indicator sits outside the button rather than on it so it survives the
/// hover shape change, which is what makes the rail feel like a rail and not
/// like five buttons.
function RailItem({
  label,
  active,
  children,
}: {
  label: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className={cn(
          "bg-foreground absolute top-1/2 -left-2 w-1 -translate-y-1/2 rounded-r-full transition-all",
          active ? "h-6 opacity-100" : "h-0 opacity-0",
        )}
      />
      <Tooltip>
        <TooltipTrigger render={children as never} />
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    </div>
  )
}

function RailLink({
  to,
  label,
  icon,
  count,
  active,
}: {
  to: string
  label: string
  icon: React.ReactNode
  count?: number
  /// Overrides the router's own exact match, for an entry that stands for a
  /// family of routes rather than one.
  active?: boolean
}) {
  const path = useRouterState({ select: (state) => state.location.pathname })
  const here = active ?? (to === "/" ? path === "/" : path.startsWith(to))
  return (
    <RailItem label={label} active={here}>
      <Link
        to={to}
        aria-label={label}
        className={cn(RAIL_BUTTON, here && "bg-muted rounded-xl")}
      >
        {icon}
        {count !== undefined && count > 0 && (
          <span className="bg-amber-600 absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full px-1 font-mono text-[10px] leading-4 font-medium text-white">
            {count}
          </span>
        )}
      </Link>
    </RailItem>
  )
}
