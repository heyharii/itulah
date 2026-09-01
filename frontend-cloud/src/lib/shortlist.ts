import { useCallback, useSyncExternalStore } from "react"

/// The shortlist: what a buyer has staged to order, before there is an order.
///
/// This one lives in the browser, and that is a deliberate, visible gap rather
/// than a design. The Cloud node has no shortlist route — `cloud/http/mod.rs`
/// exposes suppliers, supplier items and purchase orders, and nothing between
/// them — so there is nowhere to put it that two people could both see. Staged
/// on one laptop is not staged for the buying team, and it is gone when the
/// browser's storage is cleared.
///
/// Everything below is deliberately shaped like the server version that should
/// replace it — a set of `supplier_item_id`, changed by add/remove/clear — so
/// that swapping in `GET/POST /api/v1/sourcing-shortlists` is a change to this
/// file and to nothing that renders.
const KEY = "itulah.cloud.sourcing.shortlist"

/// A set nobody can mutate from outside, so a re-render is never skipped for
/// having compared the same object with itself.
let snapshot: ReadonlySet<string> = read()
const listeners = new Set<() => void>()

function read(): ReadonlySet<string> {
  if (typeof localStorage === "undefined") return new Set()
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((id): id is string => typeof id === "string"))
  } catch {
    // Private browsing, a full quota, or a value some earlier version wrote in
    // another shape. An unreadable shortlist is an empty one, not a crash on
    // the way to a screen that has nothing to do with it.
    return new Set()
  }
}

function write(next: ReadonlySet<string>): void {
  snapshot = next
  try {
    localStorage.setItem(KEY, JSON.stringify([...next]))
  } catch {
    // The staging still holds for this tab; it just will not survive a reload.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Another tab of the same app is the same buyer. `storage` fires only in the
  // tabs that did not make the change, which is exactly the set that needs it.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== KEY) return
    snapshot = read()
    listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

const EMPTY: ReadonlySet<string> = new Set()

export interface Shortlist {
  readonly ids: ReadonlySet<string>
  readonly count: number
  readonly has: (id: string) => boolean
  readonly toggle: (id: string) => void
  readonly add: (ids: readonly string[]) => void
  readonly remove: (ids: readonly string[]) => void
  readonly clear: () => void
}

export function useShortlist(): Shortlist {
  const ids = useSyncExternalStore(
    subscribe,
    () => snapshot,
    // No server render here, but the store reads `localStorage` at module load
    // and a hydration pass must not be handed a value the server could not have
    // produced.
    () => EMPTY,
  )

  const toggle = useCallback((id: string) => {
    const next = new Set(snapshot)
    if (!next.delete(id)) next.add(id)
    write(next)
  }, [])

  const add = useCallback((incoming: readonly string[]) => {
    const next = new Set(snapshot)
    for (const id of incoming) next.add(id)
    write(next)
  }, [])

  const remove = useCallback((outgoing: readonly string[]) => {
    const next = new Set(snapshot)
    for (const id of outgoing) next.delete(id)
    write(next)
  }, [])

  const clear = useCallback(() => write(new Set()), [])

  return {
    ids,
    count: ids.size,
    has: (id: string) => ids.has(id),
    toggle,
    add,
    remove,
    clear,
  }
}
