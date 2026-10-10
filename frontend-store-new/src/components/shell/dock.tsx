import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { createPortal } from "react-dom"

/// The phone's context row: a strip over the bottom bar that carries what the
/// screen under it is about — its status, its search, and the one thing it
/// makes — the hub's (`frontend-hub/src/components/shell/dock.tsx`), cut to
/// the slots and nothing else.
///
/// ## Why it is not in the page
///
/// A phone is held in one hand and the thumb lives in the lower third. A search
/// box and a round "+" at the top of a list are the two things a thumb has to
/// leave its place for. Both are drawn here instead, directly over the bottom
/// bar, so everything pressed all day sits in one reachable stack: the screen's
/// own controls, then the app's. Nothing goes in the header: it is the part of
/// the screen a thumb reaches last.
///
/// ## How a screen uses it
///
/// It does not mount anything of its own. A screen renders `<DockTools …>`
/// and/or a `<Fab>`, and on a phone those draw into the slots below through a
/// portal, and nowhere else. The row is shown while at least one of them is
/// mounted, so a screen with neither has no empty strip, and the page's bottom
/// padding follows (`useDockRow`).
///
/// ## Why counts and not a flag
///
/// Moving between two screens that both use the dock unmounts one and mounts
/// the other in the same commit. A boolean set by each would flash the row off
/// and back on; counts change together and net to the same number.

export type DockSlot = "search" | "tabs" | "action"

interface DockValue {
  /// This is a phone, whether or not the slots have attached yet. A screen
  /// asks this to decide where its controls go, so they are never drawn inline
  /// for the first frame and then jump.
  readonly phone: boolean
  /// A phone with the bottom bar mounted, and so somewhere to draw.
  readonly available: boolean
  readonly search: HTMLElement | null
  readonly tabs: HTMLElement | null
  readonly action: HTMLElement | null
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

  const attach = useCallback(
    (slot: DockSlot, element: HTMLElement | null) =>
      setElements((was) =>
        was[slot] === element ? was : { ...was, [slot]: element },
      ),
    [],
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
      claimed,
      attach,
      claim,
    }),
    [phone, elements, claimed, attach, claim],
  )
  return <DockContext.Provider value={value}>{children}</DockContext.Provider>
}

/// The dock, or null outside the shell.
// eslint-disable-next-line react-refresh/only-export-components -- the hook is the dock's own reading side
export function useDock(): DockValue | null {
  return useContext(DockContext)
}

/// Whether the row is showing: something holds a slot. The shell pads the page
/// by it.
// eslint-disable-next-line react-refresh/only-export-components -- the shell reads it beside the provider
export function useDockRow(): boolean {
  const dock = useContext(DockContext)
  return (
    (dock?.claimed.search ?? 0) +
      (dock?.claimed.tabs ?? 0) +
      (dock?.claimed.action ?? 0) >
    0
  )
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
  const element = dock?.available ? dock[slot] : null
  const claim = dock?.claim
  useEffect(() => {
    if (element === null || claim === undefined) return
    return claim(slot)
  }, [element, claim, slot])
  return element === null ? null : createPortal(children, element)
}
