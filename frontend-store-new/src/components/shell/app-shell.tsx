import { Outlet, useRouter } from "@tanstack/react-router"
import { useCallback, useEffect, useState } from "react"

import { BottomBar } from "@/components/shell/bottom-bar"
import { DockProvider, useDockRow } from "@/components/shell/dock"
import { Rail } from "@/components/shell/rail"
import {
  DrawerNav,
  SubSidebar,
  useSubSidebar,
} from "@/components/shell/sidebar"
import { TopBar } from "@/components/shell/top-bar"
import { atLeast, useLayout } from "@/lib/layout"
import { usePriceBookWatch } from "@/lib/price-book-watch"
import { cn } from "@/lib/utils"

/// The shell: rail · panel · (bar over page) — the hub's
/// (`frontend-hub/src/components/shell/app-shell.tsx`), so the shop's back
/// office reads as the same product as the console.
///
/// The charcoal rail (`rail.tsx`) answers *which part of the shop* — the
/// modules as icons, full height. The light panel beside it (`sidebar.tsx`)
/// answers *which screen* — the module you are in, its screens down the body;
/// a module with one screen has no panel. The bar spans only the page.
///
/// ⌘B folds the PANEL away, so a wide grid gets the width back without the rail
/// ever leaving the screen. Whether it is folded is remembered per browser — a
/// convenience, not a record.
///
/// **One shell, three widths.** From 64rem (a counter monitor, a laptop, a
/// tablet held landscape) the rail and the panel are columns. Between 48 and
/// 64rem both fold into one drawer behind the bar's menu button. Under 48rem a
/// phone navigates from the bottom bar (`bottom-bar.tsx`), whose last tab opens
/// the same drawer, and whose dock row carries the screen's own search, status
/// and "+" (`dock.tsx`).
///
/// The page scrolls here, not on `body`: a screen that holds its own scrolling
/// list needs a box of known height to do it in, and a page that grew instead
/// would put a second scrollbar around the lot.
export function AppShell() {
  const layout = useLayout()
  const docked = atLeast(layout, "desktop")
  const phone = layout === "phone"
  const router = useRouter()
  const sub = useSubSidebar()
  usePriceBookWatch()

  /// Whether the drawer is over the content. A boolean, closed by whatever
  /// closes it — the hub's lesson: a drawer keyed to the path it was opened on
  /// re-opens itself when somebody comes back to that path.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen)

  // A drawer belongs to the undocked shell, so it does not survive docking.
  if (docked && drawerOpen) setDrawerOpen(false)

  // Docked, ⌘B folds the screens panel away and the rail stays; undocked, it
  // opens and shuts the drawer that holds the whole menu.
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
    <DockProvider phone={phone}>
      <div className="app-shell flex h-full w-full overflow-hidden bg-canvas">
        {docked && (
          <Rail
            panelOpen={sub === null || sidebarOpen}
            onToggleNav={toggleSidebar}
          />
        )}
        {docked && sub !== null && sidebarOpen && (
          <SubSidebar module={sub} onFold={toggleSidebar} />
        )}
        <div className="shell-page flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Docked there is no bar, as in the hub: the rail and the panel say
              where you are, the page opens with its own sticky head, and the
              bar's tools (sync, Discuss) stand in the rail's foot. Tablet and
              phone keep it — the drawer's button and the screen's name. */}
          {!docked && (
            <TopBar
              onOpenNav={phone ? undefined : () => setDrawerOpen(true)}
              onOpenAccount={phone ? () => setDrawerOpen(true) : undefined}
            />
          )}
          {/* `isolate`: a screen's z-index — a sticky footer, a frozen column —
              is a statement about that screen and never read against the
              shell's. Portalled layers are unaffected. */}
          <div className="isolate flex min-h-0 min-w-0 flex-1 flex-col">
            <PageScroller phone={phone} />
          </div>
        </div>

        {phone && <BottomBar onOpenMenu={() => setDrawerOpen(true)} />}
        {!docked && (
          <NavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
        )}
      </div>
    </DockProvider>
  )
}

/// The page's scroll container: the one place the bottom bar's height is read.
/// On a phone the last row clears the bottom bar, and, while a screen has put
/// its search or its action in the context row above it (`dock.tsx`), that row
/// too.
function PageScroller({ phone }: { phone: boolean }) {
  const row = useDockRow()
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain",
        phone &&
          (row
            ? "pb-[calc(7rem+env(safe-area-inset-bottom,0px))]"
            : "pb-[calc(3.25rem+env(safe-area-inset-bottom,0px))]"),
      )}
    >
      <Outlet />
    </div>
  )
}

/// The menu, over the content instead of beside it. Stays mounted and slides,
/// so it has somewhere to travel from; `inert` while shut, so a Tab key cannot
/// walk into rows nobody can see.
///
/// The iOS sheet curve, in at `--t-sheet` and out at `--t-exit`: the same pace
/// every other panel in the app keeps.
function NavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      {/* The veil is WHITE, like every other overlay in this system: the screen
          behind a drawer washes toward near-white and never darkens. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-[var(--scrim)] transition-opacity duration-(--t-sheet) ease-(--ease-out)",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <div
        inert={!open}
        data-motion="travel"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex transition-transform ease-(--ease-drawer)",
          open
            ? "translate-x-0 shadow-shell duration-(--t-sheet)"
            : "-translate-x-full duration-(--t-exit)",
        )}
      >
        {/* Any link inside shuts it — including the row for the screen you are
            already on, which resolves to the same route and so gives the
            navigation subscription nothing to announce. */}
        <div
          className="contents"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a") !== null) onClose()
          }}
        >
          <DrawerNav onClose={onClose} />
        </div>
      </div>
    </>
  )
}

/// The panel, folded by sliding rather than by narrowing: a column whose width
/// animates makes every list beside it re-measure on every frame. The width
/// changes once per fold.
const SIDEBAR_KEY = "store.sidebar-open"

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
