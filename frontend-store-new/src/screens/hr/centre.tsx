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
    render: (data: T) => React.ReactNode
  },
): React.ReactNode {
  if (query.isPending) {
    return (
      <div className="mx-auto max-w-[28em] px-4 py-12 text-center">
        <p className="text-meta text-body">
          {options.loading ?? "Asking head office…"}
        </p>
      </div>
    )
  }
  if (query.isError) {
    return (
      <div className="mx-auto flex max-w-[28em] flex-col items-center gap-4 px-4 py-12 text-center">
        <p className="text-meta text-bad">{describeCentre(query.error)}</p>
        <Button variant="ghost" onClick={() => query.refetch()}>
          Try again
        </Button>
      </div>
    )
  }
  return options.render(query.data as T)
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
export function describeCentre(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return "Head office is not reachable from this till. These screens are answered by the centre, not by this shop's node, so there is nothing to show until the line is back — this is not an empty rota."
}
