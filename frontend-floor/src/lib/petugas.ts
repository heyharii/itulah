import { useSyncExternalStore } from "react"

/// Who is holding this phone, on a node that has no sign-in.
///
/// A DC run with `INVENTORY_AUTH_MODE=disabled` answers `/auth/me` with one
/// placeholder person (`development`) for everybody. The actor on every job
/// then came out the same, and the node's `CHECK (verified_by <> counted_by)`
/// refused every verification — a delivery counted on this app could not be
/// accepted on this app, and receiving had to leave the floor for the hub.
///
/// So on such a node the person says their name, the way the hub's bench does
/// (`frontend-hub/src/lib/operations/bench.ts`). Kept in `localStorage`, one
/// name per phone: a shared bay phone passes from counter to verifier, and the
/// second person changes the name before checking. With sign-in on, none of
/// this is read — the actor is the account, which is the only answer that
/// means anything there.
const KEY = "floor.petugas.v1"

function read(): string | null {
  try {
    const stored = window.localStorage.getItem(KEY)
    return stored === null || stored.trim() === "" ? null : stored
  } catch {
    return null
  }
}

let current = typeof window === "undefined" ? null : read()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) {
      current = read()
      listener()
    }
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

export function setPetugas(name: string | null): void {
  const next = name === null || name.trim() === "" ? null : name.trim()
  current = next
  try {
    if (next === null) window.localStorage.removeItem(KEY)
    else window.localStorage.setItem(KEY, next)
  } catch {
    // Unwritable storage costs a retype after a reload, nothing more.
  }
  for (const listener of listeners) listener()
}

export function usePetugas(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  )
}
