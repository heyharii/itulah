import { ErrorState, LoadingState } from "@/components/ui/states"

/// The three-way render every screen does with a Query result, in one place.
///
/// Written as a function rather than a component so the caller keeps its
/// narrowed `data` type: `<Async query={q}>{(rows) => …}</Async>` would make
/// `rows` the union of every state again.
export function queryState<T>(
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
  if (query.isPending) return <LoadingState>{options.loading}</LoadingState>
  if (query.isError)
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  return options.render(query.data as T)
}
