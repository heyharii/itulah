import { Outlet, useRouterState } from "@tanstack/react-router"
import { Menu } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { Rail } from "@/shell/rail"
import { Sidebar } from "@/shell/sidebar"
import { modules } from "@/modules"
import { useLayout } from "@/lib/layout"
import { moduleFor } from "@/lib/nav"
import { cn } from "@/lib/cn"

/// The shell: rail · sidebar · content. No header while there is room for one
/// without it.
///
/// A horizontal band of chrome would cost 44px on every screen to hold what the
/// left-hand columns already carry, and the one thing it usually adds — a page
/// title — belongs to the screen rather than to the shell, which is where it is
/// written. It comes back only under 768px, where there is no left-hand column
/// to carry the handle.
///
/// ## One shell, three widths
///
/// The boundaries and their reasons are in `lib/layout.ts`. What this file does
/// about them:
///
///   **docked** — both columns stand beside the content.
///   **rail** — the sidebar becomes a drawer; the rail stays, so switching
///     department is still one press.
///   **bare** — both fold into the drawer, behind a top bar.
///
/// A drawer belongs to the SCREEN it was opened on, which is why its state is a
/// pathname and not a boolean. Every way of leaving that screen — a row in the
/// drawer, a link in a sheet, the back button — closes it, without any of them
/// having to remember to.
///
/// ⌘B hides the docked sidebar rather than narrowing it. The rail is still
/// standing, so navigation never leaves; the switch is on the rail for the same
/// reason (see `rail.tsx`).
export function Shell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const layout = useLayout()
  const docked = layout === "docked"

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [drawerAt, setDrawerAt] = useState<string | null>(null)
  const drawerOpen = drawerAt === pathname

  const active = moduleFor(modules, pathname)

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((on) => !on)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "b" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        if (docked) toggleSidebar()
        else setDrawerAt((at) => (at === pathname ? null : pathname))
      }
      // A drawer is over the content, so Escape has to get out of it. Harmless
      // while it is already shut — React drops a set to the value it holds.
      if (event.key === "Escape") setDrawerAt(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [docked, pathname, toggleSidebar])

  return (
    <div className="bg-canvas flex h-full w-full flex-col overflow-hidden">
      {layout === "bare" && (
        <header className="border-line bg-side flex h-12 shrink-0 items-center gap-2 border-b px-2">
          <button
            type="button"
            onClick={() => setDrawerAt(pathname)}
            aria-label="Open navigation"
            className="size-tap rounded-ctl text-ink-3 hover:bg-hover hover:text-ink grid shrink-0 place-items-center transition-colors"
          >
            <Menu className="size-[18px] stroke-[1.7]" />
          </button>
          <span className="text-cell truncate font-semibold">
            {active?.label ?? "Central"}
          </span>
        </header>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {layout !== "bare" && (
          <Rail
            modules={modules}
            pathname={pathname}
            sidebarOpen={docked ? sidebarOpen : drawerOpen}
            onToggleSidebar={
              docked
                ? toggleSidebar
                : () => setDrawerAt(drawerOpen ? null : pathname)
            }
          />
        )}

        {/* Width rather than unmounting, so the panel travels instead of
            blinking — the travel is what says where it went. `overflow-hidden`
            on the wrapper, not on the sidebar: the sidebar keeps its own
            scroll, and clipping it here is what lets its content stay laid out
            at full width while the box around it closes. */}
        {docked && (
          <div
            className={cn(
              "shrink-0 overflow-hidden transition-[width] duration-200 ease-out",
              sidebarOpen ? "w-side" : "w-0",
            )}
          >
            <Sidebar module={active} onOpenPalette={() => {}} />
          </div>
        )}

        {/* The scroll container is here, not on `body`: a screen below may hold
            a table body that scrolls inside itself, and a page that grew
            instead would put a second scrollbar around the lot. */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>
      </div>

      {!docked && (
        <Drawer
          open={drawerOpen}
          withRail={layout === "bare"}
          module={active}
          pathname={pathname}
          onClose={() => setDrawerAt(null)}
        />
      )}
    </div>
  )
}

/// The navigation, over the content instead of beside it.
///
/// It stays mounted and slides rather than being mounted when opened: the
/// travel is the whole point of a drawer — it says the navigation came from the
/// left edge and will go back there — and a panel inserted into the DOM already
/// open has nowhere to travel from. That is also why the closed state is
/// `inert` rather than merely off screen: a column of navigation rows a Tab key
/// can walk into but nobody can see is worse than no drawer at all.
function Drawer({
  open,
  withRail,
  module,
  pathname,
  onClose,
}: {
  open: boolean
  /// At tablet width the rail is still standing beside the content, so the
  /// drawer carries only the panel. Under 768 it carries both, because there is
  /// nothing left on screen to switch department from.
  withRail: boolean
  module: ReturnType<typeof moduleFor>
  pathname: string
  onClose: () => void
}) {
  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-[var(--veil)] transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <div
        inert={!open}
        data-motion="travel"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex transition-transform duration-200 ease-out",
          open ? "shadow-pop translate-x-0" : "-translate-x-full",
        )}
      >
        {withRail && <Rail modules={modules} pathname={pathname} />}
        <Sidebar
          module={module}
          onOpenPalette={() => {}}
          onNavigate={onClose}
        />
      </div>
    </>
  )
}
