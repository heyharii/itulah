import { Link, useRouterState } from "@tanstack/react-router"
import { ArrowUpRight, LogOut, PanelLeft } from "lucide-react"

import { BrandMark } from "@/components/brand-mark"
import { useGuardedSignOut, useSite } from "@/components/shell/sidebar"
import { RailTip } from "@/components/ui/rail-tip"
import { useIdentity } from "@/lib/session"
import {
  homePath,
  moduleForPath,
  modules,
  newsModule,
  tillLink,
  type AppModule,
} from "@/lib/navigation"
import { cn } from "@/lib/utils"

/// The dark rail: every module of the shop as an icon, the one you are in lit —
/// the hub's `NavColumn` (`frontend-hub/src/components/shell/nav-column.tsx`),
/// drawn for the shop's own menu.
///
/// Charcoal, in the rail's ramp (`--rail*`), so the sign-in door and the rail
/// are one material. It answers *which part of the shop*; the light panel
/// beside it (`SubSidebar`) answers which screen of it. A module with one
/// screen is its icon alone and has no panel. The mark at its head is the way
/// home; at the foot are the places that are not a module (the Cashier app,
/// Discuss) and the person.
///
/// Docked only (from 64rem). Under that the same menu is the drawer
/// (`DrawerNav`), with words.
export function Rail({
  panelOpen,
  onToggleNav,
}: {
  /// Whether the screens panel is standing beside the rail. When it is away,
  /// the rail offers it back.
  panelOpen: boolean
  onToggleNav: () => void
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const current = moduleForPath(pathname)
  const site = useSite()

  return (
    <nav
      aria-label="Navigation"
      className="flex h-full w-[4.25rem] shrink-0 flex-col bg-rail text-rail-text"
    >
      {/* The mark, at the desk bar's height so the three lower edges — rail,
          panel, page — are one line across the window. It is the way home. */}
      <div className="flex h-13 shrink-0 items-center justify-center border-b border-rail-hair px-2">
        <RailTip label={`${site} — home`}>
          <Link
            to={homePath as never}
            aria-label={`${site} — home`}
            className="grid place-items-center rounded-inner p-1 transition-colors hover:bg-rail-2"
          >
            <BrandMark className="size-7" />
          </Link>
        </RailTip>
      </div>

      <div className="flex min-h-0 flex-1 [scrollbar-width:none] flex-col items-center gap-0.5 overflow-y-auto px-2 pt-3 pb-3 [&::-webkit-scrollbar]:hidden">
        {modules.map((module) => (
          <RailLink
            key={module.id}
            module={module}
            lit={module.id === current.id}
          />
        ))}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-0.5 border-t border-rail-hair px-2 pt-2 pb-2.5">
        {!panelOpen && (
          <RailTip label="Show the screens  ⌘B">
            <button
              type="button"
              onClick={onToggleNav}
              aria-label="Show the screens"
              className="grid size-10 place-items-center rounded-inner text-rail-mute transition-colors hover:bg-rail-2 hover:text-rail-ink"
            >
              <PanelLeft className="size-[1.125rem] stroke-[1.6]" />
            </button>
          </RailTip>
        )}
        <CashierLink />
        <RailLink module={newsModule} lit={current.id === newsModule.id} />
        <Account />
      </div>
    </nav>
  )
}

/// One module as an icon: its name on hover, instantly (`RailTip`).
function RailLink({ module, lit }: { module: AppModule; lit: boolean }) {
  const Icon = module.icon
  return (
    <RailTip label={module.label}>
      <Link
        to={module.home as never}
        aria-label={module.label}
        aria-current={lit ? "page" : undefined}
        className={cn(
          "group relative flex size-10 shrink-0 items-center justify-center rounded-inner transition-colors",
          lit
            ? "bg-rail-3 font-medium text-rail-ink"
            : "text-rail-text hover:bg-rail-2 hover:text-rail-ink",
        )}
      >
        <Icon
          className={cn(
            "size-[1.125rem] shrink-0 stroke-[1.6] transition-colors",
            lit ? "text-rail-ink" : "text-rail-mute group-hover:text-rail-text",
          )}
        />
      </Link>
    </RailTip>
  )
}

/// The Cashier: another app, so it opens in its own tab and says so. No icon at
/// all when there is nowhere to send anybody.
function CashierLink() {
  if (tillLink.url === null) return null
  const Icon = tillLink.icon
  return (
    <RailTip label={`${tillLink.label} — opens in a new tab`}>
      <a
        href={tillLink.url}
        target="_blank"
        rel="noopener"
        aria-label={`${tillLink.label} (opens in a new tab)`}
        className="group relative flex size-10 shrink-0 items-center justify-center rounded-inner text-rail-text transition-colors hover:bg-rail-2 hover:text-rail-ink"
      >
        <Icon className="size-[1.125rem] shrink-0 stroke-[1.6] text-rail-mute transition-colors group-hover:text-rail-text" />
        <ArrowUpRight className="absolute top-1 right-1 size-3 text-rail-mute" />
      </a>
    </RailTip>
  )
}

/// The person, and the way out.
function Account() {
  const identity = useIdentity()
  const signOut = useGuardedSignOut()
  const name = identity.data?.display_name ?? identity.data?.username ?? "—"
  const initial = name.trim().charAt(0).toUpperCase() || "?"
  return (
    <div className="mt-1 flex flex-col items-center gap-1">
      <RailTip label={name}>
        <span
          aria-label={name}
          className="grid size-7 shrink-0 place-items-center rounded-full bg-rail-3 text-[0.875rem] font-semibold text-rail-ink shadow-[inset_0_0_0_1px_var(--rail-hair)]"
        >
          {initial}
        </span>
      </RailTip>
      <RailTip label="Sign out">
        <button
          type="button"
          aria-label="Sign out"
          onClick={signOut.run}
          disabled={signOut.pending}
          className="grid size-9 shrink-0 place-items-center rounded-inner text-rail-mute transition-colors hover:bg-rail-2 hover:text-rail-ink disabled:opacity-50"
        >
          <LogOut className="size-4 stroke-[1.7]" />
        </button>
      </RailTip>
    </div>
  )
}
