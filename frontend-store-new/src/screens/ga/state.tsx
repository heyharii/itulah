import { Button } from "@/components/ui/button"
import { ApiError } from "@itulah/contract/client"

/// The three-way render a GA query does — `hr/centre.tsx`'s `centreState`,
/// with GA's own sentences.
///
/// Not `queryState`: that one names this shop's node when something fails,
/// and a manager told "this node could not be reached" looks at the till,
/// which is working. What failed is the line to head office, or head office
/// saying no, and each of those has a different next step.
///
/// A function rather than a component so the caller keeps its narrowed type.
export function gaState<T>(
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
          {options.loading ?? "Loading…"}
        </p>
      </div>
    )
  }
  if (query.isError) {
    return (
      <div className="mx-auto flex max-w-[30em] flex-col items-center gap-4 px-4 py-12 text-center">
        <p className="text-meta text-bad">{describeGa(query.error)}</p>
        <Button variant="ghost" onClick={() => query.refetch()}>
          Try again
        </Button>
      </div>
    )
  }
  return options.render(query.data as T)
}

/// One clear sentence for each way head office can fail to answer.
///
/// The three refusals the relay and the centre give — 401, 403, 503 — each
/// get a sentence that says whose move it is, with the centre's own words
/// kept where it gave any. A 502 or 504 is the proxy in between saying the
/// centre never answered, which is the same fact as a network failure and
/// gets the same sentence. Everything else is the centre's own sentence,
/// verbatim — `{"error": "…"}` is written for a person.
///
/// The last line matters most: general affairs is kept at head office, not on
/// this shop's node, so with the line down there is nothing to show — and an
/// empty register must never be mistaken for a shop with nothing in it.
export function describeGa(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 401:
        return "Signed out. Sign in again."
      case 403:
        return `Not allowed for this account: ${error.message}`
      case 503:
        return "Head office is not answering. Try again shortly."
      case 0:
      case 502:
      case 504:
        break
      default:
        return error.message
    }
  }
  return "Can't reach head office. Try again when the line is back."
}
