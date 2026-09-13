import { Outlet, useRouter, useRouterState } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowLeft,
  CalendarCheck,
  HandCoins,
  Inbox,
  KeyRound,
  LogOut,
  Menu,
  RefreshCw,
  Scale,
  Signal,
  TrendingUp,
  Upload,
  UserRound,
} from "lucide-react"
import { useState } from "react"

import { Mark } from "@/components/shell/mark"
import { TillSidebar } from "@/components/shell/sidebar"
import { AppBar } from "@/components/ui/app-bar"
import { Chip } from "@/components/ui/button"
import { Drawer, DrawerItem, DrawerSection } from "@/components/ui/drawer"
import { Pill } from "@/components/ui/pill"
import { TabBar } from "@/components/ui/tab-bar"
import { sync } from "@/lib/api"
import { useGo } from "@/lib/go"
import { pushedForPath, tabForPath, tabs, titleForPath } from "@/lib/navigation"
import { unsentCount, useSaleQueue } from "@/lib/sale-queue"
import { useIdentity, useNodeIdentity, useSignOut } from "@/lib/session"
import { syncHealth } from "@itulah/contract/client"

/// The shell, and it is not the console's.
///
/// No 58px icon rail and no 248px sidebar: this is DESIGN.md's **phone
/// expression**, which is full-bleed (no floating app-card, no `{backdrop}`
/// stage), a three-zone app-bar, a floating squircle tab bar for the top four
/// destinations, and a hamburger drawer for everything else.
///
/// Two rules from that section govern the whole file:
///
///   - **A pushed detail hides the tab bar.** The left chip becomes a back
///     arrow and the four squircles go. That is what makes a payment screen
///     something you finish or cancel rather than something a stray thumb can
///     wander out of.
///   - **Nothing darkens.** The drawer floats on the white veil; the content
///     behind it washes toward near-white and stays legible as a ghost.
export function TillShell() {
  const router = useRouter()
  const go = useGo()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  const pushed = pushedForPath(pathname)
  const tab = tabForPath(pathname)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const goBack = () => {
    // History when there is history — the arrow should undo the tap that got
    // here. A cold reload on a pushed screen has none, and then the declared
    // parent is where the arrow lands, rather than nowhere.
    if (router.history.canGoBack()) router.history.back()
    else go(pushed?.back ?? "/sell")
  }

  return (
    <div className="flex h-svh overflow-hidden bg-canvas">
      {/* The desk's navigation. Hidden below `md`, where the squircles are the
          navigation instead — exactly one of the two is on screen at any
          width. Before 2026-09-13 neither was: the bar was `md:hidden` against
          a function board that was never built, so a laptop had no navigation
          at all. */}
      <TillSidebar className="hidden md:flex" />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AppBar
        left={
          pushed === null ? (
            <Chip
              aria-label="Menu"
              className="md:hidden"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu strokeWidth={1.7} />
            </Chip>
          ) : (
            <Chip aria-label="Back" onClick={goBack}>
              <ArrowLeft strokeWidth={1.7} />
            </Chip>
          )
        }
        title={titleForPath(pathname)}
        right={
          pushed === null ? (
            <Chip aria-label="This node" onClick={() => go("/node/sync")}>
              <UserRound strokeWidth={1.7} />
            </Chip>
          ) : undefined
        }
        />

        <Outlet />

        {/* The floating squircles are the PHONE navigation. They are hidden at
            the width the sidebar appears at — two navigations on one screen is
            two places to look. */}
        {pushed === null && (
          <TabBar
            items={tabs}
            activePath={tab?.path ?? null}
            className="md:hidden"
          />
        )}
      </div>

      <TillDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
    </div>
  )
}

