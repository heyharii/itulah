import { Outlet } from "@tanstack/react-router"
import { useCallback, useEffect, useState } from "react"

import { AssistantPanel } from "@/components/assistant/panel"
import { AssistantProvider } from "@/components/assistant/session"
import { useAssistant } from "@/components/assistant/state"
import { CommandPalette } from "@/components/shell/command-palette"
import { Sidebar } from "@/components/shell/sidebar"

/// The shell: sidebar · content. No header, and no rail either.
///
/// `inventory-prototype.html` renders `<header class="topbar" hidden>` — the
/// element is authored and then deliberately switched off, because the left-
/// hand navigation took over everything it carried. So this app has no
/// horizontal band of chrome at all, and every screen gets its full height.
///
/// The rail that stood beside the sidebar is gone too: eleven modules did not earn
/// a switcher of their own, and one column that shows both the module and the
/// screen is a shorter thing to learn. Collapsing the sidebar (⌘B) narrows it
/// to the same 58px column of icons the rail used to be, so nothing that was
/// reachable in one click became reachable in two.
///
/// Density is baked into `:root { font-size: 14.4px }` rather than shipped as
/// `zoom: 0.9`. The prototypes use zoom because they are single files; DESIGN.md
/// is explicit that production must not.
export function AppShell() {
  return (
    <AssistantProvider>
      <Shell />
    </AssistantProvider>
  )
}

/// The shell proper, inside the assistant's session.
///
/// Split from `AppShell` only so the shortcut below can read that session:
/// a provider cannot be consumed by the component that renders it, and ⌘J
/// belongs beside ⌘K rather than in a second key handler somewhere else.
function Shell() {
  const assistant = useAssistant()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)

  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), [])
  const openPalette = useCallback(() => setPaletteOpen(true), [])

  // ⌘K is the always-available way into the palette; the sidebar's own
  // "Quick actions" row is the discoverable one, and "Ask" beside it is ⌘J.
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
      if (event.key === "j" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        assistant.setOpen(!assistant.open)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [toggleSidebar, assistant])

  return (
    <div className="flex h-full w-full overflow-hidden bg-canvas">
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-canvas">
        <Sidebar
          open={sidebarOpen}
          onToggle={toggleSidebar}
          onOpenPalette={openPalette}
          onOpenAssistant={() => assistant.setOpen(true)}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* The scroll container is here, not on `body`: screens below hold a
              table body or a detail rail that scrolls inside itself, and a page
              that grows instead would put a second scrollbar around the lot.

              There is no page transition. One was tried — a short fade and a
              4px rise on the incoming screen — and removed: moving between the
              screens of one module happens several times a minute,
              and an animation that reads as considered on the first click reads
              as lag on the tenth. Motion has to earn its place by explaining
              something, and a screen that is already where it is going has
              nothing to explain. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Outlet />
          </div>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      {/* Not modal: the panel is meant to be read beside the screen that
          raised the question, and a modal one would grey out the very rows
          somebody is asking about. */}
      <AssistantPanel />
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
