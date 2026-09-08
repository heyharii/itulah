import { Outlet, useRouterState } from "@tanstack/react-router"
import { useCallback, useEffect, useState } from "react"

import { AssistantPanel } from "@/components/assistant/panel"
import { AssistantProvider } from "@/components/assistant/session"
import { useAssistant } from "@/components/assistant/state"
import { CommandPalette } from "@/components/shell/command-palette"
import { Sidebar } from "@/components/shell/sidebar"
import { TopBar } from "@/components/shell/top-bar"
import { SheetSpace } from "@/components/shell/sheet-space"
import { atLeast, useLayout } from "@/lib/layout"
import { useSheetsOpen } from "@/lib/sheet-space"
import { cn } from "@/lib/utils"

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
///
/// **One shell, three widths.** Under 64rem the sidebar stops being a column
/// and becomes a drawer, and the topbar that was switched off comes back to
/// carry its handle — see `top-bar.tsx`. Nothing else about a screen changes at
/// that boundary; what changes is where the navigation lives, which is a fact
/// about the shell and belongs in exactly this file. The screens adapt through
/// two primitives instead: `<DataTable>` relays its columns as cards, and
/// `<Sheet>` arrives from the bottom rather than the right.
///
/// At the other end, from 96rem up, the shell hands the right-hand 29.5rem to
/// whichever record is open and lets the page narrow into what is left — so a
/// big monitor buys somebody the list AND the record rather than a wider
/// margin. Nothing new is drawn to fill the space: it is the same `<Sheet>`,
/// no longer covering the rows it was raised from.
export function AppShell() {
  return (
    <AssistantProvider>
      <SheetSpace>
        <Shell />
      </SheetSpace>
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
  const layout = useLayout()
  /// Whether the sidebar is a column in the layout or a drawer over it. The
  /// only place in the app that asks this question: everything below reaches
  /// for a `md:`/`lg:` class instead, and the two agree because `useLayout`
  /// breaks on Tailwind's own numbers.
  const docked = atLeast(layout, "desktop")
  /// Whether a record is standing beside the page rather than over it, which
  /// is the one thing a monitor does differently. `<Sheet>` says whether one
  /// is open; this file says what the page does about it.
  const sheets = useSheetsOpen()
  const beside = layout === "monitor" && sheets > 0
  /// Docked: whether the column shows its labels or narrows to icons.
  const [labelled, setLabelled] = useState(true)
  /// Undocked: which screen the drawer was raised over, or `null`.
  ///
  /// Deliberately NOT the same state as `labelled` — a drawer that
  /// "collapses" to a 58px strip floating over the content is neither of the
  /// two things a sidebar can usefully be, and one flag with two meanings is
  /// how that gets shipped.
  ///
  /// And deliberately a path rather than a boolean-plus-an-effect. **A drawer
  /// belongs to the screen it was raised on**, so saying that directly leaves
  /// nothing to keep in step: every way of leaving that screen — a row in the
  /// drawer, the palette, a link in a sheet, the back button — closes it,
  /// without any of them having to remember to.
  const [drawerAt, setDrawerAt] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const drawer = drawerAt === pathname

  const toggleSidebar = useCallback(() => {
    if (docked) setLabelled((on) => !on)
    else setDrawerAt((at) => (at === pathname ? null : pathname))
  }, [docked, pathname])
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
      // A drawer is over the content, so Escape has to be able to get out of
      // it. Harmless while it is already shut — React drops a set to the
      // value that is already there.
      if (event.key === "Escape") setDrawerAt(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [toggleSidebar, assistant])

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-canvas">
      {!docked && (
        <TopBar
          onOpenNav={() => setDrawerAt(pathname)}
          onOpenPalette={openPalette}
          onOpenAssistant={() => assistant.setOpen(true)}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-canvas">
        {docked && (
          <Sidebar
            open={labelled}
            onToggle={toggleSidebar}
            onOpenPalette={openPalette}
            onOpenAssistant={() => assistant.setOpen(true)}
          />
        )}
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
          {/* 29.5rem: the panel's 27.5, its 1rem inset off the right edge,
              and 1rem of air between it and the page.

              Padding rather than a flex sibling, because the panel is
              portalled and fixed — it is not in this tree to be laid out
              beside anything. And no transition on it: the tables inside
              measure their own box to decide how many columns they can afford,
              so an animated width would have them re-deciding twelve times on
              the way. The list arriving narrower is the same statement as the
              list becoming narrower, made without the flicker. */}
          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto",
              beside && "pr-[29.5rem]"
            )}
          >
            <Outlet />
          </div>
        </div>
      </div>

      {!docked && (
        <NavDrawer
          open={drawer}
          onClose={() => setDrawerAt(null)}
          onOpenPalette={openPalette}
          onOpenAssistant={() => assistant.setOpen(true)}
        />
      )}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      {/* Not modal: the panel is meant to be read beside the screen that
          raised the question, and a modal one would grey out the very rows
          somebody is asking about. */}
      <AssistantPanel />
    </div>
  )
}

/// The sidebar, over the content instead of beside it.
///
/// It stays mounted and slides, rather than being mounted when opened: the
/// travel is the whole point of a drawer — it says the navigation came from
/// the left edge and will go back there — and a panel that is inserted into the
/// DOM already open has nowhere to travel from. That is also why the closed
/// state is `inert` and not just off screen: eleven navigation rows a Tab key
/// can walk into but nobody can see is worse than no drawer at all.
///
/// Motion is 200ms, `--t-panel`: MOTION.md's band for a panel arriving, and the
/// duration the docked sidebar already animates its width over.
function NavDrawer({
  open,
  onClose,
  onOpenPalette,
  onOpenAssistant,
}: {
  open: boolean
  onClose: () => void
  onOpenPalette: () => void
  onOpenAssistant: () => void
}) {
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
          "fixed inset-0 z-40 bg-[var(--scrim)] transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />
      <div
        inert={!open}
        data-motion="travel"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex transition-transform duration-200 ease-out",
          open ? "translate-x-0 shadow-shell" : "-translate-x-full"
        )}
      >
        <Sidebar
          variant="drawer"
          open
          onToggle={onClose}
          onOpenPalette={onOpenPalette}
          onOpenAssistant={onOpenAssistant}
        />
      </div>
    </>
  )
}

/// The centred column every screen renders into. `max-w` and the desk gutters
/// are the prototype's, so two screens written by two people line up.
///
/// The gutters narrow on a phone rather than scaling: 30px each side of a
/// 375px screen spends a sixth of it on margin, and the content it is
/// protecting — a list of rows — has no need of that much air. The vertical
/// padding comes down with it, because a screen whose first row is 24px below
/// a 44px bar reads as a gap rather than as a page.
///
/// `fill` makes the column exactly as tall as the shell's scroll area and lays
/// its children out as a flex column, so a screen whose subject is one long
/// table can hand the table the leftover height with `flex-1` instead of
/// guessing at it. The guess is what `max-h-[calc(100vh-19rem)]` was: a
/// subtraction standing for a header, a search box and however many banners
/// happen to be showing, which is wrong the moment a banner appears or does
/// not — too short and the table stops halfway down an empty screen, too tall
/// and the page grows a second scrollbar.
export function PageContent({
  fill = false,
  children,
}: {
  fill?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "mx-auto max-w-[77.5rem] px-4 pt-4 pb-10 md:px-[1.875rem] md:pt-6 md:pb-14",
        fill && "flex h-full min-h-0 flex-col"
      )}
    >
      {children}
    </div>
  )
}
