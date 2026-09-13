import { ErrorState, LoadingState } from "@/components/ui/states"

/// The three-way render every screen does with a Query result, in one place.
///
/// Written as a function rather than a component so the caller keeps its
/// narrowed `data` type: `<Async query={q}>{(rows) => …}</Async>` would make
/// `rows` the union of every state again.
///
/// ## Why a failure counts even while the query calls itself pending
///
/// Every list on this surface polls. A polled query that has **never** had an
/// answer sits at `isPending` between its attempts — the next poll starts a new
/// fetch before anybody reads the error — so a screen that only looked at
/// `isPending` and `isError` said "Menanyakan node…" for as long as the node was
/// down. On a bay with no signal that is the *normal* case, and a quiet sentence
/// that never resolves is the worst thing this app could say: it looks like work
/// in progress, so nobody goes and fixes the wifi.
///
/// So the rule is: **no data and something has already failed → say so.** The
/// text is the node's own sentence where there is one, and a Try-again that
/// re-asks.
export function queryState<T>(
  query: {
    isPending: boolean
    isError: boolean
    error: unknown
    /// What the last attempt threw, kept by Query across the retries and the
    /// polls that follow. This is what makes a failure visible while the status
    /// is still nominally pending.
    failureReason?: unknown
    failureCount?: number
    data: T | undefined
    refetch: () => void
  },
  options: {
    loading?: string
    render: (data: T) => React.ReactNode
  },
): React.ReactNode {
  const stumbled = query.isError || (query.failureCount ?? 0) > 0
  if (query.data === undefined && stumbled) {
    return (
      <ErrorState
        error={query.error ?? query.failureReason}
        onRetry={() => query.refetch()}
      />
    )
  }
  if (query.isPending) return <LoadingState>{options.loading}</LoadingState>
  if (query.isError)
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  return options.render(query.data as T)
}
