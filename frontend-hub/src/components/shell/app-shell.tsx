import { Outlet, useRouter } from "@tanstack/react-router"
import { useCallback, useEffect, useState } from "react"

import { AssistantPanel } from "@/components/assistant/panel"
import { AssistantProvider } from "@/components/assistant/session"
import { useAssistant } from "@/components/assistant/state"
import { CommandPalette } from "@/components/shell/command-palette"
import { Rail } from "@/components/shell/rail"
import { Sidebar } from "@/components/shell/sidebar"
import { TopBar } from "@/components/shell/top-bar"
import { SheetSpace } from "@/components/shell/sheet-space"
import { atLeast, useLayout } from "@/lib/layout"
import { useSheetsOpen } from "@/lib/sheet-space"
import { cn } from "@/lib/utils"

/// The shell: rail · sidebar · content. No header.
///
/// `inventory-prototype.html` renders `<header class="topbar" hidden>` — the
/// element is authored and then deliberately switched off, because the left-
/// hand navigation took over everything it carried. So this app has no
/// horizontal band of chrome at all, and every screen gets its full height.
///
/// The rail beside the sidebar came back on 2026-09-10 — `rail.tsx` carries
/// the argument, including the answer to the case that removed it. Here the
/// consequence is that ⌘B now HIDES the sidebar rather than narrowing it to a
/// column of icons: the rail is always standing, so nothing reachable in one
/// click became reachable in two, and two columns of icons side by side would
/// have been one too many.
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
  /// Undocked: whether the drawer is over the content.
  ///
  /// Deliberately NOT the same state as `labelled` — a drawer that
  /// "collapses" to a 58px strip floating over the content is neither of the
  /// two things a sidebar can usefully be, and one flag with two meanings is
  /// how that gets shipped.
  ///
  /// **A boolean, closed by whatever closes it.** This was a path — the
  /// screen the drawer was raised on — on the argument that "a drawer belongs
  /// to the screen it was raised on", so leaving that screen would shut it
  /// with nothing to keep in step. It did shut it. What the argument missed is
  /// that `drawerAt === pathname` is a predicate, and a predicate that has
  /// gone false can go true again:
  ///
  ///  - Open it on Purchase orders, walk to Suppliers, walk back — the path
  ///    matches again and the drawer is standing over the page, opened by
  ///    nobody. Same for the back button, and for any link that returns.
  ///  - Widen past 64rem and narrow again — zoom, a rotated iPad, a window
  ///    dragged wider — and it is there again, because the state outlived the
  ///    shell that could show it.
  ///
  /// Both were reported as the sidebar sticking, and both are the same bug:
  /// state that says WHERE instead of WHETHER.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const router = useRouter()

  /// A drawer belongs to the undocked shell, so it does not survive docking.
  /// Adjusted during render rather than in an effect — React's own answer for
  /// state that has to follow a prop — because an effect would let one frame
  /// commit with a drawer that should not exist.
  if (docked && drawerOpen) setDrawerOpen(false)

  // Docked, there is nothing to toggle: the sidebar is 64px of icons that
  // widens under the pointer and narrows again when it leaves. ⌘B therefore
  // only has work to do at the widths where navigation is a drawer.
  const toggleSidebar = useCallback(() => {
    if (!docked) setDrawerOpen((open) => !open)
  }, [docked])

  /// Every finished navigation shuts it. One subscription rather than a rule
  /// each in the drawer, the palette, the domain bar and every link a screen
  /// happens to render — the drawer is over the content, so arriving anywhere
  /// is reason enough, and this cannot be forgotten by the next screen added.
  useEffect(
    () => router.subscribe("onResolved", () => setDrawerOpen(false)),
    [router]
  )

  // ⌘K opens the palette and ⌘J the assistant. These used to have visible rows
  // in the sidebar as well — the discoverable half of the pair — and those were
  // removed on the owner's instruction. The shortcuts below are now the ONLY
  // way in, which is worth knowing before anybody wonders where the palette
  // went: it did not go anywhere, it just stopped announcing itself.
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
      if (event.key === "Escape") setDrawerOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [toggleSidebar, assistant])

  return (
    <div className="app-shell flex h-full w-full flex-col overflow-hidden bg-soft-3">
      {/* The bar spans the window at every width now: the domains are the one
          piece of navigation that never folds away, because they are how
          somebody gets back out of wherever they are. */}
      <TopBar onOpenNav={docked ? undefined : () => setDrawerOpen(true)} />
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-soft-3">
        {/* The rail is docked-only. Under 64rem it folds into the drawer with
            the rest of the navigation: a 56px strip permanently taking a
            seventh of a phone's width, to hold something a thumb opens once a
            session, is the trade the drawer exists to refuse. */}
        {docked && <Rail />}
        {/* `isolate` is load-bearing, not tidying. The rail is `z-30` and it
            WIDENS over the page on hover, so anything a screen stacks at 30 or
            above would be drawn through the open column — which is what a
            sticky table header and a frozen first column both do, because a
            frozen column has to out-stack the rows it slides over. Two screens
            had already reached z-30 and punched their header row through the
            rail's labels.

            Fixing the numbers screen by screen fixes it until the next table.
            Isolating here makes the page its own stacking context, so a
            screen's z-index is a statement about that screen and can never be
            read against the shell's. Floating layers are unaffected: base-ui
            portals its popups and sheets to `body`, outside this element. */}
        <div className="isolate flex min-h-0 min-w-0 flex-1 flex-col">
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
        <NavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
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
        {/* The rail used to come with it, because it was the department
            switcher and a drawer you cannot change department from is not a
            navigation drawer. The domains are in the bar now, and the bar is
            on screen at every width — so the drawer carries what it is for:
            the screens of the domain you are in, spelled out. Two copies of
            those, one as icons and one as words, is what it would be now. */}
        {/* Any link inside shuts it, as well as the path rule the caller
            holds. Those two are not the same rule, and the difference is the
            most-tapped row in the drawer: the one for the screen you are
            already on, drawn highlighted at the top of the list. Following it
            resolves to the same route, so the navigation subscription above
            has nothing to announce, and the drawer would sit there over the
            page with the veil up. */}
        <div
          className="contents"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a") !== null) onClose()
          }}
        >
          <Sidebar variant="drawer" open onToggle={onClose} />
        </div>
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
