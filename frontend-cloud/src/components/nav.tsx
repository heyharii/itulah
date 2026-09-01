import { NotificationRailIcon } from "@/components/notifications/notification-sheet"
import { BasketRailIcon } from "@/components/sourcing/basket-sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { allotmentListKey, listAllotments } from "@/lib/allotments"
import { useBasketPieces } from "@/lib/basket"
import { useBasketSheet, useNotificationSheet } from "@/lib/sheets/system"
import { conversationsKey, listConversations } from "@/lib/chat"
import { listPriceBooks, priceBooksKey } from "@/lib/commercial"
import { pendingPriceAmendments } from "@/lib/purchase-orders"
import { useIdentity, useNodeIdentity, useSignOut } from "@/lib/session"
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
  IdCard,
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
  // The rail opens both of these by writing a query parameter; the sheets
  // themselves are mounted once at the root. That is the whole reason the rail
  // no longer wraps them: a trigger has to be an ancestor of what it opens,
  // and this one is an ancestor of nothing.
  const basket = useBasketSheet()
  const notifications = useNotificationSheet()
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
    (row) => row.remaining_quantity > 0
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
  const unpublished = (books.data ?? []).filter(
    (book) => book.status === "DRAFT"
  ).length
  // The same key and request the conversations screen makes, so opening it
  // does not fetch the list twice. No poll: the collaboration stream wakes this
  // up, and the screen itself keeps a slow refetch under that as a floor.
  const conversations = useQuery({
    queryKey: conversationsKey(),
    queryFn: ({ signal }) => listConversations(signal),
  })
  const unread = (conversations.data ?? []).reduce(
    (total, conversation) => total + conversation.unread_count,
    0
  )

  // Orders, one order, and a draft are three routes but one place as far as
  // somebody reading the nav is concerned.
  const path = useRouterState({ select: (state) => state.location.pathname })

  return (
    <TooltipProvider>
      <nav
        className="flex h-full w-full flex-col items-center gap-3 px-0 pt-[13px] pb-[14px]"
        aria-label="Buying"
      >
        <RailMark />
        <div className="flex min-h-0 flex-1 flex-col items-center gap-[11px] overflow-y-auto py-0.5">
        <RailLink tone="sourcing" to="/" label="Sourcing" icon={<Shirt className="size-[15px]" strokeWidth={1.85} />} />

        {/* Not a destination. Picking things out and looking at what you have
            picked are one activity, and a route change would discard the
            filters that made the picking possible. */}
        <RailItem label="Basket" active={basket.isOpen}>
          <button
            type="button"
            className={RAIL_BUTTON}
            aria-label="Basket"
            onClick={basket.open}
          >
            <BasketRailIcon pieces={pieces} />
          </button>
        </RailItem>

        <RailLink
          tone="orders"
          to="/orders"
          label="Purchase orders"
          icon={<ClipboardList className="size-[15px]" strokeWidth={1.85} />}
          active={path.startsWith("/orders")}
        />
        <RailLink
          tone="allotments"
          to="/allotments"
          label="Allotments"
          icon={
            <Truck className="size-[15px]" strokeWidth={1.85} />
          }
          active={path.startsWith("/allotments")}
          count={reserving}
        />
        <RailLink
          tone="amendments"
          to="/amendments"
          label="Price amendments"
          icon={
            <ClipboardX className="size-[15px]" strokeWidth={1.85} />
          }
          count={waiting}
        />
        {/* What the shops charge — a different price from the one the
            amendments queue argues about, and worth keeping a step apart from
            it: that one is what we pay a supplier, this one is what a customer
            pays us. */}
        <RailLink
          tone="prices"
          to="/commercial"
          label="Prices"
          icon={
            <Tag className="size-[15px]" strokeWidth={1.85} />
          }
          active={path.startsWith("/commercial")}
          count={unpublished}
        />

        {/* The other half of a price. `/commercial` is what the shops are
            asking; this is what anybody actually paid, by shop and by week.
            Next to each other on purpose — the two are read together whenever
            a repricing is being judged. */}
        <RailLink
          tone="sales"
          to="/sales"
          label="Sales"
          icon={<TrendingUp className="size-[15px]" strokeWidth={1.85} />}
          active={path.startsWith("/sales")}
        />

        {/* Talking. Two places, not one, because a conversation and a
            discussion are different things: one is private to the people in
            it, the other hangs off a record and outlives everyone who argued
            about it. Files is a third, and it is not a file system — it lists
            what is attached in rooms this person can already reach. */}
        <RailLink
          tone="chat"
          to="/chat"
          label="Conversations"
          icon={
            <Users className="size-[15px]" strokeWidth={1.85} />
          }
          active={path.startsWith("/chat")}
          count={unread}
        />
        <RailLink
          tone="discussions"
          to="/discussions"
          label="Discussions"
          icon={<MessagesSquare className="size-[15px]" strokeWidth={1.85} />}
          active={path.startsWith("/discussions")}
        />
        <RailLink
          tone="files"
          to="/files"
          label="Files"
          icon={<Files className="size-[15px]" strokeWidth={1.85} />}
        />

        {/* The books. A different job from everything above it — those are all
            about goods moving, this is about what the goods cost and what is
            owed for them — so it sits after a gap rather than in the run.

            No badge yet. The unfinished work finance has is unset account
            mappings and unclosed months, and both are answered on the screen
            behind this icon rather than by a number that would sit at zero for
            weeks and then jump. */}
        <div className="my-0.5 h-px w-[22px] bg-[var(--os-hairline-2,#e6e6ea)]" aria-hidden />
        <RailLink
          tone="finance"
          to="/finance"
          label="Finance"
          icon={<Wallet className="size-[15px]" strokeWidth={1.85} />}
          active={path.startsWith("/finance")}
        />

        {/* Who works here. Last in the rail on purpose: a buyer opens it
            rarely, and the things above it are opened every day. */}
        <RailLink
          tone="people"
          to="/people"
          label="People"
          icon={<IdCard className="size-[15px]" strokeWidth={1.85} />}
          active={path.startsWith("/people")}
        />
        </div>

        <div className="mt-auto flex flex-col items-center gap-1.5">
          <div className="h-px w-[22px] bg-[var(--os-hairline-2,#e6e6ea)]" aria-hidden />
          {/* Also not a destination, and for a different reason than the basket:
              what arrived is read in the middle of doing something else, so it
              opens over the screen rather than replacing it. */}
          <RailItem label="Notifications" active={notifications.isOpen}>
            <button
              type="button"
              className={RAIL_BUTTON}
              aria-label="Notifications"
              onClick={notifications.open}
            >
              <NotificationRailIcon />
            </button>
          </RailItem>
          <Account />
        </div>
      </nav>
    </TooltipProvider>
  )
}

