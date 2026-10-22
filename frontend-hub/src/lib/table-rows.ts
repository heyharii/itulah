import { useRouterState } from "@tanstack/react-router"
import { useEffect, useSyncExternalStore } from "react"

import { useLayout } from "@/lib/layout"

/// How tall a list's rows are drawn, chosen by each person.
///
/// The owner, 17 Oct 2026 ("finance ada versi compactnya … buatkan view switch
/// nya now dan tight+fit", `finance-compact-tables.html`): Finance reads long
/// registers, so its tables offer two ways to be drawn —
///
///  - **Comfortable**, the hub's own table: 52px rows, 16px cell sides, every
///    amount with its "Rp".
///  - **Compact** ("Tight + fit"): 38px rows, 12px sides, the 36px heading,
///    amounts without "Rp" (the column says what they are), and a table that
///    gives up its least-needed columns rather than scroll sideways.
///
/// The text stays 15px either way: a table is made compact by its rows, never
/// by a smaller face. Kept in this browser, like the sidebar's fold.
export type TableRows = "comfortable" | "compact"

export const TABLE_ROWS: readonly {
  readonly value: TableRows
  readonly label: string
}[] = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
]

const KEY = "hub.table.rows"

/// The departments whose tables offer the choice.
const OFFERED = ["/finance"]

let current: TableRows | null = null
const listeners = new Set<() => void>()

function read(): TableRows {
  if (current !== null) return current
  try {
    current =
      window.localStorage.getItem(KEY) === "compact" ? "compact" : "comfortable"
  } catch {
    current = "comfortable"
  }
  return current
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Another tab of the hub changed it: read it again.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return
    current = null
    listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

export function setTableRows(next: TableRows) {
  current = next
  try {
    window.localStorage.setItem(KEY, next)
  } catch {
    // A private window: the choice lasts until the tab closes.
  }
  for (const listener of listeners) listener()
}

export function useTableRows(): TableRows {
  return useSyncExternalStore(subscribe, read, () => "comfortable")
}

/// Whether the page on screen is one whose tables offer the choice. A phone
/// draws its rows as cards, which have no row height to choose.
export function useRowsOffered(): boolean {
  const pathname = useRouterState({
    select: (state) => (state.resolvedLocation ?? state.location).pathname,
  })
  const phone = useLayout() === "phone"
  return (
    !phone &&
    OFFERED.some((base) => pathname === base || pathname.startsWith(base + "/"))
  )
}

/// Whether the tables on this page are drawn compact.
export function useCompactRows(): boolean {
  const rows = useTableRows()
  return useRowsOffered() && rows === "compact"
}

/// How many tables on the page could be drawn either way: the Rows switch
/// shows only where there is a table for it to change.
let tables = 0
const tableListeners = new Set<() => void>()

function subscribeTables(listener: () => void) {
  tableListeners.add(listener)
  return () => {
    tableListeners.delete(listener)
  }
}

export function useRowsTables(): number {
  return useSyncExternalStore(
    subscribeTables,
    () => tables,
    () => 0
  )
}

/// A table says it is on the page (`DataTable`, while it is a table and not
/// cards on a page that offers the choice).
export function useRegisterRowsTable(active: boolean) {
  useEffect(() => {
    if (!active) return
    tables += 1
    for (const listener of tableListeners) listener()
    return () => {
      tables -= 1
      for (const listener of tableListeners) listener()
    }
  }, [active])
}
