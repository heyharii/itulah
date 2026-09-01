import { useCallback, useState } from "react"

import { ApiError } from "@itulah/contract/client"

/// Two small things every write on this module needs, and nowhere shared to
/// put them.
///
/// Inlined here rather than added to `src/lib` because `lib/` is not this
/// module's to edit — if a second module wants either of these, they should be
/// promoted rather than copied a third time.

/// The idempotency key a write is held under, held by the CALLER across
/// re-renders and renewed only once the write has landed.
///
/// This is the whole mechanism, not a formality. The server stores its first
/// answer against the key and replays it, so a double-clicked Complete settles
/// one sale and receives the same receipt twice. A key minted inside the
/// mutation function would be a fresh one per click, and the second click would
/// settle the sale a second time — which for a till means taking the money
/// twice.
///
/// `renew` is called on success: the next basket is a different intent and must
/// not be replayed as this one.
export function useIdempotencyKey(): readonly [string, () => void] {
  const [key, setKey] = useState(() => crypto.randomUUID())
  const renew = useCallback(() => setKey(crypto.randomUUID()), [])
  return [key, renew]
}

/// The server's own sentence about why a write was refused.
///
/// Quoted, never translated into a code of this app's invention: the node
/// answers "cannot record a payment before the sale has lines" and "item … is
/// no longer available on the store floor (likely sold by another till)", and
/// both of those tell a cashier what to do next in a way "409" does not.
export function problemText(error: unknown): string | undefined {
  if (error === null || error === undefined) return undefined
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return "The server could not be reached."
}
