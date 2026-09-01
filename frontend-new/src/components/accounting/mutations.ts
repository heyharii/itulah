/**
 * Accounting's write boundary, built directly on TanStack Query's
 * `useMutation`.
 *
 * There is exactly one write in this domain: closing a fiscal period
 * (`closePeriod` in `./api`). Per docs/frontend-rules.md §M4, a period close
 * is money — it locks the ledger a whole business reads from — so this is
 * "Neither" of the two optimistic shapes, no exception considered: the
 * screen shows a pending state (`accounting.tsx` already tracks `closeBusy`
 * locally and disables the confirm button on it) and waits for the server.
 * There is nothing to render early, because a closed period is not something
 * a rollback could ever make look like it hadn't happened.
 *
 * Closing a period changes the calendar, and every report on screen —
 * the chart, the journal, the trial balance, the balance sheet — is scoped by
 * it, so the invalidation is the whole `["accounting"]` namespace (§M2: that
 * really is the narrowest affected prefix here, not a shortcut).
 *
 * `closePeriod` mints its own `Idempotency-Key` per call (§M6) — that already
 * happens once per `execute()`, inside the fetcher, so nothing extra is
 * needed here for a mutation that TanStack Query does not retry by default.
 *
 * This hook returns the shared `ApiMutation<TInput, TOutput>` shape (see
 * `@/lib/api/async-state`), because `accounting.tsx` reads `.execute` off it.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { toApiMutation, type ApiMutation } from "@/lib/api"
import { closePeriod, type PeriodStatus } from "./api"
import { accountingQueries } from "./queries"

export interface ClosePeriodInput {
  periodId: string
  closedBy: string
}

/** The period close — the app's only write, and money, so never optimistic. */
export function useClosePeriod(): ApiMutation<ClosePeriodInput, PeriodStatus> {
  const client = useQueryClient()

  const mutation = useMutation<PeriodStatus, Error, ClosePeriodInput>({
    mutationFn: (input) => closePeriod(input.periodId, input.closedBy),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: accountingQueries.all() })
    },
  })

  return toApiMutation(mutation)
}
