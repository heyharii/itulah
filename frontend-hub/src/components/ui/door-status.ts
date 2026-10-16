import { useRouterState } from "@tanstack/react-router"
import {
  createContext,
  useContext,
  useLayoutEffect,
  useSyncExternalStore,
} from "react"

import { doorForPath } from "@/lib/navigation"

/// True around a door's own tabs (`DoorTabs`), which stay tabs.
export const DoorHead = createContext(false)

/// Whether the screen on show is one of a door's tabs or views — the screens
/// whose own tabs give way to the door's (`SubTabs`, `DockTools`).
export function useInDoor(): boolean {
  const own = useContext(DoorHead)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return !own && doorForPath(pathname) !== undefined
}

/// A list's status ("Active", "All statuses") as a door's button takes it on a
/// phone. The door's button already says which list this is — its tab, its
/// view — so the status joins it rather than standing beside it as another
/// button in a dock that holds four (owner, 2026-10-16: "supaya baris tombol
/// bawahnya tidak penuh").
export interface DoorStatus {
  readonly title: string
  readonly value: string
  readonly options: readonly {
    readonly value: string
    readonly label: React.ReactNode
    readonly short?: string
    readonly count?: number
  }[]
  readonly onChange: (value: string) => void
}

/// The choices that say which list this is — "Status", or "Show" (Running ·
/// All) — as against a shop, a day or a unit, which narrow it.
export function isStatus(title: string): boolean {
  return title === "Status" || title === "Show"
}

let current: DoorStatus | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((one) => one())
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/// The status a screen handed its door, if any.
export function useDoorStatus(): DoorStatus | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null
  )
}

/// Hand the screen's status to the door's button while `give` holds; the
/// caller then draws no button of its own.
export function useGiveDoorStatus(status: DoorStatus | null, give: boolean) {
  useLayoutEffect(() => {
    if (!give || status === null) return
    current = status
    notify()
    return () => {
      if (current === status) {
        current = null
        notify()
      }
    }
  }, [give, status])
}
