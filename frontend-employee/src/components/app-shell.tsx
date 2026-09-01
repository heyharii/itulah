import { Link, Outlet, useRouterState } from "@tanstack/react-router"
import { Bell, CalendarDays, Clock, House, User, Wallet } from "lucide-react"

import { useNotifications, useReach } from "@/lib/hr/queries"
import { cn } from "@/lib/utils"

/// Where an employee can go.
///
/// Five, and five is a ceiling rather than a coincidence: this is a phone
/// surface first, the row of tabs is one thumb wide, and a sixth would make
/// every one of them too narrow to hit while holding a stock gun in the other
/// hand. Everything that did not fit — holidays, contract, devices — lives
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
  const match = tabs
    .filter((tab) => tab.to !== "/" && path.startsWith(tab.to))
    .sort((a, b) => b.to.length - a.to.length)[0]
  return match?.to ?? "/"
}

export function AppShell() {
  const path = useRouterState({ select: (state) => state.location.pathname })
  const current = activeTab(path)
  const notifications = useNotifications()
  const unread = (notifications.data ?? []).filter(
    (item) => item.read_at === null
  ).length

  return (
    // `min-h-svh`, not `h-svh`: every screen here is a scrolling list on a
    // phone, and the small viewport unit is the one that accounts for the
    // browser chrome that slides away as you scroll.
    <div className="min-h-svh bg-background md:flex">
      <Sidebar current={current} unread={unread} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b bg-background/85 px-4 py-3 backdrop-blur-sm md:px-8">
          <h1 className="truncate text-base font-semibold md:text-lg">
            {title(path)}
          </h1>
          <Link
            to="/notifications"
            aria-label={
              unread === 0 ? "Notifications" : `Notifications, ${unread} unread`
            }
            className="relative ml-auto grid size-9 place-items-center rounded-full transition-colors hover:bg-muted"
          >
            <Bell className="size-5" />
            {unread > 0 && (
              <span className="absolute top-1.5 right-1.5 grid size-4 place-items-center rounded-full bg-destructive text-[10px] font-semibold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Link>
        </header>

        <StandInNotice />

        {/* The padding at the bottom is the tab bar's own height plus the home
            indicator's. Without it the last row of every list sits underneath
            the tabs and cannot be read or tapped. */}
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-8 md:pb-10">
          <Outlet />
        </main>
      </div>

      <TabBar current={current} />
    </div>
  )
}

function title(path: string): string {
  if (path === "/") return "My work"
  if (path === "/leave/new") return "Apply for leave"
  if (path.startsWith("/leave")) return "Leave"
  if (path.startsWith("/attendance/correction")) return "Fix a day"
  if (path.startsWith("/attendance")) return "Hours"
  if (path.startsWith("/overtime")) return "Overtime"
  if (path.startsWith("/pay")) return "Pay"
  if (path.startsWith("/notifications")) return "Notifications"
  if (path.startsWith("/me")) return "Me"
  return "My work"
}

/// Says out loud that the server has no HR routes yet.
///
/// Not a developer's console warning: somebody reviewing these screens is
/// being shown a leave balance and a payslip, and they have to be told those
/// belong to nobody. It appears only once a request has actually come back 404
/// — on a server that has grown the routes, this never renders.
function StandInNotice() {
  const reach = useReach()
  if (reach !== "absent") {
    return null
  }
  return (
    <p
      role="status"
      className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-[11px] leading-snug font-medium text-amber-900 md:px-8 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
    >
      Example data — this node has no employee records yet.
    </p>
  )
}

function Sidebar({ current, unread }: { current: string; unread: number }) {
  return (
    <aside className="hidden w-56 shrink-0 border-r p-4 md:block">
      <p className="px-2 pb-4 text-sm font-semibold">Itulah</p>
      <nav className="flex flex-col gap-0.5" aria-label="Sections">
        {tabs.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            className={cn(
              "flex h-9 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors",
              current === tab.to
                ? "bg-muted font-semibold text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            )}
          >
            <tab.icon className="size-4 shrink-0" />
            {tab.label}
          </Link>
        ))}
        <Link
          to="/notifications"
          className={cn(
            "flex h-9 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors",
            "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          )}
        >
          <Bell className="size-4 shrink-0" />
          Notifications
          {unread > 0 && (
            <span className="ml-auto font-mono text-[10.5px] opacity-70">
              {unread}
            </span>
          )}
        </Link>
      </nav>
    </aside>
  )
}

function TabBar({ current }: { current: string }) {
  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden"
    >
      {tabs.map((tab) => {
        const on = current === tab.to
        return (
          <Link
            key={tab.to}
            to={tab.to}
            aria-current={on ? "page" : undefined}
            // `min-h-14` rather than padding alone: a tab has to stay a
            // comfortable target however the label wraps.
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] transition-colors",
              on ? "font-semibold text-foreground" : "text-muted-foreground"
            )}
          >
            <tab.icon className={cn("size-5", on && "stroke-[2.4]")} />
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
