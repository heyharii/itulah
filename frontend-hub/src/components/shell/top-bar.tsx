import { Link, useRouterState } from "@tanstack/react-router"
import { ChevronLeft, Menu, PanelLeft, Sparkles } from "lucide-react"

import {
  allNavItems,
  domainForPath,
  domainHome,
  moduleForPath,
  topBarAsides,
  type AppModule,
} from "@/lib/navigation"
import { BrandMark } from "@/components/brand-mark"
import { TimeTravel } from "@/components/shell/time-travel"
import { NotificationBell } from "@/components/shell/notification-bell"
import { cn } from "@/lib/utils"
import { useAssistant } from "@/components/assistant/state"
import { initialOf } from "@/lib/format"
import { useIdentity } from "@/lib/session"

/// The bar over the page: where you are, and the tools that are not a place.
///
/// ## Why the domains left it
///
/// It held them, as a row of chips, from 2026-09-13 — and ran out of width,
/// because the list is the shape of the company and only ever grows. They are
/// rows of the charcoal column at the window's edge now (`nav-column.tsx`),
/// and this bar is left with the two things a bar is good at: a breadcrumb
/// read left to right, and a short row of tools at the far end.
///
/// It spans the PAGE, not the window. The column runs the full height beside
/// it, which is what makes it read as a column rather than as a frame drawn
/// around the content.
export function TopBar({
  onOpenNav,
  onToggleNav,
  navOpen = true,
}: {
  onOpenNav?: () => void
  /// Folds and unfolds the docked column. Here rather than on the column so
  /// the switch is in the same place whether the column is open or folded —
  /// a control that moves with the thing it moves is hard to find twice.
  onToggleNav?: () => void
  navOpen?: boolean
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const domain = domainForPath(pathname)
  const module = moduleForPath(pathname)
  const screen = screenForPath(pathname)
  const assistant = useAssistant()
  const parent = domain?.label ?? module.label

  return (
    // On the page's own grey rather than white (2026-09-28, airy charcoal):
    // the bar is part of the page it names, separated by a hairline, not a
    // second strip of chrome across the top of it.
    <header className="flex h-13 shrink-0 items-center gap-3 border-b border-hairline bg-soft-3 px-5 max-md:bg-canvas max-md:px-3 max-md:[[data-header-band]_&]:border-b-transparent">
      {onToggleNav && (
        <button
          type="button"
          onClick={onToggleNav}
          aria-label={navOpen ? "Fold the menu" : "Unfold the menu"}
          aria-pressed={!navOpen}
          title={`${navOpen ? "Fold" : "Unfold"} the menu  ⌘B`}
          className="-ml-1.5 grid size-8 shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-text"
        >
          <PanelLeft className="size-[1.0625rem] stroke-[1.6]" />
        </button>
      )}
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
        {/* On a phone the bar holds the title and the profile, nothing else
            (owner, 2026-10-06): no clock, no Ask. */}
        <span className="contents max-md:hidden">
          <TimeTravel place="bar" />
        </span>
        {topBarAsides.map((aside) => (
          <AsideLink
            key={aside.id}
            aside={aside}
            here={module.id === aside.id}
          />
        ))}
        {/* On a phone the bell is the bottom bar's Notifications tab. */}
        <span className="contents max-md:hidden">
          <NotificationBell />
        </span>
        {/* The assistant, as a control with its word on it. It was a bare
            sparkle glyph that did nothing when pressed; ⌘J was the only way
            in. */}
        <button
          type="button"
          onClick={() => assistant.setOpen(!assistant.open)}
          aria-pressed={assistant.open}
          title="Ask  ⌘J"
          className="inline-flex h-8 items-center gap-1.5 rounded-inner px-2.5 text-[0.875rem] font-medium text-body transition-colors hover:bg-soft-2 hover:text-ink aria-pressed:bg-soft-2 aria-pressed:text-ink max-md:hidden"
        >
          <Sparkles className="size-[0.9375rem] stroke-[1.7] text-accent" />
          <span className="max-md:hidden">Ask</span>
        </button>
        <ProfileLink />
      </div>
    </header>
  )
}

/// The desk's header: a slim strip with the business time at its right end.
///
/// The "Find anything" bar it once held went on 2 Oct 2026 (search stays on
/// ⌘K and in the column), and for a day the desk had no bar at all. The owner
/// wanted the current time on show, so the strip came back with only that:
/// nothing on the left, no title, no search. The time is a button for whoever
/// may move the clock (it opens Time travel) and plain text for everyone else.
export function DeskBar() {
  return (
    // h-13: the rail brand's and the screens panel's head height, so the
    // three columns' lower edges are one line across the window.
    <header className="flex h-13 shrink-0 items-center justify-end border-b border-hairline bg-soft-3 px-5">
      <TimeTravel place="header" />
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
        <BrandMark className="size-7" />
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

  // The title says where this is and nothing more. Moving to another screen of
  // the department is the bottom bar's Menu tab (`bottom-bar.tsx`), in the
  // thumb's reach: a title with a chevron at the top of a tall phone was
  // pressed by nobody (owner, 2026-10-05).
  return (
    <h1 className="flex min-h-11 min-w-0 flex-1 items-center truncate text-[1.0625rem] leading-tight font-semibold text-ink md:hidden">
      <span className="truncate">{title}</span>
    </h1>
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

/// Profile, at the top of a phone's screen (owner, 2026-10-05): the account is
/// opened rarely, so it takes the corner a thumb reaches last, and the bottom
/// bar keeps to what is pressed all day. A circle with the initial, as phones
/// draw an account.
function ProfileLink() {
  const identity = useIdentity()
  const name = identity.data?.display_name ?? identity.data?.username ?? ""
  return (
    <Link
      to={"/me" as string}
      aria-label="Profile"
      title="Profile"
      // 32px to see, 44px to press: the ring of extra reach is invisible.
      className="relative grid size-8 shrink-0 place-items-center rounded-full bg-accent-bg text-[0.875rem] font-semibold text-accent transition-[scale] duration-(--t-press) ease-(--ease-out) select-none after:absolute after:-inset-1.5 after:content-[''] active:scale-[0.92] md:hidden"
    >
      {initialOf(name)}
    </Link>
  )
}
