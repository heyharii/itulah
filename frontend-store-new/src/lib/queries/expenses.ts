import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query"

import { cacheKey, node } from "@/lib/api"
import { commandKey } from "@/lib/till"
import type { Identity } from "@itulah/contract/client"
import type {
  ExpenseRecorded,
  ExpenseWindow,
  PettyCashPosition,
  PettyCashTopUpRecorded,
  PettyCashTopUpRequest,
  RecordExpenseRequest,
  Supervisor,
} from "@itulah/contract"

/// The shop's small money, as the screen asks for it.
///
/// Two reads and two writes, and the two reads are deliberately separate calls
/// answering separate questions:
///
///   **the tin** is a lifetime figure — the money head office handed over in
///   July is still in it in September — so it is cached under a key of its own
///   and does not move when somebody changes the span;
///
///   **the book** is a span, and changing the span refetches only it.
///
/// Folding one into the other would mean the balance blinking — refetched,
/// identical, redrawn — every time a manager pressed "30 days".
///
/// Everything that writes writes with an idempotency key held across retries,
/// like `lib/till.ts` beside it. A till is offline half the time by design, and
/// an expense sent twice because the first answer never came back is a float
/// that reports itself short by exactly one receipt.

export const pettyCashKey = () => ["petty", "position"] as const

export const expenseKey = (from: string, to: string) =>
  ["petty", "expenses", from, to] as const

/// Who is doing this, from the session the app already holds.
///
/// The node overwrites `actor_id` from the authenticated principal whenever
/// auth is on, so this is belt and braces — except on a development node with
/// `INVENTORY_AUTH_MODE=disabled`, where there is no principal to overwrite it
/// with and a blank name is refused as "actor_id is required".
///
/// A local copy of the same three lines `lib/till.ts` keeps private rather than
/// an export prised out of that file: it is a file several lanes are editing,
/// and three lines of cache read are not worth a merge conflict over.
function actorFrom(client: ReturnType<typeof useQueryClient>): string {
  const me = client.getQueryData<Identity | null>(cacheKey.me())
  return me?.username ?? ""
}

/// What is in the tin: handed over, spent, left, and the line above which an
/// expense needs Finance's code. The line arrives with the position (Finance's
/// setting), never spelled here.
export function usePettyCash() {
  return useQuery({
    queryKey: pettyCashKey(),
    queryFn: ({ signal }) =>
      node.get<PettyCashPosition>("/api/v1/store/petty-cash", { signal }),
  })
}

/// The shop's petty cash book over a span, in the shop's own wall clock.
///
/// `utc_offset_minutes` is sent from the browser rather than assumed at the
/// node: a shop asking for "today" before seven in the morning would otherwise
/// be answered with yesterday.
export function useExpenses(from: string, to: string) {
  return useQuery({
    queryKey: expenseKey(from, to),
    queryFn: ({ signal }) =>
      node.get<ExpenseWindow>(
        `/api/v1/store/expenses?from=${from}&to=${to}` +
          `&utc_offset_minutes=${-new Date().getTimezoneOffset()}&limit=100`,
        { signal },
      ),
  })
}

export interface ExpenseDraft {
  readonly category: string
  readonly amountMinor: number
  readonly payee: string
  readonly reason: string
  /// Finance's one-time code; only needed above the line.
  readonly approvalCode: string | null
}

/// Record what the shop spent.
///
/// The answer carries the tin after this expense, so the header updates from
/// the write instead of from a second round trip — the same thing a cash
/// movement does when it answers with the whole Z report.
export function useRecordExpense(): UseMutationResult<
  ExpenseRecorded,
  Error,
  ExpenseDraft
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (draft) => {
      const request: RecordExpenseRequest = {
        category: draft.category,
        amount_minor: draft.amountMinor,
        payee: draft.payee,
        reason: draft.reason,
        actor_id: actorFrom(client),
        approval_code: draft.approvalCode,
        idempotency_key: commandKey("expense"),
      }
      return node.post<ExpenseRecorded>("/api/v1/store/expenses", request)
    },
    onSuccess: (recorded) => {
      client.setQueryData(pettyCashKey(), recorded.position)
      // Every span, not the one on screen: an expense recorded today belongs to
      // "today", to "7 days" and to "30 days", and a manager who switches back
      // to a span they were looking at a minute ago should not find it missing.
      void client.invalidateQueries({ queryKey: ["petty", "expenses"] })
    },
  })
}

export interface TopUpDraft {
  readonly amountMinor: number
  readonly reference: string
  readonly note: string
  readonly supervisor: Supervisor
}

/// Record the float head office handed over.
export function useRecordTopUp(): UseMutationResult<
  PettyCashTopUpRecorded,
  Error,
  TopUpDraft
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (draft) => {
      const request: PettyCashTopUpRequest = {
        amount_minor: draft.amountMinor,
        reference:
          draft.reference.trim() === "" ? null : draft.reference.trim(),
        note: draft.note.trim() === "" ? null : draft.note.trim(),
        actor_id: actorFrom(client),
        supervisor: draft.supervisor,
        idempotency_key: commandKey("petty-topup"),
      }
      return node.post<PettyCashTopUpRecorded>(
        "/api/v1/store/petty-cash/top-ups",
        request,
      )
    },
    onSuccess: (recorded) => {
      client.setQueryData(pettyCashKey(), recorded.position)
      void client.invalidateQueries({ queryKey: ["petty", "expenses"] })
    },
  })
}
