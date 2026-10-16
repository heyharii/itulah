import { TimeTravel } from "@/components/shell/time-travel"
import { useRouterState } from "@tanstack/react-router"
import { ChevronLeft } from "lucide-react"

import { DepartmentScreens } from "@/components/shell/nav-column"
import {
  domainForPath,
  moduleAllowed,
  moduleForPath,
  modulesOfDomain,
  primaryItems,
  type AppDomain,
  type AppModule,
} from "@/lib/navigation"
import { useSections } from "@/lib/session"
import { homeNav } from "@/screens/home/nav"

/// What the light panel beside the rail is currently holding: one
/// department's label and the modules whose rows it draws.
interface NavPanel {
  id: string
  label: string
  modules: readonly AppModule[]
}

/// The screens panel's subject for the screen on show, or `null` when the
/// page has none.
///
/// Option A of `sidebar-types-prototype.html` (owner, 2026-10-04): the rail
/// answers which part of the business, this panel answers which screen of it.
/// The panel belongs to the DEPARTMENT you are in, so it holds the department
/// whenever the department has more than one screen of its own — and goes
/// away when it has not, because a panel of one row that repeats the icon you
/// just pressed is not an answer, it is an echo. One-screen places — Home,
/// the conversation asides, Reports, a person's profile — have no panel.
///
/// System is not a department, but it earns the panel the same way: its
/// screens (Users & job roles, Store servers) would otherwise be reachable
/// only by URL (owner, 2026-09-29).
// eslint-disable-next-line react-refresh/only-export-components -- a hook the shell and the panel both read, answered beside the panel it describes
export function useSubSidebar(): NavPanel | null {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { sections, bypass } = useSections()
  const domain = domainForPath(pathname)
  if (domain) return panelForDomain(domain, sections, bypass)
  const module = moduleForPath(pathname)
  if (
    module.id !== homeNav.id &&
    moduleAllowed(module, sections, bypass) &&
    primaryItems(module).length > 1
  ) {
    return { id: module.id, label: module.label, modules: [module] }
  }
  return null
}

/// A department's panel, whether or not it is the one on show — the floating
/// panel on a compact desk opens for the department whose rail icon was
/// pressed. Null when the department has one screen of its own.
// eslint-disable-next-line react-refresh/only-export-components -- the shell asks it for the department a rail press names
export function panelForDomain(
  domain: AppDomain,
  sections: ReturnType<typeof useSections>["sections"],
  bypass: boolean
): NavPanel | null {
  const modules = modulesOfDomain(domain).filter(
    (module) => !module.hidden && moduleAllowed(module, sections, bypass)
  )
  // Counted WITHOUT the audience hooks — the same compromise the one column's
  // `Department` makes: each module's `useAudience` is a hook, called by its
  // own row element in the panel, never inside this loop.
  const own = modules.flatMap((module) => primaryItems(module))
  return own.length > 1 ? { id: domain.id, label: domain.label, modules } : null
}

/// The light column between the rail and the page: the department you are
/// in, its label on the head and its screens down the body.
///
/// Canvas, hairlines and the accent for the row you are on — the panel reads
/// as part of the page, exactly so the charcoal rail reads as the one place
/// that answers the bigger question. The head is the rail brand's height, so
/// the three lower edges — rail, panel, page — are one line across the
/// window. `onFold` puts the fold in that head (⌘B); while the panel stands
/// it is the only fold affordance, and when it is away the rail's top takes
/// the panel back.
export function SubSidebar({
  onFold,
  panel: given,
}: {
  onFold?: () => void
  /// A department other than the one on show, when the floating panel is
  /// opened from the rail.
  panel?: NavPanel | null
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const current = useSubSidebar()
  const panel = given === undefined ? current : given
  if (!panel) return null
  return (
    <nav
      aria-label={panel.label}
      className="shell-panel flex h-full w-[14.5rem] shrink-0 flex-col border-r border-hairline bg-canvas"
    >
      <div className="flex h-13 shrink-0 items-center gap-1 border-b border-hairline pr-2 pl-4">
        <h2 className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink">
          {panel.label}
        </h2>
        {onFold && (
          <button
            type="button"
            onClick={onFold}
            aria-label="Hide the screens"
            title="Hide the screens  ⌘B"
            className="grid size-8 shrink-0 place-items-center rounded-inner text-mute transition-colors hover:bg-soft-2 hover:text-ink"
          >
            <ChevronLeft className="size-[1.125rem] stroke-[1.7]" />
          </button>
        )}
      </div>
      {/* Keyed on the department so its screens rise into place when the rail
          moves you between departments (`nav-swap`), and are left alone when
          a row inside is clicked. */}
      <div
        key={panel.id}
        className="nav-swap flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2.5"
      >
        <DepartmentScreens
          modules={panel.modules}
          pathname={pathname}
          tone="panel"
        />
      </div>
      {/* The business time, here since the desk's top strip went (4 Oct
          2026): a button for whoever may move the clock, plain text for
          everyone else. */}
      <div className="flex h-13 shrink-0 items-center border-t border-hairline px-4 [&_button]:mr-0 [&_button]:-ml-2.5">
        <TimeTravel place="header" />
      </div>
    </nav>
  )
}