/// The signed-in operator, pinned to the bottom of the rail.
///
/// An avatar disc rather than a name, because the rail is 64px wide and a name
/// would not fit — the tooltip carries the name, the node and the way out, all
/// of which are read once a day rather than scanned.
function Account() {
  const identity = useIdentity()
  const node = useNodeIdentity()
  const signOut = useSignOut()
  const person = identity.data ?? null
  if (person === null) return null
  const initial = (person.display_name || person.username).slice(0, 1).toUpperCase()
  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={`${person.display_name} — sign out`}
              disabled={signOut.isPending}
              onClick={() => signOut.mutate()}
              className="grid size-[30px] place-items-center rounded-full bg-[var(--os-soft-2,#f3f3f5)] text-[11px] font-semibold text-[var(--os-text,currentColor)] ring-1 ring-[var(--os-hairline-2,transparent)] transition-colors hover:bg-[var(--os-ink,#1d1d1f)] hover:text-white"
            >
              {signOut.isPending ? "…" : initial}
            </button>
          }
        />
        <TooltipContent side="right">
          <span className="block font-medium">{person.display_name}</span>
          <span className="block opacity-70">
            {person.username} · {person.role}
          </span>
          {node.data != null && (
            <span className="block opacity-70">
              {node.data.node_id} · {node.data.node_role}
            </span>
          )}
          <span className="mt-1 block opacity-70">Click to sign out</span>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

/// A rail entry that is an *action*, not a place: the basket and the
/// notifications tray open over the screen rather than replacing it. They stay
/// pale outline glyphs, the way the utility group at the foot of the Cloud Hub
/// rail does — colour in this rail means "a module you can be inside of".
const RAIL_BUTTON =
  "relative grid size-8 place-items-center rounded-[9px] text-[var(--os-line-ico,#abacb2)] transition-colors hover:bg-[var(--os-soft-2,#f3f3f5)] hover:text-[var(--os-text,#46464d)]"

