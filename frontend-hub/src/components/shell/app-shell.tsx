import { Outlet, useRouter, useRouterState } from "@tanstack/react-router"
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"

/// The assistant, and every chart its answers can draw (recharts, d3), is its
/// own chunk fetched when the panel is first opened. The panel is asked for a
/// few times a day at most, and its ~130 KB gzipped of charting code used to
/// sit in the entry chunk — downloaded and parsed on every URL open, including
/// by a cashier who never asks a question (owner, 2026-10-10: "klik url-nya
/// masih lama"). `state.ts` and `session.tsx` stay eager: ⌘J and the composer's
/// trigger read the session without the panel's code.
const AssistantPanel = lazy(() =>
  import("@/components/assistant/panel").then((m) => ({
    default: m.AssistantPanel,
  }))
)
import { AssistantProvider } from "@/components/assistant/session"
import { useAssistant } from "@/components/assistant/state"
import { AccountOrb } from "@/components/shell/account-orb"
import { BottomBar } from "@/components/shell/bottom-bar"
import { DockProvider, useDockRow } from "@/components/shell/dock"
import { CommandPalette } from "@/components/shell/command-palette"
import { NavColumn } from "@/components/shell/nav-column"
import { PaletteOpener } from "@/components/shell/palette-opener"
import { RailPick } from "@/components/shell/rail-pick"
import {
  panelForDomain,
  SubSidebar,
  useSubSidebar,
} from "@/components/shell/sub-sidebar"
import { TopBar } from "@/components/shell/top-bar"
import { SheetSpace } from "@/components/shell/sheet-space"
import { StoreServerNews } from "@/components/shell/store-server-news"
import {
  atLeast,
  publishPageWidth,
  useCompactDesk,
  useLayout,
  useRecordBeside,
} from "@/lib/layout"
import { domains, type AppDomain } from "@/lib/navigation"
import { useSections } from "@/lib/session"
import { useSheetsOpen } from "@/lib/sheet-space"
import { cn } from "@/lib/utils"

/// The screens that hold one task and bring their own title and a way out
/// (owner, 10 Oct 2026: New allotment "kayak sheet satu page"). They keep the
/// rail, and the screens panel starts folded (owner, 14 Oct: "tetap ada inner
/// sidebar dan outer sidebar tapi innernya collapse saja").
// The Ops board is no longer one of them: it sits in the shell like every
// other page, its lanes and cards as they were (owner, 14 Oct: "board jangan
// gitu, tetap ada sidebarnya", "kanban jangan diubah").
const FOCUS_PATHS: readonly string[] = ["/allotment/new"]

