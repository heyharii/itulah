import { Link, Outlet, useRouterState } from "@tanstack/react-router"
import { motion, useReducedMotion } from "motion/react"
import { ArrowLeft, History, Home, User } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Chip } from "@/components/ui/chip"
import { useSession } from "@/lib/session"
import { SPRING_LAYOUT } from "@/lib/motion"
import { cn } from "@/lib/utils"

/// The three places a member can be.
///
/// Three, deliberately, and DESIGN.md's ceiling is five: a fourth tab would
/// have to be something this surface cannot yet do — redeem, vouchers, stores —
/// and a tab that opens onto an apology is worse than no tab. Because there is
/// no overflow there is also no hamburger drawer; the left zone of the app-bar
/// is simply empty at the top level.
const TABS: ReadonlyArray<{ to: string; label: string; icon: LucideIcon }> = [
  { to: "/", label: "Beranda", icon: Home },
  { to: "/riwayat", label: "Riwayat", icon: History },
  { to: "/profil", label: "Profil", icon: User },
]

function isCurrent(pathname: string, to: string): boolean {
  if (to === "/") {
    return pathname === "/"
  }
  return pathname === to || pathname.startsWith(`${to}/`)
}

/// Whether this screen was pushed on top of a list.
///
/// A receipt is a drill-in, and DESIGN.md is unambiguous about what that costs
/// the chrome: the tab bar goes away and the left chip becomes a back arrow.
/// Leaving the bar up would offer a member two contradictory ways back.
function isPushed(pathname: string): boolean {
  return pathname.startsWith("/riwayat/")
}

/// What the app-bar says you are looking at.
///
/// Home gets the greeting, sections get their name, a detail gets the record —
/// DESIGN.md's three cases. The greeting is by clock rather than by name
/// because this system has no customer identity yet, and "Selamat pagi" is
/// true without one.
function titleFor(pathname: string): string {
  if (isPushed(pathname)) {
    return "Struk"
  }
  if (pathname === "/riwayat") {
    return "Riwayat"
  }
  if (pathname === "/profil") {
    return "Profil"
  }
  const hour = new Date().getHours()
  if (hour < 11) return "Selamat pagi"
  if (hour < 15) return "Selamat siang"
  if (hour < 19) return "Selamat sore"
  return "Selamat malam"
}

