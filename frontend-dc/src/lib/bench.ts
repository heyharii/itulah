import { useSyncExternalStore } from "react"

/// Who is standing at this bench, on a node that has nobody signed in.
///
/// A DC edge can be run with `INVENTORY_AUTH_MODE=disabled` — a bench, a
/// recovery, a machine on a bay with no network to the centre. On such a node
/// every write is attributed to the same development principal, and receiving
/// then cannot be completed at all: counting and verifying are two people by
/// database constraint, not by policy, so one name means an accepted count is
/// refused by `CHECK (verified_by IS NULL OR verified_by <> counted_by)`.
///
/// So the browser names the person instead. This is not the browser claiming an
/// identity: an authenticated node overwrites `actor_id` from its principal and
/// ignores whatever was sent, which is why this is read only when the node
/// reports `auth: "DISABLED"`. It is what a node with no principal writes
/// instead of writing the same word every time.
///
/// Held in `localStorage` rather than in React state because the tablet on the
/// bay is reloaded — a dropped connection, a sleeping tablet, a new shift — and
/// asking again after every reload is how the wrong name gets typed.
const KEY = "itulah.dc.bench-actor"

function read(): string | null {
  try {
    const stored = window.localStorage.getItem(KEY)
    return stored === null || stored.trim() === "" ? null : stored
  } catch {
    // A browser with site data switched off is not a reason to fail to load.
    return null
  }
}

let current = typeof window === "undefined" ? null : read()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Another tab on the same bench: two windows open on one tablet should not
  // disagree about who is at it.
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

export function setBenchActor(name: string | null): void {
  const next = name === null || name.trim() === "" ? null : name.trim()
  current = next
  try {
    if (next === null) {
      window.localStorage.removeItem(KEY)
    } else {
      window.localStorage.setItem(KEY, next)
    }
  } catch {
    // Unwritable storage costs this person a retype after a reload, and
    // nothing else. The name is already in memory for this session.
  }
  for (const listener of listeners) {
    listener()
  }
}

export function useBenchActor(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  )
}
