import {
  NotificationRailIcon,
  NotificationSheet,
} from "@/components/notifications/notification-sheet"
import { BasketRailIcon, BasketSheet, useBasketPieces } from "@/components/sourcing/basket-sheet"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { allotmentListKey, listAllotments } from "@/lib/allotments"
import { conversationsKey, listConversations } from "@/lib/chat"
import { listPriceBooks, priceBooksKey } from "@/lib/commercial"
import { pendingPriceAmendments } from "@/lib/purchase-orders"
import { cn } from "@/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { Link, useRouterState } from "@tanstack/react-router"
import {
  ClipboardList,
  ClipboardX,
  Files,
  MessagesSquare,
  Shirt,
  Tag,
  TrendingUp,
  Truck,
  Users,
  Wallet,
} from "lucide-react"

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
  // The same key the Price books screen asks for, so opening it does not fetch
  // the list a second time.
  const books = useQuery({
    queryKey: priceBooksKey(),
    queryFn: ({ signal }) => listPriceBooks(signal),
    refetchInterval: 60_000,
  })
  // A book written and not published is a price decided and not charged. It is
  // the only unfinished work Commercial has that nothing else would show.
  const unpublished = (books.data ?? []).filter((book) => book.status === "DRAFT").length
  // The same key and request the conversations screen makes, so opening it
  // does not fetch the list twice. No poll: the collaboration stream wakes this
  // up, and the screen itself keeps a slow refetch under that as a floor.
  const conversations = useQuery({
    queryKey: conversationsKey(),
    queryFn: ({ signal }) => listConversations(signal),
  })
  const unread = (conversations.data ?? []).reduce(
    (total, conversation) => total + conversation.unread_count,
    0,
  )

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
        {/* What the shops charge — a different price from the one the
            amendments queue argues about, and worth keeping a step apart from
            it: that one is what we pay a supplier, this one is what a customer
            pays us. */}
        <RailLink
          to="/commercial"
          label="Prices"
          icon={<Tag className={cn("size-5", unpublished > 0 && "text-amber-600")} />}
          active={path.startsWith("/commercial")}
          count={unpublished}
        />

        {/* The other half of a price. `/commercial` is what the shops are
            asking; this is what anybody actually paid, by shop and by week.
            Next to each other on purpose — the two are read together whenever
            a repricing is being judged. */}
        <RailLink
          to="/sales"
          label="Sales"
          icon={<TrendingUp className="size-5" />}
          active={path.startsWith("/sales")}
        />

        {/* Talking. Two places, not one, because a conversation and a
            discussion are different things: one is private to the people in
            it, the other hangs off a record and outlives everyone who argued
            about it. Files is a third, and it is not a file system — it lists
            what is attached in rooms this person can already reach. */}
        <RailLink
          to="/chat"
          label="Conversations"
          icon={<Users className={cn("size-5", unread > 0 && "text-amber-600")} />}
          active={path.startsWith("/chat")}
          count={unread}
        />
        <RailLink
          to="/discussions"
          label="Discussions"
          icon={<MessagesSquare className="size-5" />}
          active={path.startsWith("/discussions")}
        />
        <RailLink to="/files" label="Files" icon={<Files className="size-5" />} />

        {/* The books. A different job from everything above it — those are all
            about goods moving, this is about what the goods cost and what is
            owed for them — so it sits after a gap rather than in the run.

            No badge yet. The unfinished work finance has is unset account
            mappings and unclosed months, and both are answered on the screen
            behind this icon rather than by a number that would sit at zero for
            weeks and then jump. */}
        <div className="my-1 h-px w-6 bg-border" aria-hidden />
        <RailLink
          to="/finance"
          label="Finance"
          icon={<Wallet className="size-5" />}
          active={path.startsWith("/finance")}
        />

        {/* Also not a destination, and for a different reason than the basket:
            what arrived is read in the middle of doing something else, so it
            opens over the screen rather than replacing it. */}
        <RailItem label="Notifications" active={false}>
          <NotificationSheet>
            <button type="button" className={RAIL_BUTTON} aria-label="Notifications">
              <NotificationRailIcon />
            </button>
          </NotificationSheet>
        </RailItem>
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
