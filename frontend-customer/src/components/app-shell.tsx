import { Link, Outlet, useRouterState } from "@tanstack/react-router"
import { History, Home, User } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { useMember } from "@/lib/member"
import { cn } from "@/lib/utils"

/// The three places a member can be.
///
/// Three, deliberately. This surface reads points and purchases; a fourth tab
/// would have to be something it cannot yet do (redeem, vouchers, stores), and
/// a tab that opens onto an apology is worse than no tab.
const TABS: ReadonlyArray<{ to: string; label: string; icon: LucideIcon }> = [
  { to: "/", label: "Beranda", icon: Home },
  { to: "/riwayat", label: "Riwayat", icon: History },
  { to: "/profil", label: "Profil", icon: User },
]

/// Whether a tab is the one being looked at.
///
/// `/riwayat/<id>` is still Riwayat — a receipt opened from the history is not
/// a fourth place, and the tab bar going blank while reading one would be a
/// small lie about where you are.
function isCurrent(pathname: string, to: string): boolean {
  if (to === "/") {
    return pathname === "/"
  }
  return pathname === to || pathname.startsWith(`${to}/`)
}

/// One layout, two shapes.
///
/// A phone gets a bottom bar under the thumb; a desktop browser gets a rail
/// down the side, because a bar pinned to the bottom of a 1400px window is a
/// long way from anything the reader is looking at. Both are the same three
/// destinations and the same content column — this is one app that fits its
/// window, not a mobile app with a desktop variant bolted on.
export function AppShell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { memberId } = useMember()

  return (
    <div className="bg-background min-h-svh md:flex">
      <nav
        aria-label="Navigasi utama"
        className="bg-sidebar hidden shrink-0 border-r md:flex md:w-60 md:flex-col md:gap-1 md:p-4 lg:w-64"
      >
        <div className="px-3 py-4">
          <p className="font-heading text-base font-medium">Itulah Member</p>
          <p className="text-muted-foreground truncate text-xs">
            {memberId ?? "Belum ada kartu"}
          </p>
        </div>
        {TABS.map((tab) => {
          const current = isCurrent(pathname, tab.to)
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-4xl px-3 py-2 text-sm font-medium transition-colors",
                current
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <tab.icon className="size-4" />
              {tab.label}
            </Link>
          )
        })}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/85 sticky top-0 z-10 border-b backdrop-blur md:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <p className="font-heading text-base font-medium">Itulah Member</p>
            {memberId !== null && (
              <span className="bg-muted text-muted-foreground max-w-40 truncate rounded-4xl px-3 py-1 text-xs">
                {memberId}
              </span>
            )}
          </div>
        </header>

        {/* The bottom bar floats over the content on a phone, so the column
            keeps a bar's worth of padding beneath it — plus whatever the
            device's home indicator takes. Without that the last purchase in a
            history is permanently half-covered. */}
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:px-8 md:py-8 md:pb-8">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label="Navigasi utama"
        className="bg-background/95 fixed inset-x-0 bottom-0 z-20 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <div className="mx-auto flex max-w-3xl">
          {TABS.map((tab) => {
            const current = isCurrent(pathname, tab.to)
            return (
              <Link
                key={tab.to}
                to={tab.to}
                aria-current={current ? "page" : undefined}
                className={cn(
                  // 64px of height is a thumb target, not a design choice: a
                  // smaller row is the usual reason a tab bar gets pressed
                  // twice.
                  "flex h-16 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors",
                  current
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <tab.icon className="size-5" />
                {tab.label}
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
