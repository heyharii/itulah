/// Which seat the signed-in person is sitting at, and the shift they hold there.
///
/// A till is a seat the store has (`KASIR-1` … `KASIR-N`), not the machine in
/// front of you: the person who signs in picks one, and the drawer is theirs.
/// So "which till am I" is a fact about the person's open shift — and it is
/// wanted in places far apart (the header on every screen, a supervisor's
/// approval, the poll that notices the seat was taken). A module-level value
/// read with `useSyncExternalStore`, the same way `session.ts` and `outbox.ts`
/// hold theirs, rather than a prop threaded through every screen.
///
/// Written by exactly one place — `app.tsx`, when the shift gate hands over a
/// shift and when it is lost — and nothing here is persisted: a fresh window
/// asks the node (`myShifts`) rather than believing a stale file.

import { useSyncExternalStore } from "react"

export type Seat = {
  /// `KASIR-1`. What the node and a receipt call it.
  readonly terminal_id: string
  /// `Kasir 1`. What a person reads.
  readonly label: string
  /// The shift held at this seat. Compared against the node's answer to tell
  /// "still mine" from "somebody else's now".
  readonly shift_id: string
}

let held: Seat | null = null
const listeners = new Set<() => void>()

/// Sit down (a seat) or stand up (`null`). Same seat again is not a change, so
/// nothing re-renders for a poll that found what it already knew.
export function holdSeat(next: Seat | null): void {
  if (
    held === next ||
    (held !== null &&
      next !== null &&
      held.terminal_id === next.terminal_id &&
      held.shift_id === next.shift_id)
  ) {
    return
  }
  held = next
  for (const listener of listeners) listener()
}

/// For code that is not a component — a request that names the drawer.
export const seatNow = (): Seat | null => held

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useSeat(): Seat | null {
  return useSyncExternalStore(subscribe, seatNow)
}
