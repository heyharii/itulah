/**
 * The async-state vocabulary the screens read, and the one adapter that
 * produces it from a TanStack mutation.
 *
 * These four types are all that survived `use-api-resource.ts`. That module
 * hand-rolled a fetch-with-cancellation state machine and a mutation state
 * machine; both were replaced by TanStack Query and had no call sites left, so
 * only the shapes they spoke are still needed. Keeping the shapes is what lets
 * a screen convert to Query without touching its render — `status`,
 * `errorMessage`, `reload` mean the same thing on either side.
 *
 * `toApiMutation` lives here rather than in each domain because it existed six
 * times, byte-identical, in `accounting`, `articles`, `dashboard`, `po`,
 * `sourcing` and (inlined) `commercial`. Six copies of a pure function is six
 * chances for one of them to disagree about what `idle` means.
 */

import type { UseMutationResult } from "@tanstack/react-query"

import { getErrorMessage, type ApiError } from "./client"

export type AsyncStatus = "idle" | "loading" | "success" | "error"

export interface AsyncState<T> {
  status: AsyncStatus
  data: T | undefined
  error: ApiError | Error | undefined
}

/** What a screen reads from a query, whatever is underneath it. */
export interface ApiResource<T> extends AsyncState<T> {
  isLoading: boolean
  isRefreshing: boolean
  errorMessage: string | undefined
  reload: () => void
  reset: () => void
}

/** What a screen reads from a write. */
export interface ApiMutation<TInput, TOutput> {
  status: AsyncStatus
  data: TOutput | undefined
  error: ApiError | Error | undefined
  isLoading: boolean
  errorMessage: string | undefined
  execute: (input: TInput) => Promise<TOutput>
  reset: () => void
}

/**
 * Present a `useMutation` result in the shape above.
 *
 * `execute` is `mutateAsync`, not `mutate`: the screens `await` a write and
 * then close a sheet or push a toast, which needs the rejection to arrive as a
 * rejected promise rather than only in `onError`.
 */
export function toApiMutation<TInput, TOutput>(
  mutation: UseMutationResult<TOutput, Error, TInput>
): ApiMutation<TInput, TOutput> {
  const error = mutation.error instanceof Error ? mutation.error : undefined
  const status: AsyncStatus = mutation.isPending
    ? "loading"
    : mutation.isError
      ? "error"
      : mutation.isSuccess
        ? "success"
        : "idle"

  return {
    status,
    data: mutation.data,
    error,
    isLoading: mutation.isPending,
    errorMessage: error ? getErrorMessage(error) : undefined,
    execute: mutation.mutateAsync,
    reset: mutation.reset,
  }
}
