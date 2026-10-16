import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { useRouterState } from "@tanstack/react-router"

import type { AppTile } from "@/lib/apps"
import { useMounted } from "@/lib/use-mounted"
import { domainForPath, modulesOfDomain } from "@/lib/navigation"

/// The phone's context row: a strip over the bottom bar that carries what the
/// screen under it is about — its tabs, and the one thing it makes (owner,
/// 2026-10-05).
///
/// ## Why it is not in the page
///
/// A phone is held in one hand and the thumb lives in the lower third. Tabs at
/// the top of a list, and a round "+" floating over its last row, were the two
/// things a thumb had to leave its place for or work around. Both are drawn
/// here instead, directly over the bottom bar, so everything pressed all day
/// sits in one reachable stack: the screen's own controls, then the app's.
/// Nothing goes in the header (owner's word): it is the part of the screen a
/// thumb reaches last.
///
/// ## How a screen uses it
///
/// It does not mount anything of its own. A screen says `<SubTabs dock …>` or
/// renders a `<Fab>`, and on a phone those draw into the slots below through a
/// portal, and nowhere else. The row is shown while at least one of them is
/// mounted, so a screen with neither has no empty strip, and the page's bottom
/// padding follows (`useDockRow`).
///
/// ## Why counts and not a flag
///
/// Moving between two screens that both use the dock unmounts one and mounts
/// the other in the same commit. A boolean set by each would flash the row
/// off and back on; counts change together and net to the same number.

export type DockSlot = "search" | "tabs" | "action"
export type DockView = "rest" | "menu" | "search" | "status" | "sort"

interface DockValue {
  /// This is a phone, whether or not the slots have attached yet. A screen
  /// asks this to decide where its tabs go, so they are never drawn inline for
  /// the first frame and then jump.
  readonly phone: boolean
  /// A phone with the bottom bar mounted, and so somewhere to draw.
  readonly available: boolean
  readonly search: HTMLElement | null
  readonly tabs: HTMLElement | null
  readonly action: HTMLElement | null
  /// What the drawer is showing. `rest` is the row of tabs and the action;
  /// `menu` is the list that asks whether to search, filter or sort; `search`
  /// is the field; `status` is the list of the screen's statuses; `sort` is the list of
  /// what it can be sorted by. Anything but `rest` takes the whole drawer: the tabs and the
  /// action step aside and it grows to hold the view.
  readonly view: DockView
  readonly setView: (view: DockView) => void
  /// The department the screen belongs to, while it is inside one (not the
  /// launcher, not Chat). The bottom bar turns into its screens.
  readonly department: AppTile | null
  /// How many things hold each slot right now.
  readonly claimed: Readonly<Record<DockSlot, number>>
  readonly attach: (slot: DockSlot, element: HTMLElement | null) => void
  readonly claim: (slot: DockSlot) => () => void
}

const DockContext = createContext<DockValue | null>(null)

export function DockProvider({
  phone,
  children,
}: {
  phone: boolean
  children: React.ReactNode
}) {
  const [elements, setElements] = useState<{
    search: HTMLElement | null
    tabs: HTMLElement | null
    action: HTMLElement | null
  }>({ search: null, tabs: null, action: null })
  const [claimed, setClaimed] = useState<Record<DockSlot, number>>({
    search: 0,
    tabs: 0,
    action: 0,
  })
  const [view, setView] = useState<DockView>("rest")
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const domain = domainForPath(pathname)
  const inside =
    domain !== undefined &&
    !within(pathname, "/apps") &&
    !within(pathname, "/chat") &&
    !within(pathname, "/discussions")
  const department = useMemo<AppTile | null>(
    () =>
      inside && domain !== undefined
        ? {
            id: domain.id,
            label: domain.label,
            icon: domain.icon,
            modules: modulesOfDomain(domain),
          }
        : null,
    [inside, domain]
  )
  // The screen that offered the tools is gone: the drawer is not left holding
  // their view open for nothing.
  useEffect(() => {
    if (claimed.search === 0) setView("rest")
  }, [claimed.search])

  const attach = useCallback(
    (slot: DockSlot, element: HTMLElement | null) =>
      setElements((was) =>
        was[slot] === element ? was : { ...was, [slot]: element }
      ),
    []
  )
  const claim = useCallback((slot: DockSlot) => {
    setClaimed((was) => ({ ...was, [slot]: was[slot] + 1 }))
    return () => setClaimed((was) => ({ ...was, [slot]: was[slot] - 1 }))
  }, [])

  const value = useMemo<DockValue>(
    () => ({
      phone,
      available:
        phone &&
        elements.search !== null &&
        elements.tabs !== null &&
        elements.action !== null,
      search: elements.search,
      tabs: elements.tabs,
      action: elements.action,
      view,
      setView,
      department,
      claimed,
      attach,
      claim,
    }),
    [phone, elements, view, department, claimed, attach, claim]
  )
  return <DockContext.Provider value={value}>{children}</DockContext.Provider>
}

/// The dock, or null outside the shell.
export function useDock(): DockValue | null {
  // Null for a component's first render, which is the one a streamed section
  // hydrates with: the server drew no dock (`lib/use-mounted.ts`).
  const dock = useContext(DockContext)
  return useMounted() ? dock : null
}

/// Whether the row is showing: something holds a slot. The shell pads the page
/// by it.
export function useDockRow(): boolean {
  const dock = useContext(DockContext)
  return (
    (dock?.claimed.search ?? 0) +
      (dock?.claimed.tabs ?? 0) +
      (dock?.claimed.action ?? 0) >
    0
  )
}

function within(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`)
}

/// Draws `children` into a dock slot on a phone, and nothing anywhere else.
/// While it is mounted it holds the slot, which is what shows the row.
export function DockPortal({
  slot,
  children,
}: {
  slot: DockSlot
  children: React.ReactNode
}) {
  const dock = useContext(DockContext)
  // The server draws no dock contents, so neither does the hydrating render:
  // a section that streams in after hydration would otherwise find the dock
  // already there and portal into a place the server left empty.
  const mounted = useMounted()
  const element = mounted && dock?.available ? dock[slot] : null
  const claim = dock?.claim
  useEffect(() => {
    if (element === null || claim === undefined) return
    return claim(slot)
  }, [element, claim, slot])
  return element === null ? null : createPortal(children, element)
}
