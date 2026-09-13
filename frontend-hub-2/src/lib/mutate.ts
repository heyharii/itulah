import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { QueryKey } from "@tanstack/react-query"
import { useCallback, useState } from "react"

import { ApiError } from "@/lib/api"

/// Writing, and what a screen is entitled to say while a write is in the air.
///
/// `lib/list.ts` is the reading half of this app and was written first because
/// Finance and People only read. Purchasing is the first module that composes a
/// document, corrects a record and settles a decision, so the writing half is
/// written here — once, for the same reason the reading half was: four screens
/// each calling `useMutation` by hand is four ideas about what a failure means
/// and which lists a success has made wrong.
///
/// ## Nothing here is optimistic, and that is a decision rather than an omission
///
/// An optimistic update draws an answer the server has not given yet, and
/// backs it out if the server disagrees. It is worth that complication where
/// the round trip is the thing standing between somebody and their next action
/// — a checkbox, a reorder, a star.
///
/// Every write in Procurement fails the test, in one of two ways:
///
///   **The answer is not predictable.** Raising a purchase order returns a PO
///   number the server allocated, a command id, and three money figures the
///   server computed from the catalogue rather than from the screen. There is
///   nothing to draw early — the whole point of the answer is that it contains
///   what the browser did not know.
///
///   **Being wrong costs more than waiting.** A basket quantity, a closed-short
///   line, an approved price amendment: each is a figure somebody will act on.
///   A predicted quantity that silently reverts two seconds later is a buyer
///   who has already moved on believing the wrong number, and the revert is
///   indistinguishable from somebody else's edit.
///
/// So the rule is: **the figure on screen is the figure the server holds.**
/// What a write does instead of predicting is say it is happening — see
/// `pending` below and `kit/notice.tsx`'s `Pending` — and what it leaves behind
/// on failure is exactly what was there before, which is what makes retrying
/// safe to offer.
///
/// The cost is real and is paid deliberately: a quantity box does not move
/// until the round trip finishes. The screens that have one keep the typed text
/// in the DOM — an uncontrolled input committed on blur — so the number
/// somebody typed stays visible while the row behind it settles. The text is
/// theirs; the figure is the server's.
///
/// ## What a failure leaves behind
///
/// Nothing, and the screens say so. Because no cache is touched before the
/// answer arrives, a refused write leaves the list, the record and the totals
/// exactly as they were — so "nothing of yours has changed" (the sentence
/// `kit/state.tsx` already uses) is true rather than reassuring.
///
/// The one write where that is NOT the whole story is raising an order from a
/// basket, and it is called out where it happens: the order is created first
/// and the consumed basket lines are removed afterwards, so a failure between
/// the two leaves an order that exists and a basket that still holds its lines.
/// That is the safe direction to fail in — a leftover basket line is a nuisance
/// somebody deletes, a lost order is a purchase nobody made — and the screen
/// says which happened.

/// A key held across retries, rotated after a success.
///
/// The point of an idempotency key is that a RETRY carries the same one: the
/// server stores it with a digest of the request and replays its first answer
/// instead of writing twice. So it must not be regenerated per render or per
/// click — a fresh key on the second press of a double-clicked button is two
/// purchase orders.
///
/// Rotating after a success is the other half: the next write is a genuinely
/// different one, and reusing the key would have the server replay the previous
/// answer and report a success for something it never did.
export function useIdempotency(): {
  readonly key: string
  readonly rotate: () => void
} {
  // The one piece of state in this file. A key is not URL state — it is not a
  // thing anybody links to, bookmarks or reads — and it must survive a rerender
  // without changing, which is exactly what `useState` with an initialiser is.
  const [key, setKey] = useState(() => crypto.randomUUID())
  const rotate = useCallback(() => setKey(crypto.randomUUID()), [])
  return { key, rotate }
}

/// The headers a guarded write carries.
///
/// `Idempotency-Key` is described above. `If-Match` is the record's `version`
/// as a strong quoted ETag, and it is what stops two people editing one
/// supplier from becoming a silent last-write-wins: the server refuses a write
/// against a version somebody else has already moved past, and the screen gets
/// a 409 it can say out loud rather than an edit that vanished.
export function guarded(
  idempotencyKey: string,
  version?: number,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Idempotency-Key": idempotencyKey,
  }
  if (version !== undefined) headers["If-Match"] = `"${version}"`
  return headers
}

/// One write, and the reads it makes wrong.
///
/// ## Why invalidation is a required argument rather than a convenience
///
/// Because the commonest defect in a write screen is not the write failing — it
/// is the write succeeding and the list beside it still showing the old answer.
/// Somebody closes a line short, the sheet updates, the table behind it does
/// not, and the next person to read the table acts on a figure that was
/// corrected ten minutes ago.
///
/// `settles` is therefore named per call site and is a FUNCTION of the result,
/// because which reads a write invalidates often depends on what it returned:
/// approving a price amendment changes the queue and one order, and the order
/// is named in the answer.
///
/// React Query matches keys by PREFIX, so `["procurement", "orders"]`
/// invalidates every narrowing of the order book at once — which is what is
/// wanted, since a new order belongs in some of those lists and not others and
/// the browser is not the thing that decides which.
export function useWrite<Input, Result>({
  send,
  settles,
  onDone,
}: {
  /// The request. One function, so the URL, the verb and the body are read
  /// together at the call site instead of being spread across a wrapper.
  send: (input: Input) => Promise<Result>
  /// The cache keys this write has made wrong. Prefixes are fine and usual.
  settles: (result: Result, input: Input) => readonly QueryKey[]
  /// What the screen does next — close a sheet, step a flow on, clear a box.
  /// Runs after the invalidations are queued and only on success.
  onDone?: (result: Result, input: Input) => void
  /// What a REFUSAL makes wrong, which is occasionally something.
  ///
  /// Usually nothing: a refused write changed nothing, so nothing needs
  /// re-reading. The exception is a write refused because the world moved —
  /// a PO number somebody else took while this one was being composed — where
  /// the only way forward is to read the world again. Naming it here keeps
  /// that reasoning beside the write rather than in an effect somewhere.
  onFailed?: (error: unknown, input: Input) => void
}) {
  const client = useQueryClient()

  const mutation = useMutation({
    // Wrapped rather than passed by reference: React Query hands a mutation
    // context as the second argument, and a `send` that took an optional
    // second parameter — a signal, a header bag — would silently receive it.
    mutationFn: (input: Input) => send(input),
    onSuccess: (result, input) => {
      for (const queryKey of settles(result, input)) {
        void client.invalidateQueries({ queryKey })
      }
      onDone?.(result, input)
    },
    onError: (error, input) => onFailed?.(error, input),
  })

  return {
    mutation,
    run: mutation.mutate,
    /// In flight. The screens draw this rather than predicting the answer —
    /// see the note at the top of this file.
    pending: mutation.isPending,
    /// What went wrong, as a sentence for a person, or `null`. Never the raw
    /// error: `ApiError.detail` is written for a reader and `title` is the
    /// category, and a screen that printed `[object Object]` has told somebody
    /// their order failed and nothing else.
    problem: mutation.isError ? problem(mutation.error) : null,
    reset: mutation.reset,
  }
}

/// What the server said went wrong, as one sentence.
export function problem(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return (
        error.detail ||
        "Somebody else changed this while it was open, so the write was refused. Reload and look again before sending it."
      )
    }
    return error.detail || error.title
  }
  if (error instanceof Error) return error.message
  return "The request did not complete."
}