/// Everything that is not one of the four destinations: which node this is,
/// whether it is getting through, and the two things a person does to their own
/// account.
function TillDrawer({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const go = useGo()
  const identity = useIdentity()
  const where = useNodeIdentity()
  const signOut = useSignOut()
  const queue = useSaleQueue()
  const unsent = unsentCount(queue)

  // The backlog, asked for only while the drawer is open. The sender's own
  // cycle is five seconds and polling faster only makes the screen busy without
  // making it more truthful.
  const backlog = useQuery({
    queryKey: ["sync", "status"],
    queryFn: ({ signal }) => sync.status(signal),
    enabled: open,
    refetchInterval: open ? 5_000 : false,
  })

  const health = backlog.data === undefined ? null : syncHealth(backlog.data)
  const person = identity.data ?? null

  // Closed where the navigation happens rather than in an effect watching the
  // path: a drawer left open across a navigation is a drawer covering the very
  // screen somebody just asked for, and reacting to the path change afterwards
  // renders that covered screen once before hiding it.
  const leave = (to: string) => {
    onOpenChange(false)
    go(to)
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="This till">
      <div className="mb-4 flex items-center gap-3 rounded-card border border-hairline bg-soft px-3.5 py-3">
        <Mark className="h-9 w-8 shrink-0 text-line-ico" />
        <div className="min-w-0">
          <div className="truncate text-card-title font-semibold text-ink">
            {person?.display_name ?? "Signed in"}
          </div>
          <div className="truncate text-meta text-mute">
            {where.data === null || where.data === undefined
              ? "—"
              : `${where.data.node_role} · ${where.data.site_id ?? where.data.node_id}`}
          </div>
        </div>
      </div>

      {/* The same three screens the sidebar's first section carries. A phone
          has no column to put them in, and a screen reachable on a laptop and
          not on the tablet behind the counter is the bug this app already had
          once. */}
      <DrawerSection>Money</DrawerSection>
      <DrawerItem
        icon={<TrendingUp />}
        label="Sales"
        onClick={() => leave("/money/sales")}
      />
      <DrawerItem
        icon={<Scale />}
        label="Reconciliation"
        onClick={() => leave("/money/reconciliation")}
      />
      <DrawerItem
        icon={<HandCoins />}
        label="Expenses"
        onClick={() => leave("/money/expenses")}
      />

      {/* The two HR screens a shift actually reaches for. The other three —
          the week's rota, the team, the month's close — are a desk's work and
          stay in the sidebar: a drawer that lists everything is a drawer
          nobody reads to the bottom of.

          These are the only entries here answered by HEAD OFFICE rather than
          by this node, so they are the only ones that go blank when the line
          does. The screens say so themselves; this list does not repeat it. */}
      <DrawerSection>People</DrawerSection>
      <DrawerItem
        icon={<CalendarCheck />}
        label="Today"
        onClick={() => leave("/hr/today")}
      />
      <DrawerItem
        icon={<Inbox />}
        label="Leave & overtime"
        onClick={() => leave("/hr/requests")}
      />

      <DrawerSection>Head office</DrawerSection>
      <DrawerItem
        icon={<RefreshCw />}
        label="Sync"
        detail={
          health === null ? (
            "…"
          ) : (
            <Pill tone={SYNC_TONE[health]}>{SYNC_WORD[health]}</Pill>
          )
        }
        onClick={() => leave("/node/sync")}
      />
      <DrawerItem
        icon={<Upload />}
        label="Not yet sent"
        detail={unsent === 0 ? "—" : String(unsent)}
        onClick={() => leave("/sell/queue")}
      />

      <DrawerSection>Your account</DrawerSection>
      <DrawerItem
        icon={<KeyRound />}
        label="Change password"
        onClick={() => leave("/node/password")}
      />
      <DrawerItem
        icon={<LogOut />}
        label="Sign out"
        tone={unsent > 0 ? "bad" : "normal"}
        detail={unsent > 0 ? <Signal className="size-4 text-bad" /> : undefined}
        onClick={() => {
          // Signing out with sales still on this device is worth one question.
          // The queue survives it — it is on disk, not in the session — but the
          // next person at this counter will not know to look, and the sales
          // will sit there until somebody does.
          if (
            unsent > 0 &&
            !window.confirm(
              `${unsent} sale${unsent === 1 ? "" : "s"} on this device ${
                unsent === 1 ? "has" : "have"
              } not reached head office yet. They are saved and will send when the line is back. Sign out anyway?`,
            )
          ) {
            return
          }
          signOut.mutate()
        }}
      />
    </Drawer>
  )
}

const SYNC_TONE = {
  current: "ok",
  behind: "warn",
  blocked: "bad",
  off: "neutral",
} as const

const SYNC_WORD = {
  current: "Up to date",
  behind: "Sending",
  blocked: "Stuck",
  off: "Off",
} as const
