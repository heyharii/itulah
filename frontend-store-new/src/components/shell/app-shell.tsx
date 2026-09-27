import { Outlet, useRouter, useRouterState } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"

import { BottomBar } from "@/components/shell/bottom-bar"
import { Rail } from "@/components/shell/rail"
import { Sidebar } from "@/components/shell/sidebar"
import { TopBar } from "@/components/shell/top-bar"
import { atLeast, useLayout } from "@/lib/layout"
import { hasSidebar, moduleForPath } from "@/lib/navigation"
import { cn } from "@/lib/utils"

/// The shell: rail · sidebar · (bar over content) — the hub's
/// (`frontend-hub/src/components/shell/app-shell.tsx`), so the till reads as
/// the same product as the console.
///
/// **One shell, three widths.** From 64rem (a counter monitor, a laptop, a
/// tablet held landscape) the rail and the sidebar are columns and ⌘B folds
/// the sidebar away. Between 48 and 64rem both fold into one drawer behind the
/// bar's menu button. Under 48rem a phone navigates from the bottom bar, whose
/// last tab opens the same drawer.
///
/// The page scrolls here, not on `body`: a screen that holds its own scrolling
/// list — the basket, the catalogue grid — needs a box of known height to do
/// it in, and a page that grew instead would put a second scrollbar around
/// the lot.
export function AppShell() {
  const layout = useLayout()
  const docked = atLeast(layout, "desktop")
  const phone = layout === "phone"
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // A module with one screen gets no column: the rail already names it.
  const column = hasSidebar(moduleForPath(pathname))

  /// Whether the drawer is over the content. A boolean, closed by whatever
  /// closes it — the hub's lesson: a drawer keyed to the path it was opened on
  /// re-opens itself when somebody comes back to that path.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen)

  // A drawer belongs to the undocked shell, so it does not survive docking.
  if (docked && drawerOpen) setDrawerOpen(false)

  const toggleSidebar = useCallback(() => {
    if (docked) {
      setSidebarOpen((open) => {
        writeSidebarOpen(!open)
        return !open
      })
    } else setDrawerOpen((open) => !open)
  }, [docked])

  // Every finished navigation shuts the drawer: arriving anywhere is reason
  // enough, and one subscription cannot be forgotten by the next screen added.
  useEffect(
    () => router.subscribe("onResolved", () => setDrawerOpen(false)),
    [router],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "b" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        toggleSidebar()
      }
      if (event.key === "Escape") setDrawerOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [toggleSidebar])

  return (
    <div className="app-shell flex h-svh w-full overflow-hidden bg-soft-3">
      {docked && (
        <Rail sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
      )}
      {docked && <DockedSidebar open={sidebarOpen && column} />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
        <TopBar
          onOpenNav={docked || phone ? undefined : () => setDrawerOpen(true)}
        />
        {/* `isolate`: a screen's z-index — a sticky basket footer, a frozen
            column — is a statement about that screen and never read against
            the shell's. Portalled layers are unaffected. */}
        <div className="isolate flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col overflow-y-auto",
              // The last row clears the bottom bar on a phone.
              phone && "pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))]",
            )}
          >
            <Outlet />
          </div>
        </div>
      </div>

      {phone && <BottomBar onOpenMenu={() => setDrawerOpen(true)} />}
      {!docked && (
        <NavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      )}
    </div>
  )
}

/// Both columns, over the content instead of beside it. Stays mounted and
/// slides, so it has somewhere to travel from; `inert` while shut, so a Tab
/// key cannot walk into rows nobody can see.
function NavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-[var(--scrim)] transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <div
        inert={!open}
        data-motion="travel"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex transition-transform duration-200 ease-out",
          open ? "translate-x-0 shadow-shell" : "-translate-x-full",
        )}
      >
        {/* Any link inside shuts it — including the row for the screen you
            are already on, which resolves to the same route and so gives the
            navigation subscription nothing to announce. */}
        <div
          className="contents"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a") !== null) onClose()
          }}
        >
          <Rail />
          <Sidebar variant="drawer" onClose={onClose} />
        </div>
      </div>
    </>
  )
}

/// The sidebar as a column, folded by sliding rather than by narrowing: a
/// column whose width animates makes every list beside it re-measure on every
/// frame. The width changes once per fold.
function DockedSidebar({ open }: { open: boolean }) {
  const [present, setPresent] = useState(open)
  const [shown, setShown] = useState(open)
  if (open && !present) setPresent(true)
  if (!open && shown) setShown(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    window.clearTimeout(timer.current)
    if (open) {
      let second = 0
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setShown(true))
      })
      return () => {
        cancelAnimationFrame(first)
        cancelAnimationFrame(second)
      }
    }
    // A timer rather than `transitionend`, which never fires when reduced
    // motion has taken the travel out.
    timer.current = window.setTimeout(() => setPresent(false), 220)
    return () => window.clearTimeout(timer.current)
  }, [open])

  return (
    <div
      className={cn(
        "relative h-full shrink-0 overflow-hidden",
        present ? "w-[15.5rem]" : "w-0",
      )}
    >
      <div
        inert={!open}
        className={cn(
          "absolute inset-y-0 left-0 h-full transition-[transform,opacity] duration-(--t-panel) ease-(--ease-out)",
          shown ? "translate-x-0 opacity-100" : "-translate-x-6 opacity-0",
        )}
      >
        {present && <Sidebar />}
      </div>
    </div>
  )
}

const SIDEBAR_KEY = "till.sidebar-open"

function readSidebarOpen(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) !== "0"
  } catch {
    return true
  }
}

function writeSidebarOpen(open: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_KEY, open ? "1" : "0")
  } catch {
    // A private window: the fold simply is not remembered.
  }
}
