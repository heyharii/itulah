import { Link, Outlet, useRouterState } from "@tanstack/react-router"
import {
  Bell,
  CalendarDays,
  Clock,
  House,
  LogOut,
  User,
  Wallet,
} from "lucide-react"

import { Panel } from "@/components/bits"
import { Button } from "@/components/ui/button"
import { isUnbound } from "@/lib/hr/api"
import { useNotifications, useProfile } from "@/lib/hr/queries"
import { useSession, useSignOut } from "@/lib/session"
import { cn } from "@/lib/utils"

/// Where an employee can go.
///
/// Five, and five is a ceiling rather than a coincidence: this is a phone
/// surface first, the row of tabs is one thumb wide, and a sixth would make
/// every one of them too narrow to hit while holding a stock gun in the other
/// hand. Everything that did not fit — holidays, contract, payroll details — lives
/// under `Me`, because that is where somebody looks for it.
const tabs = [
  { to: "/", label: "Home", icon: House },
  { to: "/leave", label: "Leave", icon: CalendarDays },
  { to: "/attendance", label: "Hours", icon: Clock },
  { to: "/pay", label: "Pay", icon: Wallet },
  { to: "/me", label: "Me", icon: User },
] as const

/// A tab stands for a family of routes, not one: `/leave/new` is still Leave.
function activeTab(path: string): string {
  if (path.startsWith("/notifications")) return "/notifications"
  const match = tabs
    .filter((tab) => tab.to !== "/" && path.startsWith(tab.to))
    .sort((a, b) => b.to.length - a.to.length)[0]
  return match?.to ?? "/"
}

export function AppShell() {
  const path = useRouterState({ select: (state) => state.location.pathname })
  const current = activeTab(path)
  const profile = useProfile()
  const notifications = useNotifications()
  const unread = notifications.data?.unread ?? 0

  return (
    <div className="flex min-h-svh bg-canvas">
      <Sidebar current={current} unread={unread} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title(path)} unread={unread} />

        {/* The bottom padding is the tab bar's height plus the home indicator,
            so the last row of every list is not under the tabs. */}
        <main className="mx-auto w-full max-w-[48rem] flex-1 px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-[1.875rem] md:pt-6 md:pb-14">
          <h1 className="mb-5 hidden text-hero font-semibold text-ink md:block">
            {title(path)}
          </h1>
          {isUnbound(profile.error) ? <Unbound /> : <Outlet />}
        </main>
      </div>

      <TabBar current={current} />
    </div>
  )
}

/// Every screen here reads the caller's own employment record, so without one
/// there is nothing to show — said once, instead of a refusal on every card.
function Unbound() {
  const session = useSession()
  const signOut = useSignOut()
  return (
    <Panel title="Not linked to an employee yet">
      <p className="text-cell text-text">
        You are signed in as{" "}
        <span className="font-medium text-ink">
          {session.identity.username}
        </span>
        , but this login has not been linked to an employee record, so there is
        no leave, attendance or pay to show.
      </p>
      <p className="text-meta text-body">
        Ask HR to link your login to your employee record in People.
      </p>
      <Button
        size="tap"
        className="self-start md:h-control"
        disabled={signOut.isPending}
        onClick={() => signOut.mutate()}
      >
        Sign out
      </Button>
    </Panel>
  )
}

function title(path: string): string {
  if (path === "/") return "My work"
  if (path === "/leave/new") return "Apply for leave"
  if (path.startsWith("/team")) return "Team"
  if (path.startsWith("/attendance/swap")) return "Swap a day"
  if (path.startsWith("/pay/claims")) return "Claims"
  if (path.startsWith("/me/voice")) return "Raise a concern"
  if (path.startsWith("/leave")) return "Leave"
  if (path.startsWith("/attendance/correction")) return "Fix a day"
  if (path.startsWith("/attendance")) return "Hours"
  if (path.startsWith("/overtime")) return "Overtime"
  if (path.startsWith("/pay")) return "Pay"
  if (path.startsWith("/notifications")) return "Notifications"
  if (path.startsWith("/me")) return "Me"
  return "My work"
}

function Mark() {
  return (
    <Link
      to="/"
      aria-label="Itulah — home"
      className="grid size-[1.875rem] shrink-0 place-items-center rounded-inner bg-dark text-[0.6875rem] font-semibold tracking-[0.02em] text-on-dark"
    >
      IT
    </Link>
  )
}

