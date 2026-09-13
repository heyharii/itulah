import { ErrorState, LoadingState } from "@/components/ui/states"
import { ApiError } from "@itulah/contract/client"

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
    /// What to draw when the server refused rather than failed.
    ///
    /// Optional because most routes here cannot refuse — `required_role` puts
    /// every GET outside `/finance` and the admin prefixes at the lowest role,
    /// so a screen that added this state would be drawing one nobody can
    /// reach. A caller that passes nothing keeps the error, which is right.
    refused?: React.ReactNode
    render: (data: T) => React.ReactNode
  }
): React.ReactNode {
  if (query.isPending) return <LoadingState>{options.loading}</LoadingState>
  if (query.isError) {
    // A refusal read as a failure sends somebody to look for the data, and
    // `<ErrorState>` offers them a Try again that will never work. Which
    // sentence to put in its place is the screen's to write, because only the
    // screen knows what was being asked for.
    if (
      options.refused !== undefined &&
      query.error instanceof ApiError &&
      query.error.status === 403
    )
      return options.refused
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  }
  return options.render(query.data as T)
}
