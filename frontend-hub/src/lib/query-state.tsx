import { Banner, ErrorState, LoadingState } from "@/components/ui/states"
import { problemOf } from "@/lib/problem"
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
    /// When the data on screen arrived. Every Query result carries it; it is
    /// optional here only so a hand-built stand-in need not invent one.
    dataUpdatedAt?: number
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

    // A refresh that failed over data already on screen.
    //
    // Query keeps the rows it had when a background refetch fails, and this
    // used to throw them away: a table somebody was halfway down became an
    // error page because the tab regained focus on a flaky connection. The
    // rows are still true as of when they arrived — so they stay, and the
    // failure is said above them, with the time they are from, so nobody
    // reads a stale figure as a live one.
    if (query.data !== undefined)
      return (
        <>
          <Banner tone="warn" className="mb-3">
            Couldn&rsquo;t refresh
            {query.dataUpdatedAt ? (
              <> — showing what loaded at {clock(query.dataUpdatedAt)}</>
            ) : null}
            . {problemOf(query.error) ?? "The server could not be reached."}{" "}
            <button
              type="button"
              onClick={() => query.refetch()}
              className="font-medium underline underline-offset-2"
            >
              Try again
            </button>
          </Banner>
          {options.render(query.data)}
        </>
      )

    return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  }
  return options.render(query.data as T)
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  })
}