/// Pastel mesh tiles — copied from `inventory-prototype.html` `.g-*` so every
/// menu in the rail is the same object the prototype taught the eye.
const TONES = {
  prices: "[--rail-c1:#ffb3cd] [--rail-c2:#ffc79f] [--rail-c3:#ee6d97] [--rail-base:#f2789f]",
  sourcing: "[--rail-c1:#9cefd6] [--rail-c2:#a3d6ff] [--rail-c3:#34bd9d] [--rail-base:#45c9a8]",
  orders: "[--rail-c1:#b6ccff] [--rail-c2:#c9bcff] [--rail-c3:#5a7cec] [--rail-base:#6b8bf0]",
  allotments: "[--rail-c1:#dcc5ff] [--rail-c2:#ffc2e9] [--rail-c3:#9663ea] [--rail-base:#a274ee]",
  amendments: "[--rail-c1:#ffdb9a] [--rail-c2:#ffc59f] [--rail-c3:#eca02e] [--rail-base:#f0a93c]",
  finance: "[--rail-c1:#aeecbd] [--rail-c2:#d3f0a4] [--rail-c3:#41ae61] [--rail-base:#4fb96e]",
  people: "[--rail-c1:#ffc2a2] [--rail-c2:#ffadad] [--rail-c3:#ec7d4d] [--rail-base:#f08a5d]",
  files: "[--rail-c1:#d1d9e3] [--rail-c2:#cbd3df] [--rail-c3:#8d97a8] [--rail-base:#9aa3b2]",
  sales: "[--rail-c1:#a6dbf5] [--rail-c2:#b5caf7] [--rail-c3:#369cd5] [--rail-base:#45a8dd]",
  discussions: "[--rail-c1:#cbc9d7] [--rail-c2:#d3d1dd] [--rail-c3:#838095] [--rail-base:#8f8ca0]",
  chat: "[--rail-c1:#ffc2a2] [--rail-c2:#ffadad] [--rail-c3:#ec7d4d] [--rail-base:#f08a5d]",
} as const

const RAIL_TILE =
  "rail-tile relative grid size-[30px] place-items-center rounded-[9px] text-white transition-transform hover:-translate-y-px"

/// The shopkeeper mark from `inventory-prototype.html` `.mark` — the rail's
/// only non-pastel object, so the modules below it read as a set of apps.
function RailMark() {
  return (
    <div className="mb-0.5 grid size-7 place-items-center text-[var(--os-ink,#1d1d1f)]" title="itulah">
      <svg viewBox="0 0 100 116" aria-hidden="true" className="h-[27px] w-6">
        <g fill="none" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M50 8 C30 8 20 21 20 39 C20 54 31 63 50 63 C69 63 80 54 80 39 C80 21 70 8 50 8 Z" />
          <circle cx="36" cy="37" r="12" />
          <circle cx="64" cy="37" r="12" />
          <path d="M30 64 C26 82 30 103 50 103 C70 103 74 82 70 64" />
        </g>
        <g fill="currentColor" stroke="none">
          <circle cx="37" cy="39" r="4.6" />
          <circle cx="63" cy="39" r="4.6" />
        </g>
      </svg>
    </div>
  )
}

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
          "absolute top-1/2 -left-[9px] w-[2.5px] -translate-y-1/2 rounded-[2px] bg-[var(--os-ink,#1d1d1f)] transition-all",
          active ? "h-3.5 opacity-100" : "h-0 opacity-0"
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
  tone,
}: {
  to: string
  label: string
  icon: React.ReactNode
  count?: number
  /// Overrides the router's own exact match, for an entry that stands for a
  /// family of routes rather than one.
  active?: boolean
  tone: keyof typeof TONES
}) {
  const path = useRouterState({ select: (state) => state.location.pathname })
  const here = active ?? (to === "/" ? path === "/" : path.startsWith(to))
  return (
    <RailItem label={label} active={here}>
      <Link to={to} aria-label={label} className={cn(RAIL_TILE, TONES[tone])}>
        {icon}
        {count !== undefined && count > 0 && (
          // Sits outside the tile so the count is never read as part of the
          // module's own colour. Warn, not accent: every one of these numbers
          // is work somebody has not finished.
          <span className="absolute -top-1 -right-1.5 grid min-w-4 place-items-center rounded-full bg-[var(--os-warn,#b45309)] px-1 font-mono text-[10px] leading-4 font-medium text-white ring-2 ring-[var(--os-canvas,#fff)]">
            {count}
          </span>
        )}
      </Link>
    </RailItem>
  )
}
