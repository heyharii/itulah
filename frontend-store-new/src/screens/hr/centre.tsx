import { Button } from "@/components/ui/button"
import { ApiError } from "@itulah/contract/client"

/// The three-way render a Query does, for an answer that came from **head
/// office** rather than from this shop's node.
///
/// `lib/query-state.tsx` is the one every other screen uses and it is right for
/// them: everything they read is answered by the machine in the next room, so
/// "this node could not be reached" names the right machine. On these screens
/// it names the wrong one. A manager told the node is unreachable would look at
/// the till, which is working — the thing that is down is the line to the
/// centre, and that is a different problem with a different fix.
///
/// A function rather than a component, for the reason `queryState` gives: the
/// caller keeps its narrowed `data` type.
export function centreState<T>(
  query: {
    isPending: boolean
    isError: boolean
    error: unknown
    data: T | undefined
    refetch: () => void
  },
  options: {
    loading?: string
    /// What was being read, for the refusal sentence — "this shop's claims".
    what?: string
    render: (data: T) => React.ReactNode
  },
): React.ReactNode {
  if (query.isPending) {
    return (
      <div className="mx-auto max-w-[28em] px-4 py-12 text-center">
        <p className="text-meta text-body">
          {options.loading ?? "Loading…"}
        </p>
      </div>
    )
  }
  if (query.isError) {
    // A refusal is an answer, not a failure: head office looked at who is
    // asking and said no, or has no such thing. Asking again would get the
    // same answer, so a refused read says why in a sentence and offers no
    // retry — the button is for a line that dropped, which can come back.
    const refused = isRefusal(query.error)
    return (
      <div className="mx-auto flex max-w-[28em] flex-col items-center gap-4 px-4 py-12 text-center">
        <p className={refused ? "text-meta text-body" : "text-meta text-bad"}>
          {describeCentre(query.error, options.what)}
        </p>
        {!refused && (
          <Button variant="ghost" onClick={() => query.refetch()}>
            Try again
          </Button>
        )}
      </div>
    )
  }
  return options.render(query.data as T)
}

/// Whether head office *refused* rather than failed: 403 is "this sign-in may
/// not", 404 is "there is no such thing here" — which, for a whole route, is a
/// centre older than this screen. Neither gets better by asking again.
export function isRefusal(error: unknown): boolean {
  return (
    error instanceof ApiError && (error.status === 403 || error.status === 404)
  )
}

/// The centre's own sentence when it managed to say one, and an honest
/// statement about the line when it did not.
///
/// Every route at the centre answers a failure with `{"error": "…"}` written
/// for a person — which shop a caller is not posted to, which month has no
/// first day — and that sentence is repeated verbatim. Anything that is not an
/// `ApiError` never reached the centre at all, and the difference matters more
/// here than anywhere else in this app: **these screens are not offline-first.**
/// The till goes on selling with the line down; the rota, the leave queue and
/// the month's close are held at head office and simply cannot be answered
/// without it. An empty rota would read as "nobody is working today", which is
/// the one thing it must never be mistaken for.
///
/// A 403 and a 404 are said as what they are for a shop: the store's sign-in
/// is not allowed that, or the centre this till reaches does not have it. Both
/// keep the centre's own sentence after the explanation, because it usually
/// names exactly which rule said no.
export function describeCentre(error: unknown, what?: string): string {
  if (error instanceof ApiError) {
    const subject = what ?? "this"
    // An empty or generic status text adds nothing after the explanation.
    const detail =
      error.message === "" || /^(forbidden|not found)$/i.test(error.message)
        ? ""
        : ` ${error.message}`
    if (error.status === 403) {
      return what === undefined
        ? `Not allowed for this account.${detail}`
        : `Not allowed to see ${what}.${detail}`
    }
    if (error.status === 404) {
      return `Not found: ${subject}.${detail}`
    }
    return error.message
  }
  return "Can't reach head office. Try again when the line is back."
}