/// The shell: rail · panel · (bar over page).
///
/// Option A of `sidebar-types-prototype.html` (owner, 2026-10-04), replacing
/// the one column that answered both navigation questions on its own since
/// 2026-09-28. The charcoal rail (`nav-column.tsx`) answers which part of the
/// business — the departments' icons, full height. The light panel beside it
/// (`sub-sidebar.tsx`) answers which screen — the department you are in, its
/// screens down the body. The bar spans only the page and carries the
/// business time (`top-bar.tsx`).
///
/// ⌘B folds the PANEL away, so a wide table gets the width back without the
/// rail ever leaving the screen. Whether it is folded is remembered per
/// browser — a convenience, not a record.
///
/// Density is baked into `:root { font-size: 14.4px }` rather than shipped as
/// `zoom: 0.9`. The prototypes use zoom because they are single files; DESIGN.md
/// is explicit that production must not.
///
/// **One shell, three widths.** Under 64rem both columns stop being columns
/// and become one drawer, and the bar carries its handle — see `top-bar.tsx`. Nothing else about a screen changes at
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
        <StoreServerNews />
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
  /// A task that is a page of its own — the allotment grid: the rail stays,
  /// the screens panel starts folded, no bar. The page carries its own title
  /// and Back.
  const focus = useRouterState({
    select: (state) => FOCUS_PATHS.includes(state.location.pathname),
  })
  /// Docked, but too narrow for the screens panel to stand beside the page
  /// (an iPad held sideways): the panel floats over it on demand.
  const compact = useCompactDesk() && docked
  const subSidebar = useSubSidebar()
  // A phone navigates from the bottom bar, not from a drawer behind a
  // hamburger — see `bottom-bar.tsx`. A tablet keeps the drawer.
  const phone = layout === "phone"
  /// Whether a record is standing beside the page rather than over it, which
  /// is the one thing a monitor does differently. `<Sheet>` says whether one
  /// is open; this file says what the page does about it.
  const sheets = useSheetsOpen()
  const beside = useRecordBeside() && sheets > 0
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
  const openPalette = useCallback(() => setPaletteOpen(true), [])
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen)
  /// On a task page (New allotment) the rail stays and the screens panel
  /// starts folded (owner, 14 Oct: "tetap ada inner sidebar dan outer sidebar
  /// tapi innernya collapse saja"). Opened there, it is opened for that visit
  /// only — the desk's own choice is left alone.
  const [focusPanel, setFocusPanel] = useState(false)
  if (!focus && focusPanel) setFocusPanel(false)
  const panelShown = focus ? focusPanel : sidebarOpen
  /// The floating screens panel, on a compact desk. A boolean closed by every
  /// finished navigation, like the drawer.
  const [floatDomain, setFloatDomain] = useState<string | null>(null)
  if (!compact && floatDomain !== null) setFloatDomain(null)
  const { sections, bypass } = useSections()
  const floatPanel =
    floatDomain === null
      ? null
      : (() => {
          const domain = domains.find((one) => one.id === floatDomain)
          return domain === undefined
            ? null
            : panelForDomain(domain, sections, bypass)
        })()
  /// A rail press on a compact desk: that department's screens, floating.
  const pick = useCallback(
    (domain: AppDomain) =>
      setFloatDomain((open) => (open === domain.id ? null : domain.id)),
    []
  )
  /// The column the page lives in, measured and published so the panels that
  /// stand beside a list ask the page's width rather than the window's — see
  /// `lib/layout.ts`. This column, not the scroll area inside it: the scroll
  /// area takes padding when a record stands beside it, and a width that
  /// shrank because of the answer would flip the answer back.
  const page = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = page.current
    if (!node) return
    // Once now, before the first paint: an observer's first report arrives
    // with the next frame, and a page that paints once with the wrong panel
    // and then re-lays is the flicker this whole measurement exists to stop.
    publishPageWidth(node.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) =>
      publishPageWidth(entry.contentRect.width)
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const router = useRouter()

  /// A drawer belongs to the undocked shell, so it does not survive docking.
  /// Adjusted during render rather than in an effect — React's own answer for
  /// state that has to follow a prop — because an effect would let one frame
  /// commit with a drawer that should not exist.
  if (docked && drawerOpen) setDrawerOpen(false)

  // Docked, ⌘B folds the screens panel away and the rail stays; undocked, it
  // opens and shuts the drawer that holds the whole column.
  const toggleSidebar = useCallback(() => {
    if (compact)
      setFloatDomain((open) =>
        open !== null ? null : (subSidebar?.id ?? null)
      )
    else if (docked && focus) setFocusPanel((open) => !open)
    else if (docked) {
      setSidebarOpen((open) => {
        writeSidebarOpen(!open)
        return !open
      })
    } else setDrawerOpen((open) => !open)
  }, [docked, compact, focus, subSidebar?.id])

  /// Every finished navigation shuts it. One subscription rather than a rule
  /// each in the drawer, the palette, the domain bar and every link a screen
  /// happens to render — the drawer is over the content, so arriving anywhere
  /// is reason enough, and this cannot be forgotten by the next screen added.
  useEffect(
    () =>
      router.subscribe("onResolved", () => {
        setDrawerOpen(false)
        setFloatDomain(null)
      }),
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
      if (event.key === "Escape") {
        setDrawerOpen(false)
        setFloatDomain(null)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [toggleSidebar, assistant])

  return (
    <RailPick.Provider value={compact ? pick : null}>
      <DockProvider phone={phone}>
        <div className="app-shell flex h-full w-full overflow-hidden bg-canvas">
          {/* The rail is docked-only and always the icons; the screens live in
          the light panel beside it. Under 64rem both become the drawer:
          68px + 232px of permanent chrome on a 768px screen, to hold
          something a thumb opens once a session, is the trade the drawer
          exists to refuse. */}
          {docked && (
            <NavColumn
              folded
              panelOpen={
                subSidebar === null ||
                (compact ? floatDomain !== null : panelShown)
              }
              onSearch={() => setPaletteOpen(true)}
              onToggleNav={toggleSidebar}
            />
          )}
          {/* Full height, beside the page column: the desk bar spans only the
          page, and the panel's head (the rail brand's height) is what lines
          the three columns' lower edges up. */}
          {docked && !compact && subSidebar !== null && panelShown && (
            <SubSidebar onFold={toggleSidebar} />
          )}
          {/* On a compact desk the panel is over the page, beside the rail: a
          scrim to tap away, and the panel in the light, with a shadow. */}
          {compact && floatPanel !== null && (
            <>
              <div
                aria-hidden
                onClick={() => setFloatDomain(null)}
                className="fixed inset-y-0 right-0 left-[4.25rem] z-40 bg-black/20"
              />
              <div className="fixed inset-y-0 left-[4.25rem] z-50 shadow-float">
                <SubSidebar onFold={toggleSidebar} panel={floatPanel} />
              </div>
            </>
          )}
          <div ref={page} className="shell-page flex min-h-0 min-w-0 flex-1 flex-col">
            {/* On a desk the header is a slim strip carrying only the business
            time (2 Oct 2026; the "Find anything" bar went, search stays on
            ⌘K and in the column). It sits outside the scroller below, so
            sticky table headers at `top-0` still stick to the strip's edge.
            Tablet and phone keep the old bar — the drawer's button and the
            page's name live there. */}
            {!docked && !focus && (
              <TopBar
                onOpenNav={phone ? undefined : () => setDrawerOpen(true)}
              />
            )}
            {/* `isolate` makes the page its own stacking context, so a screen's
            z-index — a sticky table header, a frozen first column — is a
            statement about that screen and can never be read against the
            shell's. Floating layers are unaffected: base-ui portals its
            popups and sheets to `body`, outside this element. */}
            <div className="isolate flex min-h-0 min-w-0 flex-1 flex-col">
              {/* The scroll container is here, not on `body`: screens below hold a
              table body or a detail rail that scrolls inside itself, and a page
              that grows instead would put a second scrollbar around the lot.

              There is no page transition. One was tried — a short fade and a
              4px rise on the incoming screen — and removed: moving between the
              screens of one module happens several times a minute,
              and an animation that reads as considered on the first click reads
              as lag on the tenth. The sidebar's list swaps with that motion
              instead, and only when the domain changes — see `nav-swap`. */}
              {/* 29.5rem: the panel's 27.5, its 1rem inset off the right edge,
              and 1rem of air between it and the page.

              Padding rather than a flex sibling, because the panel is
              portalled and fixed — it is not in this tree to be laid out
              beside anything. And no transition on it: the tables inside
              measure their own box to decide how many columns they can afford,
              so an animated width would have them re-deciding twelve times on
              the way. */}
              <div className="flex min-h-0 min-w-0 flex-1">
                {/* The page can offer the palette a place to be found — the
                phone's Home does, since a phone has no ⌘K. */}
                <PaletteOpener.Provider value={openPalette}>
                  <PageScroller phone={phone} beside={beside} />
                </PaletteOpener.Provider>
              </div>
            </div>
          </div>

          {phone && !focus && <BottomBar />}
          {/* The account corner — chat, discussions, notifications, profile,
          search, sign-out — as one orb over every screen, on every device
          (owner, 2026-10-16: account-corner-prototype.html E). After the
          bars, so it can find the bottom bar it rests above. */}
          {!docked && (
            <AccountOrb onSearch={openPalette} bars={`${layout}-${focus}`} />
          )}
          {!docked && !phone && (
            <NavDrawer
              open={drawerOpen}
              onClose={() => setDrawerOpen(false)}
              onSearch={() => {
                setDrawerOpen(false)
                setPaletteOpen(true)
              }}
            />
          )}
          <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
          {/* Not modal: the panel is meant to be read beside the screen that
          raised the question, and a modal one would grey out the very rows
          somebody is asking about. */}
          <Suspense fallback={null}>
            <AssistantPanel />
          </Suspense>
        </div>
      </DockProvider>
    </RailPick.Provider>
  )
}

