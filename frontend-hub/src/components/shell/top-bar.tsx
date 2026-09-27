import { Link, useRouterState } from "@tanstack/react-router"
import { ChevronDown, ChevronLeft, Menu, Sparkles } from "lucide-react"
import { useState } from "react"

import {
  allNavItems,
  domainForPath,
  domainHome,
  moduleForPath,
  modulesOfDomain,
  topBarAsides,
  type AppModule,
} from "@/lib/navigation"
import { AppSheet } from "@/components/shell/app-sheet"
import type { AppTile } from "@/lib/apps"
import { ClockChip } from "@/components/shell/clock-chip"
import { NotificationBell } from "@/components/shell/notification-bell"
import { cn } from "@/lib/utils"
import { useAssistant } from "@/components/assistant/state"

/// The bar over the page: where you are, and the tools that are not a place.
///
/// ## Why the domains left it
///
/// It held them, as a row of chips, from 2026-09-13 — and ran out of width,
/// because the list is the shape of the company and only ever grows. They are
/// the dark rail at the window's edge now (`rail.tsx`), and this bar is left
/// with the two things a bar is good at: a breadcrumb read left to right, and
/// a short row of tools at the far end.
///
/// It spans the PAGE, not the window. The rail and the sidebar run the full
/// height beside it, which is what makes them read as two columns rather than
/// as a frame drawn around the content.
export function TopBar({ onOpenNav }: { onOpenNav?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const domain = domainForPath(pathname)
  const module = moduleForPath(pathname)
  const screen = screenForPath(pathname)
  const assistant = useAssistant()
  const parent = domain?.label ?? module.label

  return (
    <header className="flex h-13 shrink-0 items-center gap-3 border-b border-hairline bg-canvas px-5 max-md:px-3">
      {onOpenNav && (
        <button
          type="button"
          onClick={onOpenNav}
          aria-label="Open navigation"
          // The shell decides whether there is a drawer to open — it passes
          // `onOpenNav` only when the columns are undocked — so this has no
          // breakpoint class of its own to disagree with it.
          className="-ml-1.5 grid size-tap shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-text"
        >
          <Menu className="size-[1.125rem] stroke-[1.7]" />
        </button>
      )}

      <PhoneTitle pathname={pathname} />
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 flex-1 items-center gap-2 text-[0.875rem] font-medium max-md:hidden"
      >
        {domain ? (
          <Link
            to={domainHome(domain)}
            className="inline-flex shrink-0 items-center gap-[0.4375rem] text-body transition-colors hover:text-ink"
          >
            <domain.icon className="size-[0.9375rem] stroke-[1.7] text-line-ico" />
            {parent}
          </Link>
        ) : (
          <span className="shrink-0 text-body">{parent}</span>
        )}
        {screen && screen.label !== parent && (
          <>
            <span aria-hidden className="text-faint">
              /
            </span>
            <span
              aria-current="page"
              className="inline-flex min-w-0 items-center gap-[0.4375rem] font-semibold text-ink"
            >
              <screen.icon className="size-[0.9375rem] shrink-0 stroke-[1.7] text-line-ico" />
              <span className="truncate">{screen.label}</span>
            </span>
          </>
        )}
      </nav>

      <div className="flex shrink-0 items-center gap-2">
        <ClockChip />
        {topBarAsides.map((aside) => (
          <AsideLink key={aside.id} aside={aside} here={module.id === aside.id} />
        ))}
        {/* On a phone the bell is the bottom bar's Notifications tab. */}
        <span className="contents max-md:hidden">
          <NotificationBell />
        </span>
        {/* The assistant, as a control with its word on it. It was a bare
            sparkle glyph that did nothing when pressed; ⌘J was the only way
            in. The bell that stood beside it is on the rail now — see
            `notification-bell.tsx`. */}
        <button
          type="button"
          onClick={() => assistant.setOpen(!assistant.open)}
          aria-pressed={assistant.open}
          title="Ask  ⌘J"
          className="inline-flex h-8 items-center gap-1.5 rounded-inner px-2.5 text-[0.875rem] font-medium text-body transition-colors hover:bg-soft-2 hover:text-ink aria-pressed:bg-soft-2 aria-pressed:text-ink"
        >
          <Sparkles className="size-[0.9375rem] stroke-[1.7] text-accent" />
          <span className="max-md:hidden">Ask</span>
        </button>
      </div>
    </header>
  )
}

/// The screen a path is on: the nav item with the longest path that is the
/// path or a prefix of it, so a record under `/finance/bills/42` still says
/// "Bills".
/// The page's name on a phone, where the breadcrumb does not fit and the
/// department's other screens are not a sidebar away.
///
/// Inside a department it is a button: the screen's name with a chevron, and
/// a tap opens the department's screens (`AppSheet`) — Purchase orders to
/// Suppliers in two taps, without going back to the launcher. On Messages it
/// is the switch between Chat and Discussions, which share the tab.
function PhoneTitle({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false)
  const domain = domainForPath(pathname)
  const module = moduleForPath(pathname)
  const screen = screenForPath(pathname)
  const title = screen?.label ?? domain?.label ?? module.label

  if (within(pathname, "/chat") || within(pathname, "/discussions")) {
    return (
      <nav aria-label="Messages" className="flex min-w-0 flex-1 md:hidden">
        <span className="inline-flex rounded-inner bg-soft-2 p-0.5">
          {[
            { to: "/chat", label: "Chat" },
            { to: "/discussions", label: "Discussions" },
          ].map((one) => {
            const on = within(pathname, one.to)
            return (
              <Link
                key={one.to}
                to={one.to as string}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center rounded-[calc(var(--r-inner)-2px)] px-3.5 text-[0.875rem] font-medium transition-colors",
                  on ? "bg-canvas text-ink shadow-soft" : "text-body"
                )}
              >
                {one.label}
              </Link>
            )
          })}
        </span>
      </nav>
    )
  }

  // The launcher's page opens with its own greeting, so the bar carries
  // the company — the sidebar's mark — rather than saying "Apps" twice.
  if (within(pathname, "/apps")) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2.5 md:hidden">
        <span className="grid size-7 shrink-0 place-items-center rounded-[0.4375rem] bg-dark text-[0.875rem] font-semibold tracking-[0.02em] text-on-dark">
          C
        </span>
        <b className="truncate text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink">
          Central
        </b>
      </span>
    )
  }

  if (domain === undefined) {
    // A screen opened from another one inside Profile — Leave from the
    // profile, a payslip from Pay — carries its way back, since the phone has
    // no sidebar to be read from. The parent is the path one segment up when
    // that is a screen, and the profile otherwise.
    const parent =
      within(pathname, "/me") && pathname !== "/me"
        ? (screenForPath(pathname.slice(0, pathname.lastIndexOf("/")))?.path ??
          "/me")
        : null
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1 md:hidden">
        {parent !== null && (
          <Link
            to={parent as string}
            aria-label="Back"
            className="-ml-2 grid size-tap shrink-0 place-items-center rounded-full text-line-ico active:bg-soft-2"
          >
            <ChevronLeft className="size-5" />
          </Link>
        )}
        <h1 className="min-w-0 flex-1 truncate text-[1rem] font-semibold text-ink">
          {title}
        </h1>
      </span>
    )
  }

  const tile: AppTile = {
    id: domain.id,
    label: domain.label,
    icon: domain.icon,
    modules: modulesOfDomain(domain),
  }
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center text-left md:hidden"
      >
        <span className="text-[0.875rem] leading-none font-medium text-mute">
          {domain.label}
        </span>
        <span className="flex max-w-full min-w-0 items-center gap-1 text-[1rem] leading-tight font-semibold text-ink">
          <span className="truncate">{title}</span>
          <ChevronDown className="size-4 shrink-0 text-line-ico" />
        </span>
      </button>
      <AppSheet tile={tile} open={open} onOpenChange={setOpen} />
    </>
  )
}

