import { Outlet } from "@tanstack/react-router"
import { useCallback, useEffect, useState } from "react"

import { CommandPalette } from "@/components/shell/command-palette"
import { IconRail } from "@/components/shell/icon-rail"
import { Sidebar } from "@/components/shell/sidebar"

/// The shell: rail · sidebar · content. No header.
///
/// `inventory-prototype.html` renders `<header class="topbar" hidden>` — the
/// element is authored and then deliberately switched off, because the 58px
/// rail and the sidebar took over everything it carried. Reproducing that means
/// this app has exactly one horizontal band of chrome (the rail's left edge)
/// and gives every screen its full height back.
///
/// Density is baked into `:root { font-size: 14.4px }` rather than shipped as
/// `zoom: 0.9`. The prototypes use zoom because they are single files; DESIGN.md
/// is explicit that production must not.
export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)

  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), [])
  const openPalette = useCallback(() => setPaletteOpen(true), [])

  // ⌘K is the always-available way into the palette; the rail's magnifier and
  // the workspace chip are the discoverable ones.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
      if (event.key === "b" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [toggleSidebar])

  return (
    <div className="flex h-full w-full overflow-hidden bg-canvas">
      <IconRail onToggleSidebar={toggleSidebar} onOpenPalette={openPalette} />
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-canvas">
        <Sidebar open={sidebarOpen} onOpenPalette={openPalette} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* The scroll container is here, not on `body`: screens below hold a
              table body or a detail rail that scrolls inside itself, and a page
              that grows instead would put a second scrollbar around the lot. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Outlet />
          </div>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  )
}

/// The centred column every screen renders into. `max-w` and the gutters are
/// the prototype's, so two screens written by two people line up.
export function PageContent({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[77.5rem] px-[1.875rem] pt-6 pb-14">
      {children}
    </div>
  )
}