/// The page's scroll container: the one place the bottom bar's height is read.
/// On a phone the last row clears the bottom bar, and, while a screen has put
/// its tabs or its action in the context row above it (`dock.tsx`), that row
/// too.
function PageScroller({ phone, beside }: { phone: boolean; beside: boolean }) {
  const row = useDockRow()
  return (
    <div
      className={cn(
        "min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain",
        phone &&
          (row
            ? // The stack under the last row: the bar (53), the 8px under
              // the drawer, and the drawer's 44px controls in their 8px rim
              // (62) — 123, with a pixel to spare (D1).
              "pb-[calc(7.75rem+env(safe-area-inset-bottom,0px))]"
            : "pb-[calc(3.25rem+env(safe-area-inset-bottom,0px))]"),
        beside && "pr-[29.5rem]"
      )}
    >
      <Outlet />
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
  onSearch,
}: {
  open: boolean
  onClose: () => void
  onSearch: () => void
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
          "fixed inset-0 z-40 bg-[var(--scrim)] transition-opacity duration-(--t-sheet) ease-(--ease-out)",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />
      <div
        inert={!open}
        data-motion="travel"
        className={cn(
          // The iOS sheet curve, in at `--t-sheet` and out at `--t-exit`: the
          // same pace every other panel in the app keeps.
          "fixed inset-y-0 left-0 z-50 flex transition-transform ease-(--ease-drawer)",
          open
            ? "translate-x-0 shadow-shell duration-(--t-sheet)"
            : "-translate-x-full duration-(--t-exit)"
        )}
      >
        {/* The desk's own column: a drawer you cannot change department
            from is not a navigation drawer. */}
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
          <NavColumn variant="drawer" onClose={onClose} onSearch={onSearch} />
        </div>
      </div>
    </>
  )
}

const SIDEBAR_KEY = "hub.sidebar-open"

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
/// guessing at it. The guess is what `max-h-[calc(100dvh-19rem)]` was: a
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
        // Airy on a desk (2026-09-28): 32px gutters, 28px under the bar.
        "page-content mx-auto max-w-[100rem] px-4 pt-4 pb-10 md:px-8 md:pt-7 md:pb-16",
        fill && "flex h-full min-h-0 flex-col pb-4 md:pb-6"
      )}
    >
      {children}
    </div>
  )
}
