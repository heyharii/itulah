import {
  type QueryKey,
  type UseSuspenseQueryOptions,
} from "@tanstack/react-query"

import { Suspended } from "@/screens/people/suspended"

/// `queryState`'s shape for a read the server starts: the same `loading` and
/// `render`, but the answer is waited for by suspending, so a screen swaps one
/// call for the other and drops its `useQuery` line.
export function awaiting<T, K extends QueryKey>(
  query: UseSuspenseQueryOptions<T, Error, T, K>,
  options: {
    readonly loading?: string
    readonly render: (data: T) => React.ReactNode
  }
) {
  return (
    <Suspended query={query} loading={options.loading}>
      {options.render}
    </Suspended>
  )
}
