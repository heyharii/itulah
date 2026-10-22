import {
  Link,
  Outlet,
  useCanGoBack,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router"
import { LayoutGroup, motion, useReducedMotion } from "motion/react"
import { ArrowLeft } from "lucide-react"

import { Toaster } from "sonner"

import { Glyph, type GlyphName } from "@/components/matte"
import { PointsNotifier } from "@/components/points-notifier"
import { Chip } from "@/components/ui/chip"
import { SPRING_LAYOUT } from "@/lib/motion"
import { cn } from "@/lib/utils"

/// Four destinations. Named for what is behind them rather than for a
/// category, so a shopper can predict the screen before pressing.
const TABS: ReadonlyArray<{ to: string; label: string; glyph: GlyphName }> = [
  { to: "/", label: "Beranda", glyph: "home" },
  // Second, next to the thumb: redeeming is what members come back to do.
  { to: "/tukar-poin", label: "Tukar", glyph: "gift" },
  { to: "/riwayat", label: "Riwayat", glyph: "receipt" },
  { to: "/profil", label: "Profil", glyph: "user" },
]

function isCurrent(pathname: string, to: string): boolean {
  if (to === "/") return pathname === "/"
  return pathname === to || pathname.startsWith(`${to}/`)
}

/// A receipt is pushed on top of the history it came from; the card screen is
/// its own room. Neither shows the tab bar — both are somewhere you came
/// into, with one way out.
function pushedKind(pathname: string): "receipt" | "activity" | "card" | null {
  if (pathname.startsWith("/riwayat/")) return "receipt"
  if (pathname === "/notifikasi") return "activity"
  if (pathname === "/kartu") return "card"
  return null
}

export function AppShell() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const pushed = pushedKind(pathname)

  return (
    <>
      <PointsNotifier />
      {/* Toasts arrive from the top, under the status bar, and stack there —
          the bottom of the screen belongs to the tab bar. */}
      <Toaster
        position="top-center"
        offset={{ top: "calc(0.75rem + env(safe-area-inset-top))" }}
        mobileOffset={{ top: "calc(0.75rem + env(safe-area-inset-top))" }}
        gap={10}
        visibleToasts={3}
      />
      <Shell pathname={pathname} pushed={pushed} />
    </>
  )
}

function Shell({
  pathname,
  pushed,
}: {
  pathname: string
  pushed: ReturnType<typeof pushedKind>
}) {
  return (
    // One LayoutGroup around the whole app, so the card on Beranda and the
    // card on its own screen are recognised as the same object and travel
    // between the two positions rather than one vanishing and one appearing.
    <LayoutGroup>
      {pushed === "card" ? (
        <Outlet />
      ) : (
        <div className="min-h-svh">
          <div
            className={cn(
              "mx-auto w-full max-w-[30rem] px-4 pt-[calc(0.75rem+env(safe-area-inset-top))]",
              pushed === null
                ? "pb-[calc(7.5rem+env(safe-area-inset-bottom))]"
                : "pb-[calc(2rem+env(safe-area-inset-bottom))]",
            )}
          >
            {pushed !== null && <BackBar kind={pushed} />}
            {/* Keyed on the path: a pushed screen slides in a few percent from
                the side it was pushed from, a tab only fades — tabs change
                tens of times a visit, and travel on each would make the app
                feel slow. */}
            <main
              key={pathname}
              className={pushed === null ? "page-tab" : "page-push"}
            >
              <Outlet />
            </main>
          </div>
          {pushed === null && <TabBar pathname={pathname} />}
        </div>
      )}
    </LayoutGroup>
  )
}

/// The way out of a pushed screen. A receipt always goes back to history — a
/// link someone was sent may have no history behind it — while the activity
/// list goes back to wherever it was opened from.
function BackBar({ kind }: { kind: "receipt" | "activity" }) {
  const router = useRouter()
  const navigate = useNavigate()
  const canGoBack = useCanGoBack()
  return (
    <header className="mb-4 flex items-center">
      {kind === "receipt" ? (
        <Chip aria-label="Kembali ke riwayat" render={<Link to="/riwayat" />}>
          <ArrowLeft />
        </Chip>
      ) : (
        <Chip
          aria-label="Kembali"
          onClick={() => {
            if (canGoBack) router.history.back()
            else void navigate({ to: "/" })
          }}
        >
          <ArrowLeft />
        </Chip>
      )}
    </header>
  )
}

function TabBar({ pathname }: { pathname: string }) {
  const reduce = useReducedMotion()

  return (
    <>
      {/* Content fades out under the bar rather than being cut by it, so a
          half-visible row reads as "there is more". */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30 h-36 bg-gradient-to-t from-backdrop via-backdrop/85 to-transparent"
      />
      <nav
        aria-label="Navigasi utama"
        className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[calc(0.875rem+env(safe-area-inset-bottom))]"
      >
        {/* Solid white, not glass: matte has no material to look through.
            It stands on the page on its own soft shadow. */}
        <ul className="flex items-center gap-1 rounded-[1.625rem] bg-canvas p-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.05),0_14px_30px_-10px_rgb(24_40_90/0.22)]">
          {TABS.map((tab) => {
            const current = isCurrent(pathname, tab.to)
            return (
              <li key={tab.to}>
                <Link
                  to={tab.to}
                  aria-current={current ? "page" : undefined}
                  className="press relative flex h-[3.75rem] w-[4.875rem] flex-col items-center justify-center gap-0.5 rounded-[1.25rem]"
                >
                  {/* The pastel capsule is one object that moves, not four that
                      switch on and off: the eye follows the selection. */}
                  {current && (
                    <motion.span
                      layoutId="tab-active"
                      transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                      className="absolute inset-0 rounded-[1.25rem] bg-matte-ground"
                    />
                  )}
                  <Glyph
                    name={tab.glyph}
                    active={current}
                    className="relative size-6"
                  />
                  <span
                    className={cn(
                      "relative text-tab transition-colors duration-[var(--t-hover)]",
                      current ? "font-semibold text-matte-foot" : "font-medium text-mute",
                    )}
                  >
                    {tab.label}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </>
  )
}

/// A tab's large title, set the way iOS sets one: left-aligned, heavy by size
/// rather than by weight, with room above it for the status bar.
export function ScreenTitle({
  children,
  aside,
}: {
  children: React.ReactNode
  aside?: React.ReactNode
}) {
  return (
    <div className="mb-5 flex min-h-11 items-center justify-between gap-3 pt-1">
      <h1 className="text-title font-semibold text-ink">{children}</h1>
      {aside}
    </div>
  )
}