function within(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`)
}

function screenForPath(pathname: string) {
  let best: (typeof allNavItems)[number] | undefined
  for (const item of allNavItems) {
    const matches =
      pathname === item.path || pathname.startsWith(item.path + "/")
    if (matches && item.path.length > (best?.path.length ?? -1)) best = item
  }
  return best
}

/// One aside in the top bar, with the count it carries.
///
/// Its own component so the aside's `useCount` is one hook call at the top of
/// a component — `aside.useCount?.()` inside the `.map()` above would be a
/// hook in a loop body.
function AsideLink({ aside, here }: { aside: AppModule; here: boolean }) {
  const useCount = aside.useCount ?? noAsideCount
  const waiting = useCount()
  const label =
    typeof waiting === "number" && waiting > 0
      ? `${aside.label}, ${waiting} unread`
      : aside.label
  return (
    <Link
      to={aside.home}
      title={label}
      aria-label={label}
      aria-current={here ? "page" : undefined}
      className={cn(
        "relative grid size-8 shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-text pointer-coarse:size-tap",
        // On a phone these are the bottom bar's Messages tab.
        "max-md:hidden",
        here && "bg-soft-2 text-ink"
      )}
    >
      <aside.icon className="size-[1.0625rem] stroke-[1.55]" />
      {typeof waiting === "number" && waiting > 0 && (
        <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[0.6875rem] leading-none font-semibold text-white tabular-nums ring-2 ring-canvas">
          {waiting > 99 ? "99+" : waiting}
        </span>
      )}
    </Link>
  )
}

function noAsideCount(): null {
  return null
}
