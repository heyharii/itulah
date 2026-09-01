import { useBasket } from "@/lib/basket"
import { pendingPriceAmendments } from "@/lib/purchase-orders"
import { cn } from "@/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { Link, useRouterState } from "@tanstack/react-router"
import { ClipboardList, ClipboardX, Shirt, ShoppingBasket } from "lucide-react"

/// Where the buyer can go, and what is waiting for them there.
///
/// The counts are the point as much as the links are: a basket with something
/// in it and an amendment queue with something in it are both unfinished work,
/// and a nav that only named the screens would make you go and look.
export function Nav() {
  const basket = useBasket()
  const pieces = (basket.data ?? []).reduce((sum, line) => sum + line.quantity, 0)
  // Polled rather than fetched once: these arrive from a warehouse mid-shift,
  // and a buyer with the screen open should see one appear without reloading.
  const amendments = useQuery({
    queryKey: ["purchase-price-amendments"],
    queryFn: ({ signal }) => pendingPriceAmendments(signal),
    refetchInterval: 60_000,
  })
  const waiting = amendments.data?.length ?? 0

  // Orders, one order, and a draft are three routes but one place as far as
  // somebody reading the nav is concerned.
  const path = useRouterState({ select: (state) => state.location.pathname })
  const onOrders = path.startsWith("/orders")

  return (
    <nav className="flex flex-col gap-0.5" aria-label="Buying">
      <NavLink to="/" icon={<Shirt className="size-4" />}>
        Sourcing
      </NavLink>
      <NavLink
        to="/basket"
        icon={<ShoppingBasket className={cn("size-4", pieces > 0 && "text-emerald-600")} />}
        // Pieces, not lines: a basket holding three of one thing is not the
        // same errand as one of three things, and the piece count is what turns
        // into ordered quantity.
        count={pieces}
      >
        Basket
      </NavLink>
      <NavLink to="/orders" icon={<ClipboardList className="size-4" />} active={onOrders}>
        Purchase orders
      </NavLink>
      <NavLink
        to="/amendments"
        icon={<ClipboardX className={cn("size-4", waiting > 0 && "text-amber-600")} />}
        count={waiting}
      >
        Price amendments
      </NavLink>
    </nav>
  )
}

function NavLink({
  to,
  icon,
  count,
  active,
  children,
}: {
  to: string
  icon: React.ReactNode
  count?: number
  /// Overrides the router's own exact match, for a nav entry that stands for a
  /// family of routes rather than one.
  active?: boolean
  children: React.ReactNode
}) {
  const row =
    "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] transition-colors"
  const off = "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
  const on = "bg-muted text-foreground font-semibold"
  return (
    <Link
      to={to}
      activeOptions={{ exact: true }}
      className={cn(row, off)}
      activeProps={active === false ? undefined : { className: cn(row, on) }}
      {...(active === true ? { className: cn(row, on) } : {})}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{children}</span>
      {count !== undefined && count > 0 && (
        <span className="ml-auto font-mono text-[10.5px] opacity-70">{count}</span>
      )}
    </Link>
  )
}
