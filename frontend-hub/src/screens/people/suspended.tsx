import {
  useSuspenseQuery,
  type QueryKey,
  type UseSuspenseQueryOptions,
} from "@tanstack/react-query"
import { Suspense } from "react"

import { LoadingState } from "@/components/ui/states"

/// A part of a screen that waits for one answer, and the wait it shows.
///
/// The server starts the screen's reads before it renders (`prefetch.ts`), so
/// whatever it has by then is in the first HTML and whatever it has not is
/// streamed in behind it. A plain `useQuery` cannot tell those two renders
/// apart from the browser's first one — it would draw the answer on one side
/// and the wait on the other — so a read the server starts is read by
/// suspending: the same options the prefetcher warms, the wait as the
/// boundary's fallback, and the answer handed to `children`.
///
/// The page's header and toolbar stay OUTSIDE this, so they paint at once;
/// sections that load independently each get their own.
export function Suspended<T, K extends QueryKey>({
  query,
  loading,
  children,
}: {
  readonly query: UseSuspenseQueryOptions<T, Error, T, K>
  /// The sentence under the spinner while the answer is on its way.
  readonly loading?: string
  readonly children: (data: T) => React.ReactNode
}) {
  return (
    <Suspense fallback={<LoadingState>{loading}</LoadingState>}>
      <Read query={query}>{children}</Read>
    </Suspense>
  )
}

function Read<T, K extends QueryKey>({
  query,
  children,
}: {
  readonly query: UseSuspenseQueryOptions<T, Error, T, K>
  readonly children: (data: T) => React.ReactNode
}) {
  const { data } = useSuspenseQuery(query)
  return <>{children(data)}</>
}
