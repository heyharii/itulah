import { Link, useRouterState } from "@tanstack/react-router"
import { House, PanelLeft } from "lucide-react"
import { useLayoutEffect, useRef, useState } from "react"

import {
  asides,
  topBarAsides,
  domainForPath,
  domainHome,
  domains,
  moduleForPath,
  type AppModule,
} from "@/lib/navigation"
import { officeFor, systemFor } from "@/lib/apps"
import { useIdentity } from "@/lib/session"
import { homeNav } from "@/screens/home/nav"
import { meNav } from "@/screens/me/nav"
import { systemNav } from "@/screens/system/nav"
import { cn } from "@/lib/utils"

/// The dark column at the window's left edge: which part of the business.
///
/// ## Why the domains came down off the bar
///
/// The bar across the top held them from 2026-09-13, and ran out of room: at
/// 1280px the tenth chip was already under the clock, and the list is the
/// shape of the company, so it only ever grows. A column grows downwards,
/// where a window has height to spare.
///
/// This is NOT the fourteen-icon strip that was removed before it. That one
/// held modules, so it grew with the codebase; this holds the ten domains,
/// and each carries its word under its icon — ten unlabelled glyphs are a
/// memory test, and Ops, Buying and Selling are three kinds of truck.
///
/// It is the one dark surface in the chrome, on purpose. The light column
/// beside it (`sidebar.tsx`) answers *which screen*, and reads as part of the
/// page; this answers the question above that, and being the only dark thing
/// on screen is how it says so.
///
/// ## Motion
///
/// One indicator, not one per tile: the lit tile's background is a single
/// element that slides to whichever domain is current, so moving from
/// Finance to HR is seen as a move rather than as one light going off and
/// another coming on. It is measured off the DOM rather than computed from
/// an index, because tile heights follow the root font size.
export function Rail({
  sidebarOpen,
  onToggleSidebar,
}: {
  sidebarOpen?: boolean
  /// Absent in the drawer, which has its own close and no column to fold.
  onToggleSidebar?: () => void
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const here = domainForPath(pathname)
  const active = moduleForPath(pathname)
  // Which doors this caller is offered: the launcher's rule, so a cashier's
  // desk shows Home and their own Profile rather than ten locked departments.
  const role = useIdentity().data?.role
  const office = officeFor(role)

  // The tile somebody just pressed, and the path they pressed it on. The
  // router only commits the new location once the screen's code and data
  // have arrived, and an indicator that waits for that is a click that seems
  // not to have landed. Tied to the path it was pressed on, so it lapses by
  // itself the moment the navigation lands — or any other one does.
  const [pressed, setPressed] = useState<{ id: string; on: string } | null>(
    null
  )
  // Home is a tile like the domains, so the indicator has somewhere to stand
  // on the one page that belongs to no department.
  const current = here?.id ?? (active.id === homeNav.id ? homeNav.id : null)
  const lit = pressed?.on === pathname ? pressed.id : current

  const list = useRef<HTMLDivElement>(null)
  // `glide` is false for the first placement: a page load that slides the
  // indicator in from the top is the rail announcing itself, which nobody
  // asked it to do. Every placement after that travels.
  const [mark, setMark] = useState<{
    top: number
    height: number
    glide: boolean
  } | null>(null)

  useLayoutEffect(() => {
    const tile = list.current?.querySelector<HTMLElement>("[data-lit]")
    setMark((prev) =>
      tile
        ? {
            top: tile.offsetTop,
            height: tile.offsetHeight,
            glide: prev !== null,
          }
        : null
    )
  }, [lit])

  return (
    <nav
      aria-label="Domains"
      className="flex h-full w-[5rem] shrink-0 flex-col items-stretch bg-rail text-rail-text"
    >
      <div
        ref={list}
        className="relative flex min-h-0 flex-1 [scrollbar-width:none] flex-col gap-0.5 overflow-y-auto px-1.5 pt-2 pb-2 [&::-webkit-scrollbar]:hidden"
      >
        {mark && (
          <span
            aria-hidden
            data-motion="travel"
            className={cn(
              "pointer-events-none absolute inset-x-1.5 top-0 rounded-inner bg-rail-3",
              mark.glide &&
                "transition-[transform,height] duration-(--t-panel) ease-(--ease-out)"
            )}
            style={{
              transform: `translateY(${mark.top}px)`,
              height: mark.height,
            }}
          />
        )}
        {[
          { id: homeNav.id, label: homeNav.label, icon: House, to: "/" },
          ...(office ? domains : []).map((domain) => ({
            id: domain.id,
            label: domain.label,
            icon: domain.icon,
            to: domainHome(domain),
          })),
        ].map((domain) => {
          const Icon = domain.icon
          const on = lit === domain.id
          return (
            <Link
              key={domain.id}
              to={domain.to}
              aria-current={current === domain.id ? "page" : undefined}
              data-lit={on ? "" : undefined}
              onClick={() => setPressed({ id: domain.id, on: pathname })}
              title={domain.label}
              className={cn(
                "relative flex shrink-0 flex-col items-center gap-[0.3125rem] rounded-inner px-0.5 pt-[0.5625rem] pb-[0.4375rem] transition-colors",
                on
                  ? "text-rail-ink"
                  : "text-rail-text hover:bg-rail-2 hover:text-rail-ink"
              )}
            >
              <Icon
                className={cn(
                  "size-[1.125rem] shrink-0 stroke-[1.7]",
                  on ? "text-rail-ink" : "text-rail-mute"
                )}
              />
              <span className="w-full overflow-hidden text-center text-[0.875rem] leading-none font-medium tracking-[-0.01em] whitespace-nowrap">
                {domain.label}
              </span>
            </Link>
          )
        })}
      </div>

      {/* The destinations that belong to no domain — discussions, chat,
          files, reports, System, Profile — as bare icons under a rule, two to a row,
          all one size so the foot of the rail reads as one block. The bell,
          chat and discussions are in the top bar beside Ask: they are what
          somebody checks while working, and the rail's foot is below the fold
          of the eye.
          They are not part of the answer the column above gives, so they do
          not wear its labels. */}
      <div className="flex shrink-0 flex-col items-center gap-1 border-t border-rail-hair px-1.5 pt-2 pb-3">
        <div className="grid grid-cols-2 gap-1">
          {[
            ...(office
              ? asides.filter((aside) => !topBarAsides.includes(aside))
              : []),
            ...(systemFor(role) ? [systemNav] : []),
            // Profile — the phone's fourth tab — is the desk's fourth tile:
            // your own attendance, leave and pay, one press from anywhere.
            meNav,
          ].map((aside) => (
            <AsideTile
              key={aside.id}
              module={aside}
              active={aside.id === active.id}
            />
          ))}
        </div>
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            aria-pressed={sidebarOpen}
            title={`${sidebarOpen ? "Hide" : "Show"} sidebar  ⌘B`}
            className="grid size-8 place-items-center rounded-inner text-rail-mute transition-colors hover:bg-rail-2 hover:text-rail-ink"
          >
            <PanelLeft className="size-[1.0625rem] stroke-[1.55]" />
          </button>
        )}
      </div>
    </nav>
  )
}

function AsideTile({ module, active }: { module: AppModule; active: boolean }) {
  const Icon = module.icon
  return (
    <Link
      to={module.home}
      title={module.label}
      aria-label={module.label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-inner transition-colors",
        active
          ? "bg-rail-3 text-rail-ink"
          : "text-rail-mute hover:bg-rail-2 hover:text-rail-ink",
        "pointer-coarse:size-tap"
      )}
    >
      <Icon className="size-4 stroke-[1.55]" />
    </Link>
  )
}