function Badge({ value }: { value: number }) {
  if (value <= 0) return null
  return (
    <span className="shrink-0 rounded-full bg-bad-bg px-[0.375rem] py-px text-[0.65625rem] font-semibold text-bad-fg tabular-nums">
      {value > 9 ? "9+" : value}
    </span>
  )
}

function Sidebar({ current, unread }: { current: string; unread: number }) {
  const session = useSession()
  const signOut = useSignOut()
  const rows = [
    ...tabs,
    { to: "/notifications", label: "Notifications", icon: Bell },
  ] as const

  return (
    <aside className="sticky top-0 hidden h-svh w-[15.5rem] shrink-0 flex-col border-r border-hairline bg-soft px-[0.6875rem] py-[0.8125rem] md:flex">
      <div className="mb-4 flex items-center gap-2.5 px-[0.3125rem]">
        <Mark />
        <b className="min-w-0 flex-1 truncate text-card-title font-semibold text-ink">
          Itulah
        </b>
      </div>

      <nav aria-label="Sections" className="flex flex-col gap-px">
        {rows.map((row) => {
          const on = current === row.to
          return (
            <Link
              key={row.to}
              to={row.to}
              aria-current={on ? "page" : undefined}
              className={cn(
                "group flex items-center gap-2.5 rounded-lg px-[0.5625rem] py-[0.4375rem] text-nav font-medium text-text transition-colors hover:bg-soft-2 hover:text-ink pointer-coarse:min-h-tap",
                on && "bg-soft-2 font-semibold text-ink"
              )}
            >
              <row.icon
                className={cn(
                  "size-[1.0625rem] shrink-0 stroke-[1.55] text-line-ico",
                  on && "text-ink"
                )}
              />
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              {row.to === "/notifications" && <Badge value={unread} />}
            </Link>
          )
        })}
      </nav>

      <div className="mt-auto flex items-center gap-2.5 rounded-inner border border-hairline p-[0.4375rem_0.5rem]">
        <span className="size-[1.625rem] shrink-0 rounded-full bg-linear-to-br from-avatar-from to-avatar-to" />
        <span className="min-w-0 flex-1 text-[0.78125rem] leading-tight font-medium text-ink">
          <span className="block truncate">
            {session.identity.display_name}
          </span>
          <small className="block truncate text-[0.6875rem] font-normal text-mute">
            {session.node?.node_id ?? session.identity.username}
          </small>
        </span>
        <button
          type="button"
          aria-label="Sign out"
          onClick={() => signOut.mutate()}
          disabled={signOut.isPending}
          className="grid size-[1.625rem] shrink-0 place-items-center rounded-lg text-line-ico transition-colors hover:bg-soft-2 hover:text-text disabled:opacity-50"
        >
          <LogOut className="size-4 stroke-[1.7]" />
        </button>
      </div>
    </aside>
  )
}

function TopBar({ title, unread }: { title: string; unread: number }) {
  return (
    <header className="sticky top-0 z-20 flex h-13 shrink-0 items-center gap-3 border-b border-hairline bg-soft-3/90 px-4 backdrop-blur-sm md:hidden">
      <Mark />
      <h1 className="min-w-0 flex-1 truncate text-card-title font-semibold text-ink">
        {title}
      </h1>
      <Link
        to="/notifications"
        aria-label={
          unread === 0 ? "Notifications" : `Notifications, ${unread} unread`
        }
        className="relative grid size-tap shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-text"
      >
        <Bell className="size-[1.125rem] stroke-[1.7]" />
        {unread > 0 && (
          <span className="absolute top-2 right-2 size-2 rounded-full bg-bad ring-2 ring-soft-3" />
        )}
      </Link>
    </header>
  )
}

function TabBar({ current }: { current: string }) {
  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-hairline bg-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden"
    >
      {tabs.map((tab) => {
        const on = current === tab.to
        return (
          <Link
            key={tab.to}
            to={tab.to}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-1 text-pill font-medium transition-colors",
              on ? "font-semibold text-ink" : "text-body"
            )}
          >
            <tab.icon
              className={cn(
                "size-5 stroke-[1.6]",
                on ? "text-accent" : "text-line-ico"
              )}
            />
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