/// One layout, two shapes.
///
/// Below `md` the app is full-bleed and native-feeling: a borderless 3-zone
/// app-bar on top, a floating row of squircles at the bottom, content between.
/// From `md` up it becomes DESIGN.md's floating app-card on the `{backdrop}`
/// stage with a sidebar down its left, because a bar pinned to the bottom of a
/// 1400px window is a long way from what the reader is looking at.
export function AppShell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { member } = useSession()
  const pushed = isPushed(pathname)

  return (
    <div className="min-h-svh md:flex md:justify-center md:p-6">
      {/* Full-bleed below `md`: the card becomes the page, so it has to reach
          the bottom of the viewport or the `{backdrop}` stage shows through
          under a short screen. From `md` it is the floating app-card again and
          sizes to its content. */}
      <div className="min-h-svh w-full bg-canvas md:flex md:min-h-0 md:max-w-5xl md:overflow-hidden md:rounded-shell md:border md:border-hairline md:shadow-shell">
        <nav
          aria-label="Navigasi utama"
          className="hidden shrink-0 flex-col gap-1 border-r border-hairline bg-canvas p-3 md:flex md:w-56"
        >
          <div className="px-3 pt-3 pb-5">
            <p className="text-card-title font-semibold text-ink">
              Itulah Member
            </p>
            <p className="truncate text-meta text-body">
              {member.display_name ?? member.member_id}
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
                  // Quiet active state: a pale pill and the icon turning
                  // indigo. Never a heavier weight — that is the one thing
                  // DESIGN.md names twice.
                  "flex items-center gap-2.5 rounded-full px-3 py-2.5 text-nav font-medium transition-colors",
                  current
                    ? "bg-accent-bg text-ink"
                    : "text-text hover:bg-soft-2",
                )}
              >
                <tab.icon
                  className={cn(
                    "size-[1.0625rem]",
                    current ? "text-accent" : "text-line-ico",
                  )}
                />
                {tab.label}
              </Link>
            )
          })}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Borderless, three zones, pinned. The zones keep their width when
              they are empty so the title stays optically centred instead of
              shifting between screens. */}
          <header className="sticky top-0 z-20 bg-canvas/90 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
            <div className="flex items-center justify-between gap-2 px-4 py-2.5">
              <div className="flex w-11 justify-start">
                {pushed && (
                  <Chip
                    aria-label="Kembali ke riwayat"
                    render={<Link to="/riwayat" />}
                  >
                    <ArrowLeft />
                  </Chip>
                )}
              </div>
              <h1 className="truncate text-appbar font-semibold text-ink">
                {titleFor(pathname)}
              </h1>
              <div className="flex w-11 justify-end">
                {!pushed && (
                  <Chip aria-label="Profil" render={<Link to="/profil" />}>
                    <User />
                  </Chip>
                )}
              </div>
            </div>
          </header>

          <main
            className={cn(
              "mx-auto w-full max-w-3xl flex-1 px-4 pt-3 md:px-7 md:py-7",
              // Room for the floating bar plus the home indicator. Without it
              // the last row of a history sits permanently under the tabs.
              pushed
                ? "pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:pb-7"
                : "pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:pb-7",
            )}
          >
            {/* The page title, where there is no app-bar to carry it. Only
                one of the two is ever in the accessibility tree — the other is
                `display:none` at that width. */}
            <h1 className="mb-5 hidden text-hero font-semibold text-ink md:block">
              {titleFor(pathname)}
            </h1>
            <Outlet />
          </main>
        </div>
      </div>

      {!pushed && <TabBar pathname={pathname} />}
    </div>
  )
}

/// The floating squircle tab bar.
///
/// There is no containing bar — DESIGN.md is explicit, and it is what makes
/// the shape read as floating rather than as a docked toolbar. Three separate
/// squircles, the active one solid indigo with a white glyph, the rest pale
/// icons on a ghost `{soft-2}` tile.
///
/// The indigo tile is a single element that travels between the three, on
/// beUI's shared-layout spring: one squircle sliding across says the selection
/// moved, where three tiles recolouring says only that something changed.
function TabBar({ pathname }: { pathname: string }) {
  const reduce = useReducedMotion()

  return (
    <>
      {/* The scroll cue: content fades out under the bar rather than being
          clipped by it, so a half-visible row reads as "there is more" instead
          of as a rendering fault. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30 h-32 bg-gradient-to-t from-canvas via-canvas/90 to-transparent md:hidden"
      />
      <nav
        aria-label="Navigasi utama"
        className="fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:hidden"
      >
        <ul className="flex items-center gap-3.5">
          {TABS.map((tab) => {
            const current = isCurrent(pathname, tab.to)
            return (
              <li key={tab.to}>
                <Link
                  to={tab.to}
                  aria-label={tab.label}
                  aria-current={current ? "page" : undefined}
                  className="relative flex size-[3.375rem] items-center justify-center rounded-inner"
                >
                  {current && (
                    <motion.span
                      layoutId="tab-active"
                      transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                      className="absolute inset-0 rounded-inner bg-accent shadow-pop"
                    />
                  )}
                  {!current && (
                    <span className="absolute inset-0 rounded-inner border border-hairline bg-soft-2/90 shadow-soft backdrop-blur" />
                  )}
                  <tab.icon
                    className={cn(
                      "relative size-[1.25rem] transition-colors",
                      current ? "text-on-dark" : "text-line-ico",
                    )}
                  />
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </>
  )
}
